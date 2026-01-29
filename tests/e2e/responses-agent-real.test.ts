import { describe, it, expect } from 'vitest';
import { callResponsesApiAgent } from '../../src/providers/openai/responses-api-agent.js';
import type { OpenAiTool } from '../../src/utils/mcp/mcp-tool-catalog.js';
import type { LocalToolHandler } from '../../src/utils/tools/execute-tool-calls.js';

const apiKey = process.env.OPENAI_API_KEY;
const playwrightMcpServerUrl = process.env.PLAYWRIGHT_MCP_SERVER_URL;
const mcpTestUrl = process.env.PLAYWRIGHT_MCP_TEST_URL ?? 'https://www.uuidgenerator.net/';
const uuidRegex =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

const endpoint = process.env.OPENAI_RESPONSES_ENDPOINT ?? 'https://api.openai.com/v1/responses';
const model = process.env.OPENAI_RESPONSES_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const streamModes = [
  {
    label: 'json',
    isStream: false,
  },
  {
    label: 'sse',
    isStream: true,
  },
] as const;

const saveRecordTool: OpenAiTool = {
  type: 'function',
  name: 'save_record',
  description: 'Store a record in a mock database.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
};

const createDbHandler = (store: Array<{ key: string; value: string }>) => {
  const handler: LocalToolHandler = async (args) => {
    const key = String(args.key ?? '');
    const value = String(args.value ?? '');
    store.push({ key, value });
    return { ok: true, stored: { key, value } };
  };
  return handler;
};

const runIfApiKey = apiKey ? describe : describe.skip;

runIfApiKey('Responses API Agent (real API)', () => {
  streamModes.forEach(({ label, isStream }) => {
    describe(label, () => {
      it('handles a normal call', async () => {
        const response = await callResponsesApiAgent({
          endpoint,
          model,
          apiKey,
          baseInput: [
            {
              role: 'user',
              content: 'Say hello in one short sentence.',
            },
          ],
          isStream,
        });

        expect(typeof response.output).toBe('string');
        expect(String(response.output).length).toBeGreaterThan(0);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      }, 60000);

      it('handles a local tool call (mock DB save)', async () => {
        const db: Array<{ key: string; value: string }> = [];
        const handler = createDbHandler(db);

        const response = await callResponsesApiAgent({
          endpoint,
          model,
          apiKey,
          baseInput: [
            {
              role: 'user',
              content:
                'Use the save_record tool to store key="alpha" and value="bravo". After calling the tool, reply with "saved".',
            },
          ],
          localTools: {
            tools: [saveRecordTool],
            handlers: new Map<string, LocalToolHandler>([
              ['save_record', handler],
            ]),
          },
          isStream,
        });

        expect(db).toEqual([{ key: 'alpha', value: 'bravo' }]);
        expect(String(response.output).toLowerCase()).toContain('saved');
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      }, 60000);

      const runIfMcp = playwrightMcpServerUrl ? it : it.skip;

      runIfMcp('handles an MCP tool call', async () => {
        const response = await callResponsesApiAgent({
          endpoint,
          model,
          apiKey,
          baseInput: [
            {
              role: 'user',
              content: [
                'Use the MCP browser tools to open the page at this URL:',
                mcpTestUrl,
                'Read a UUID from the page and reply with the UUID only.',
              ].join(' '),
            },
          ],
          mcpServers: [
            {
              name: 'Playwright MCP',
              type: 'streamable_http',
              url: playwrightMcpServerUrl,
              allowedTools: [
                'browser_install',
                'browser_navigate',
                'browser_snapshot',
              ],
            },
          ],
          isStream,
        });

        const outputText = String(response.output);
        expect(outputText).toMatch(uuidRegex);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      }, 60000);

      runIfMcp('handles local tools + MCP tools together', async () => {
        const db: Array<{ key: string; value: string }> = [];
        const handler: LocalToolHandler = async (args) => {
          const key = String(args.key ?? '');
          const value = String(args.value ?? '');
          db.push({ key, value });
          console.log('responses.mcp.local_tool.call', { key, value, count: db.length });
          return { ok: true, stored: { key, value } };
        };

        const response = await callResponsesApiAgent({
          endpoint,
          model,
          apiKey,
          baseInput: [
            {
              role: 'user',
              content: [
                'Use MCP browser tools to open the page at this URL:',
                mcpTestUrl,
                'Extract a UUID from the page.',
                'Then call save_record with key="mcp_uuid" and value set to that UUID.',
                'Finally, reply with the UUID only.',
              ].join(' '),
            },
          ],
          localTools: {
            tools: [saveRecordTool],
            handlers: new Map<string, LocalToolHandler>([
              ['save_record', handler],
            ]),
          },
          mcpServers: [
            {
              name: 'Playwright MCP',
              type: 'streamable_http',
              url: playwrightMcpServerUrl,
              allowedTools: [
                'browser_install',
                'browser_navigate',
                'browser_snapshot',
              ],
            },
          ],
          isStream,
        });

        console.log('responses.mcp.local_tool.db', db);
        console.log('responses.mcp.local_tool.output', response.output);
        expect(db.length).toBe(1);
        expect(db[0]?.key).toBe('mcp_uuid');
        const savedValue = String(db[0]?.value ?? '');
        expect(savedValue).toMatch(uuidRegex);
        const outputText = String(response.output);
        expect(outputText).toMatch(uuidRegex);
        expect(outputText).toBe(savedValue);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      }, 60000);
    });
  });
});
