import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callResponsesApiAgent } from '../../src/providers/openai/responses-api-agent.js';
import { setupMcpClientsAndTools } from '../../src/utils/mcp/setup-mcp-tools.js';
import type { McpTool } from '../../src/types/index.js';
import type { OpenAiTool } from '../../src/utils/mcp/mcp-tool-catalog.js';
import type { LocalToolHandler } from '../../src/utils/tools/execute-tool-calls.js';

vi.mock('../../src/utils/mcp/setup-mcp-tools.js', () => ({
  setupMcpClientsAndTools: vi.fn(),
}));

const mockedSetup = setupMcpClientsAndTools as unknown as ReturnType<typeof vi.fn>;

const baseInput = [{ role: 'user', content: 'Say hello.' }];
const model = 'gpt-test-model';
const apiKey = 'test-key';
const endpoint = 'https://api.openai.com/v1/responses';

const defaultSetup = () => ({
  mcpClients: [],
  mcpTools: [],
  toolNameToClient: new Map(),
  toolNameToServer: new Map(),
});

const usageMeta = (input: number, output: number, total: number) => ({
  input_tokens: input,
  output_tokens: output,
  total_tokens: total,
});

const textResponse = (text: string, usage = usageMeta(1, 1, 2)) => ({
  id: 'resp-text',
  output_text: text,
  usage,
});

const toolCallResponse = (
  calls: Array<{ name: string; args?: Record<string, unknown>; id?: string }>,
  usage = usageMeta(2, 1, 3),
) => ({
  id: 'resp-tool',
  output: calls.map((call) => ({
    type: 'function_call',
    name: call.name,
    arguments: call.args,
    call_id: call.id,
  })),
  usage,
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const sseEvent = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

const sseResponse = (events: string[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

const setFetchSequence = (responses: Response[]) => {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const createMcpTool = (name: string): McpTool => ({
  name,
  description: `${name} tool`,
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'string' },
    },
    required: ['value'],
  },
});

const createLocalTool = (name: string): OpenAiTool => ({
  type: 'function',
  name,
  description: `${name} tool`,
  parameters: {
    type: 'object',
    properties: {
      value: { type: 'string' },
    },
    required: ['value'],
  },
});

describe('callResponsesApiAgent (json responses)', () => {
  beforeEach(() => {
    mockedSetup.mockResolvedValue(defaultSetup());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('handles a normal response without tools', async () => {
    const fetchMock = setFetchSequence([jsonResponse(textResponse('Hello.'))]);

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('Hello.');
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cachedInputTokens: 0,
    });
  });

  it('handles a local tool call loop', async () => {
    const fetchMock = setFetchSequence([
      jsonResponse(
        toolCallResponse([
          { id: 'call-local', name: 'local_echo', args: { value: 'ping' } },
        ]),
      ),
      jsonResponse(textResponse('Local tool done.', usageMeta(1, 2, 3))),
    ]);

    const handler = vi.fn<LocalToolHandler>(async (args) => {
      const value = String(args.value ?? '');
      return `echo:${value}`;
    });

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      localTools: {
        tools: [createLocalTool('local_echo')],
        handlers: new Map<string, LocalToolHandler>([['local_echo', handler]]),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 'ping' });
    expect(result.output).toBe('Local tool done.');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      totalTokens: 6,
      cachedInputTokens: 0,
    });
  });

  it('handles an MCP tool call loop', async () => {
    const mcpTool = createMcpTool('mcp_tool');
    const mcpClient = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'mcp ok' }],
      })),
      close: vi.fn(async () => {}),
    };

    mockedSetup.mockResolvedValue({
      mcpClients: [mcpClient],
      mcpTools: [mcpTool],
      toolNameToClient: new Map([['mcp_tool', mcpClient]]),
      toolNameToServer: new Map(),
    });

    const fetchMock = setFetchSequence([
      jsonResponse(
        toolCallResponse([
          { id: 'call-mcp', name: 'mcp_tool', args: { value: 'ping' } },
        ]),
      ),
      jsonResponse(textResponse('MCP tool done.', usageMeta(1, 2, 3))),
    ]);

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      mcpServers: [{ name: 'stub', type: 'stdio', command: 'noop' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).toHaveBeenCalledWith({
      name: 'mcp_tool',
      arguments: { value: 'ping' },
    });
    expect(mcpClient.close).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('MCP tool done.');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      totalTokens: 6,
      cachedInputTokens: 0,
    });
  });

  it('handles local tools and MCP tools together', async () => {
    const mcpTool = createMcpTool('mcp_tool');
    const mcpClient = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'mcp ok' }],
      })),
      close: vi.fn(async () => {}),
    };

    mockedSetup.mockResolvedValue({
      mcpClients: [mcpClient],
      mcpTools: [mcpTool],
      toolNameToClient: new Map([['mcp_tool', mcpClient]]),
      toolNameToServer: new Map(),
    });

    const fetchMock = setFetchSequence([
      jsonResponse(
        toolCallResponse([
          { id: 'call-local', name: 'local_echo', args: { value: 'one' } },
          { id: 'call-mcp', name: 'mcp_tool', args: { value: 'two' } },
        ]),
      ),
      jsonResponse(textResponse('All tools done.', usageMeta(1, 2, 3))),
    ]);

    const handler = vi.fn<LocalToolHandler>(async (args) => {
      const value = String(args.value ?? '');
      return `echo:${value}`;
    });

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      mcpServers: [{ name: 'stub', type: 'stdio', command: 'noop' }],
      localTools: {
        tools: [createLocalTool('local_echo')],
        handlers: new Map<string, LocalToolHandler>([['local_echo', handler]]),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('All tools done.');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      totalTokens: 6,
      cachedInputTokens: 0,
    });
  });
});

