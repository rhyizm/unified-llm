import OpenAI from 'openai';
import {
  Agent,
  run,
  user,
  assistant,
  tool as agentsTool,
  MCPServerStdio,
  MCPServerSSE,
  MCPServerStreamableHttp,
  OpenAIResponsesModel,
  OpenAIChatCompletionsModel,
} from '@openai/agents';

import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamEventResponse,
  UnifiedError,
  Message,
  MessageContent,
  BaseContent,
  TextContent,
  UsageStats,
  Tool as UnifiedTool,
} from '../../types/unified-api';
import { MCPServerConfig } from '../../types/mcp';
import { validateChatRequest } from '../../utils/validation';
import { validateOpenAILogLevel } from '../../validators';
import BaseProvider from '../base-provider';
import { normalizeToolParametersForAgents } from '../../utils/tool-schema';

type OpenAIAPI = 'responses' | 'chat_completions';

// MCP server union type for convenience
type MCPServer = MCPServerStdio | MCPServerSSE | MCPServerStreamableHttp;

export class OpenAIAgentProvider extends BaseProvider {
  private mcpServerConfigs?: MCPServerConfig[];
  private providerTools: UnifiedTool[];
  private openaiClient?: OpenAI;
  private openaiApi: OpenAIAPI;

  constructor({
    apiKey,
    client,
    model,
    tools = [],
    mcpServers,
    openaiApi = 'responses',
    logLevel = 'warn',
  }: {
    apiKey?: string;
    client?: OpenAI;
    model?: string;
    tools?: UnifiedTool[];
    mcpServers?: MCPServerConfig[];
    openaiApi?: OpenAIAPI;
    logLevel?: string;
  }) {
    super({ model, tools });
    
    // Validate log level
    const validatedLogLevel = validateOpenAILogLevel(logLevel);
    
    // The agents SDK picks up OPENAI_LOG from env as well
    if (validatedLogLevel) {
      process.env.OPENAI_LOG = validatedLogLevel;
    }

    // Do not touch global client/key; inject per-agent model instead
    this.openaiClient = client ?? (apiKey ? new OpenAI({ apiKey }) : undefined);
    this.mcpServerConfigs = mcpServers;
    this.providerTools = tools ?? [];
    this.openaiApi = openaiApi;
  }

  // --- Public API -----------------------------------------------------------

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);

    const { agent, cleanup, effectiveModel } = await this.buildEphemeralAgent(request);

    const inputs = this.toAgentInputs(request.messages);

    const ac = new AbortController();
    try {
      const result = await run(agent, inputs, { signal: ac.signal });
      const unified = this.convertAgentResultToUnified(result);
      if (!unified.model) {
        unified.model = effectiveModel;
      }

      return unified;
    } catch (error) {
      throw this.handleError(error);
    } finally {
      try {
        ac.abort();
      } catch (e) {
        void e;
      }
      await cleanup();
    }
  }

  /**
   * Streaming: emits chunk responses as they arrive, then a final, fully-unified message.
   */
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    validateChatRequest(request);

    const { agent, cleanup, effectiveModel } = await this.buildEphemeralAgent(request);

    const inputs = this.toAgentInputs(request.messages);

    const ac = new AbortController();

    try {
      const streamed = await run(agent, inputs, { stream: true, signal: ac.signal });
      const textStream = streamed.toTextStream({ compatibleWithNodeStreams: true });

      let fullText = '';
      // Start event
      yield {
        id: this.generateMessageId(),
        model: effectiveModel,
        provider: 'openai',
        message: { id: this.generateMessageId(), role: 'assistant', content: [], createdAt: new Date() },
        text: '',
        createdAt: new Date(),
        rawResponse: streamed,
        eventType: 'start',
        outputIndex: 0,
      } satisfies UnifiedStreamEventResponse;
      try {
        for await (const chunk of textStream) {
          const textChunk = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8') ?? '';
          if (!textChunk) continue;
          fullText += textChunk;

          const ev: UnifiedStreamEventResponse = {
            id: this.generateMessageId(),
            model: effectiveModel,
            provider: 'openai',
            message: { id: this.generateMessageId(), role: 'assistant', content: [{ type: 'text', text: textChunk }], createdAt: new Date() },
            text: fullText,
            createdAt: new Date(),
            rawResponse: streamed,
            eventType: 'text_delta',
            outputIndex: 0,
            delta: { type: 'text', text: textChunk },
          };
          yield ev;
        }
      } finally {
        try {
          if (typeof textStream?.destroy === 'function') {
            textStream.destroy();
          }
        } catch (e) {
          void e;
        }
      }

      const completed = await streamed.completed;
      // Stop event
      yield {
        id: this.generateMessageId(),
        model: effectiveModel,
        provider: 'openai',
        message: { id: this.generateMessageId(), role: 'assistant', content: fullText ? [{ type: 'text', text: fullText }] : [], createdAt: new Date() },
        text: fullText,
        createdAt: new Date(),
        rawResponse: completed,
        eventType: 'stop',
        outputIndex: 0,
      } satisfies UnifiedStreamEventResponse;
    } finally {
      try {
        ac.abort();
      } catch (e) {
        void e;
      }
      await cleanup();
    }
  }

  // --- Agent setup / lifecycle --------------------------------------------

  private async buildEphemeralAgent(request: UnifiedChatRequest): Promise<{
    agent: Agent;
    servers: MCPServer[];
    cleanup: () => Promise<void>;
    effectiveModel: string;
  }> {
    if (!request.model && !this.model) {
      throw new Error('Model must be specified either in provider or request');
    }

    const servers = await this.initMCPServers();

    // Construct system messages as instructions
    const systemText = this.collectSystemText(request.messages) || 'You are a helpful assistant.';
    const effectiveModel = request.model ?? this.model ?? 'gpt-4o-mini';

    // Build model instance with injected client when available (no global state)
    let modelInstance: any;
    if (this.openaiClient) {
      modelInstance = this.openaiApi === 'responses'
        ? new OpenAIResponsesModel(this.openaiClient, effectiveModel)
        : new OpenAIChatCompletionsModel(this.openaiClient, effectiveModel);
    } else {
      // Explicitly use the default client resolution path when no client provided
      modelInstance = effectiveModel;
    }
    // Safety check: if a client was provided but we still ended up with a string model
    if (this.openaiClient && typeof modelInstance === 'string') {
      throw new Error('Failed to construct OpenAI model with injected client. Ensure @openai/agents exports the model classes.');
    }

    const agent = new Agent({
      name: 'Assistant',
      instructions: systemText,
      mcpServers: servers.length ? servers : undefined,
      model: modelInstance as any,
      tools: this.adaptFunctionTools(this.providerTools),
    });

    const cleanup = async () => {
      await this.closeMCPServers(servers);
    };

    return { agent, servers, cleanup, effectiveModel };
  }

  private async initMCPServers(): Promise<MCPServer[]> {
    const servers: MCPServer[] = [];
    if (!this.mcpServerConfigs?.length) return servers;

    for (const config of this.mcpServerConfigs) {
      let server: MCPServer | undefined;
      try {
        switch (config.type) {
          case 'stdio': {
            if (!('command' in config) || !config.command)
              throw new Error('Command is required for stdio MCP server');
            server = new MCPServerStdio({
              name: config.name,
              command: config.command,
              args: config.args || [],
              env: config.env,
            });
            await server.connect();
            break;
          }
          case 'sse': {
            if (!('url' in config) || !config.url) {
              throw new Error('URL is required for SSE MCP server');
            }
            server = new MCPServerSSE({
              name: config.name,
              url: config.url,
              requestInit: config.headers ? { headers: config.headers } : undefined,
            });
            await server.connect();
            break;
          }
          case 'streamable_http': {
            if (!('url' in config) || !config.url) {
              throw new Error('URL is required for Streamable HTTP MCP server');
            }
            server = new MCPServerStreamableHttp({
              name: config.name,
              url: config.url,
              requestInit: config.headers ? { headers: config.headers } : undefined,
            });
            await server.connect();
            break;
          }
          default:
            // eslint-disable-next-line no-console
            console.warn(`Unknown MCP server type: ${config.type}`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Failed to initialize MCP server ${config.name}:`, err);
        server = undefined;
      }
      if (server) servers.push(server);
    }

    return servers;
  }

  private async closeMCPServers(servers: MCPServer[]): Promise<void> {
    await Promise.allSettled(
      servers.map(async (srv: any) => {
        try {
          if (typeof srv.close === 'function') {
            await srv.close();
          } else if (typeof srv.cleanup === 'function') {
            await srv.cleanup();
          } else if (typeof srv.disconnect === 'function') {
            await srv.disconnect();
          }
        } catch (e) {
          void e;
        }
      })
    );
  }

  // --- I/O adapters ---------------------------------------------------------

  private toAgentInputs(messages: Message[]): any[] {
    const items: any[] = [];
    for (const m of messages) {
      const text = this.extractTextFromContent(m.content);
      if (!text) continue;
      if (m.role === 'system') {
        // system は instructions に既に反映しているので通常は入れない
        continue;
      } else if (m.role === 'user') {
        items.push(user(text));
      } else if (m.role === 'assistant') {
        items.push(assistant(text));
      } else {
        // tool/function/developer はフォールバックで user として扱う
        items.push(user(text));
      }
    }
    return items;
  }

  private collectSystemText(messages: Message[]): string {
    return messages
      .filter((m) => m.role === 'system')
      .map((m) => this.extractTextFromContent(m.content))
      .filter(Boolean)
      .join('\n\n');
  }

  private adaptFunctionTools(tools: UnifiedTool[] | undefined): any[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t, idx) => {
      const name =
        (t.function?.name && String(t.function.name)) ||
        (t.handler && t.handler.name) ||
        `tool_${idx + 1}`;
      // Normalize tool parameters per Agents API schema requirements
      const parameters = normalizeToolParametersForAgents(t.function?.parameters as any);
      
      return agentsTool({
        name,
        description: t.function?.description ?? '',
        parameters,
        async execute(args: Record<string, unknown>) {
          const res = await t.handler(args);
          if (res == null) return '';
          return typeof res === 'string' ? res : JSON.stringify(res);
        },
      });
    });
  }

  private extractTextFromContent(content: MessageContent[] | string | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    const chunks: string[] = [];
    for (const c of content) {
      if ((c as TextContent).type === 'text' && typeof (c as TextContent).text === 'string') {
        chunks.push((c as TextContent).text);
      }
    }
    return chunks.join('\n');
  }

  // --- Unified response conversion -----------------------------------------

  private convertAgentResultToUnified(result: any): UnifiedChatResponse {
    const { text, messageContent, model, usage } = this.extractUnifiedPayload(result);

    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: 'assistant',
      content: messageContent,
      createdAt: new Date(),
    };

    return {
      id: this.generateMessageId(),
      model,
      provider: 'openai',
      message: unifiedMessage,
      text,
      usage,
      finish_reason: 'stop',
      createdAt: new Date(),
      rawResponse: result,
    };
  }

  /**
   * Extracts top-level `text`, `message.content` (formatted as BaseContent),
   * `model`, and `usage` from either RunResult or StreamedRunResult.
   * - Uses `state.generatedItems` for content extraction
   * - Uses `state.context.usage` for usage stats
   */
  private extractUnifiedPayload(result: any): {
    text: string;
    messageContent: MessageContent[];
    model: string;
    usage?: UsageStats;
  } {
    let usage: UsageStats | undefined;
    let messageContent: MessageContent[] = [];
    let text = '';

    const state =
      result?.state?.toJSON
        ? result.state.toJSON()
        : JSON.parse(JSON.stringify(result?.state ?? {}));
    const generatedItems = state?.generatedItems;

    const model = state?.lastModelResponse?.providerData?.model || '';

    // Extract content from generatedItems
    if (Array.isArray(generatedItems)) {
      for (const item of generatedItems) {
        if (item.rawItem) {
          const rawItem = item.rawItem;
          
          // Process content array if available (for message_output_item)
          if (Array.isArray(rawItem.content)) {
            for (const contentItem of rawItem.content) {
              // Handle text content types (output_text, text, etc.)
              if (contentItem.type && typeof contentItem.text === 'string') {
                const textContent: BaseContent = {
                  type: 'text',
                  text: contentItem.text,
                  role: 'assistant'
                };
                messageContent.push(textContent as MessageContent);
                
                // Only set text if this is output_text (final message)
                if (contentItem.type === 'output_text') {
                  text = contentItem.text;
                }
              }
            }
          }
          
          // Process output if available (for tool calls, function results, etc.)
          if (rawItem.output && rawItem.output.type === 'text' && typeof rawItem.output.text === 'string') {
            const textContent: BaseContent = {
              type: 'text',
              text: rawItem.output.text,
              role: 'tool'
            };
            messageContent.push(textContent as MessageContent);
          }
        }
      }
    }

    // Get usage from state.context.usage
    if (state?.context?.usage) {
      const contextUsage = state.context.usage;
      usage = {
        inputTokens: contextUsage.inputTokens ?? 0,
        outputTokens: contextUsage.outputTokens ?? 0,
        totalTokens: contextUsage.totalTokens ?? 0,
      };
    }

    // Secondary path: result.output (fallback for compatibility)
    if (messageContent.length === 0 && Array.isArray(result?.output)) {
      for (const outputItem of result.output) {
        if (Array.isArray(outputItem?.content)) {
          for (const contentItem of outputItem.content) {
            if (typeof contentItem?.text === 'string') {
              const textContent: BaseContent = {
                type: 'text',
                text: contentItem.text,
                role: 'assistant'
              };
              messageContent.push(textContent as MessageContent);
              text += contentItem.text;
            }
          }
        }
      }
    }

    // Fallback: parse from lastProcessedResponse.newItems if still no content
    if (messageContent.length === 0) {
      const items = state?.lastProcessedResponse?.newItems;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.type === 'message_output_item' && Array.isArray(item.rawItem?.content)) {
            for (const contentItem of item.rawItem.content) {
              if (typeof contentItem?.text === 'string') {
                const textContent: BaseContent = {
                  type: 'text',
                  text: contentItem.text,
                  role: 'assistant'
                };
                messageContent.push(textContent as MessageContent);
                text += contentItem.text;
              }
            }
          }
        }
      }
    }

    // Ensure message.content is not empty when we have text
    if (messageContent.length === 0 && text) {
      const fallbackContent: BaseContent = { type: 'text', text, role: 'assistant' };
      messageContent = [fallbackContent as MessageContent];
    }

    return { text, messageContent, model, usage };
  }

  // --- Error handling -------------------------------------------------------

  private handleError(error: unknown): Error {
    if (error instanceof OpenAI.APIError) {
      const e = new Error(error.message);
      (e as any).statusCode = error.status;
      (e as any).code = error.code || 'openai_error';
      (e as any).type = this.mapErrorType(error.status);
      (e as any).provider = 'openai';
      (e as any).details = error;
      return e;
    }

    if (error instanceof Error) return error;
    return new Error('Unknown error occurred');
  }

  private mapErrorType(status?: number): UnifiedError['type'] {
    if (!status) return 'api_error';
    if (status === 429) return 'rate_limit';
    if (status === 401) return 'authentication';
    if (status >= 400 && status < 500) return 'invalid_request';
    if (status >= 500) return 'server_error';
    return 'api_error';
  }
}