describe('callResponsesApiAgent (sse responses)', () => {
  beforeEach(() => {
    mockedSetup.mockResolvedValue(defaultSetup());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('handles a normal SSE response without tools', async () => {
    const fetchMock = setFetchSequence([
      sseResponse([
        sseEvent({ type: 'response.completed', response: textResponse('Hello.') }),
        'data: [DONE]\n\n',
      ]),
    ]);

    const sseCallback = vi.fn();

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      isStream: true,
      sseCallback,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('Hello.');
    expect(sseCallback).toHaveBeenCalled();
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cachedInputTokens: 0,
    });
  });

  it('handles a local tool call loop via SSE', async () => {
    const fetchMock = setFetchSequence([
      sseResponse([
        sseEvent({
          type: 'response.completed',
          response: toolCallResponse([
            { id: 'call-local', name: 'local_echo', args: { value: 'ping' } },
          ], usageMeta(2, 1, 3)),
        }),
      ]),
      sseResponse([
        sseEvent({
          type: 'response.completed',
          response: textResponse('Local tool done.', usageMeta(1, 2, 3)),
        }),
      ]),
    ]);

    const handler = vi.fn<LocalToolHandler>(async (args) => {
      const value = String(args.value ?? '');
      return `echo:${value}`;
    });

    const sseCallback = vi.fn();

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      isStream: true,
      sseCallback,
      localTools: {
        tools: [createLocalTool('local_echo')],
        handlers: new Map<string, LocalToolHandler>([['local_echo', handler]]),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(sseCallback).toHaveBeenCalled();
    expect(result.output).toBe('Local tool done.');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      totalTokens: 6,
      cachedInputTokens: 0,
    });
  });

  it('handles an MCP tool call loop via SSE', async () => {
    const mcpTool = createMcpTool('mcp_tool');
    const mcpClient = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'mcp ok' }],
      })),
      close: vi.fn(async () => {}),
    };

    mockedSetup.mockResolvedValue({
      mcpClients: [mcpClient],
      mcpTools: [mcpTool],
      toolNameToClient: new Map([['mcp_tool', mcpClient]]),
      toolNameToServer: new Map(),
    });

    const fetchMock = setFetchSequence([
      sseResponse([
        sseEvent({
          type: 'response.completed',
          response: toolCallResponse([
            { id: 'call-mcp', name: 'mcp_tool', args: { value: 'ping' } },
          ], usageMeta(2, 1, 3)),
        }),
      ]),
      sseResponse([
        sseEvent({
          type: 'response.completed',
          response: textResponse('MCP tool done.', usageMeta(1, 2, 3)),
        }),
      ]),
    ]);

    const sseCallback = vi.fn();

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      isStream: true,
      sseCallback,
      mcpServers: [{ name: 'stub', type: 'stdio', command: 'noop' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(mcpClient.close).toHaveBeenCalledTimes(1);
    expect(sseCallback).toHaveBeenCalled();
    expect(result.output).toBe('MCP tool done.');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      totalTokens: 6,
      cachedInputTokens: 0,
    });
  });

  it('handles local tools and MCP tools together via SSE', async () => {
    const mcpTool = createMcpTool('mcp_tool');
    const mcpClient = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'mcp ok' }],
      })),
      close: vi.fn(async () => {}),
    };

    mockedSetup.mockResolvedValue({
      mcpClients: [mcpClient],
      mcpTools: [mcpTool],
      toolNameToClient: new Map([['mcp_tool', mcpClient]]),
      toolNameToServer: new Map(),
    });

    const fetchMock = setFetchSequence([
      sseResponse([
        sseEvent({
          type: 'response.completed',
          response: toolCallResponse([
            { id: 'call-local', name: 'local_echo', args: { value: 'one' } },
            { id: 'call-mcp', name: 'mcp_tool', args: { value: 'two' } },
          ], usageMeta(2, 1, 3)),
        }),
      ]),
      sseResponse([
        sseEvent({
          type: 'response.completed',
          response: textResponse('All tools done.', usageMeta(1, 2, 3)),
        }),
      ]),
    ]);

    const handler = vi.fn<LocalToolHandler>(async (args) => {
      const value = String(args.value ?? '');
      return `echo:${value}`;
    });

    const sseCallback = vi.fn();

    const result = await callResponsesApiAgent({
      model,
      apiKey,
      endpoint,
      baseInput,
      isStream: true,
      sseCallback,
      mcpServers: [{ name: 'stub', type: 'stdio', command: 'noop' }],
      localTools: {
        tools: [createLocalTool('local_echo')],
        handlers: new Map<string, LocalToolHandler>([['local_echo', handler]]),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(sseCallback).toHaveBeenCalled();
    expect(result.output).toBe('All tools done.');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      totalTokens: 6,
      cachedInputTokens: 0,
    });
  });
});
