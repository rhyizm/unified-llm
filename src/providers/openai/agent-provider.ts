import OpenAI from 'openai';
import {
  Agent,
  run,
  MCPServerStdio,
  MCPServerSSE,
  MCPServerStreamableHttp,
  setDefaultOpenAIKey,
} from '@openai/agents';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedError,
  Message,
  MessageContent,
  BaseContent,
  UsageStats,
  Tool,
} from '../../types/unified-api';
import { MCPServerConfig } from '../../types/mcp';
import { validateChatRequest } from '../../utils/validation';
import BaseProvider from '../base-provider';

// MCP server configuration types
type MCPServer = MCPServerStdio | MCPServerSSE | MCPServerStreamableHttp;

export class OpenAIAgentProvider extends BaseProvider {
  private agent?: Agent;
  protected mcpServers: MCPServer[] = [];
  private mcpServerConfigs?: MCPServerConfig[];
  private mcpServersInitialized = false;

  constructor({
    apiKey,
    model,
    tools,
    mcpServers,
  }: {
    apiKey: string;
    model?: string;
    tools?: Tool[];
    mcpServers?: MCPServerConfig[];
  }) {
    super({ model: model, tools });

    // Use the provided API key for the Agent SDK
    setDefaultOpenAIKey(apiKey);

    // Store MCP server configs for lazy initialization
    this.mcpServerConfigs = mcpServers;
  }

  private async ensureMCPServersInitialized(): Promise<void> {
    if (this.mcpServersInitialized || !this.mcpServerConfigs) return;

    for (const config of this.mcpServerConfigs) {
      try {
        let server: MCPServer;

        switch (config.type) {
          case 'stdio': {
            if (!config.command) {
              throw new Error('Command is required for stdio MCP server');
            }
            server = new MCPServerStdio({
              name: config.name,
              command: config.command,
              args: config.args || [],
              env: config.env,
            });
            await (server as any).connect();
            break;
          }

          case 'sse': {
            if (!config.url) {
              throw new Error('URL is required for SSE MCP server');
            }
            server = new MCPServerSSE({
              name: config.name,
              url: config.url,
              requestInit: config.headers ? { headers: config.headers } : undefined,
            });
            await (server as any).connect();
            break;
          }

          case 'streamable_http': {
            if (!config.url) {
              throw new Error('URL is required for Streamable HTTP MCP server');
            }
            // Do NOT auto-append `/mcp`; expect the caller to pass the full URL they want.
            const httpUrl = config.url;
            server = new MCPServerStreamableHttp({
              name: config.name,
              url: httpUrl,
              requestInit: config.headers ? { headers: config.headers } : undefined,
            });
            await (server as any).connect();
            break;
          }

          default:
            console.warn(`Unknown MCP server type: ${(config as any).type}`);
            continue;
        }

        this.mcpServers.push(server);
      } catch (error) {
        console.error(`Failed to initialize MCP server ${config.name}:`, error);
      }
    }

    this.mcpServersInitialized = true;
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);

    try {
      // Ensure MCP servers are ready
      await this.ensureMCPServersInitialized();

      // Create the agent once and reuse it
      if (!this.agent) {
        this.agent = await this.createAgent(request);
      }

      // Convert the last user message into the Agent SDK input
      const latestMessage = request.messages[request.messages.length - 1];
      const content = this.normalizeContent(latestMessage.content);
      const textContent = content.find((c) => c.type === 'text');
      const input = textContent?.text || 'Please continue.';

      // Run the agent (non-streaming)
      const result = await run(this.agent, input);

      // Map to UnifiedChatResponse
      return this.convertAgentResultToUnified(result as any);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async createAgent(request: UnifiedChatRequest): Promise<Agent> {
    // Extract a system message to use as the agent's instructions
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const instructions = systemMessage
      ? this.extractTextFromContent(systemMessage.content)
      : 'You are a helpful assistant.';

    // Instantiate the Agent. Tools (if any) can be added here or later as needed.
    return new Agent({
      name: 'Assistant',
      instructions,
      mcpServers: this.mcpServers.length > 0 ? this.mcpServers : undefined,
      model: request.model || this.model || 'gpt-4o',
    } as any);
  }

  private convertAgentResultToUnified(result: any): UnifiedChatResponse {
    // JSON serialize/deserialize to convert _generatedItems to generatedItems
    // Check if result exists to avoid JSON parsing issues
    const serializedResult = result ? JSON.parse(JSON.stringify(result)) : result;
    const { text, messageContent, model, usage } = this.extractUnifiedPayload(serializedResult);

    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: 'assistant',
      content: messageContent as any,
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

  private extractTextFromContent(content: MessageContent[] | string): string {
    if (typeof content === 'string') return content;
    const textContent = content.find((c) => c.type === 'text');
    return textContent?.text || '';
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
    if (!this.model) {
      throw new Error('Model is not defined in provider configuration.');
    }

    const model = this.model;
    let usage: UsageStats | undefined;
    let messageContent: MessageContent[] = [];
    let text = '';

    const state = result?.state;
    const generatedItems = state?.generatedItems;

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

  /**
   * Streaming: emits chunk responses as they arrive, then a final, fully-unified message.
   * - Chunk yields contain only the incremental text in `message.content` and `text`.
   * - The final yield uses the completed RunResult to preserve the same shape as `chat()`.
   *
   * Per the Agents SDK, `run(..., { stream: true })` returns a StreamedRunResult with:
   *   - `toTextStream()` for incremental text
   *   - `completed` (a Promise) that resolves when the run is finished
   */
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    validateChatRequest(request);

    await this.ensureMCPServersInitialized();
    if (!this.agent) this.agent = await this.createAgent(request);

    const latestMessage = request.messages[request.messages.length - 1];
    const normalized = this.normalizeContent(latestMessage.content);
    const input = normalized.find((c) => c.type === 'text')?.text || 'Please continue.';

    // Start the streaming run
    const streamed = await run(this.agent, input, { stream: true });

    // Stream text chunks as they arrive
    const textStream: any = streamed.toTextStream({ compatibleWithNodeStreams: true });
    let fullText = '';
    for await (const chunk of textStream) {
      const textChunk = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8') ?? '';
      if (!textChunk) continue;
      fullText += textChunk;

      const msg: Message = {
        id: this.generateMessageId(),
        role: 'assistant',
        content: [{ type: 'text', text: textChunk }],
        createdAt: new Date(),
      };

      yield {
        id: this.generateMessageId(),
        model: this.model || 'gpt-4o',
        provider: 'openai',
        message: msg,
        text: textChunk,
        createdAt: new Date(),
        // For chunk events, exposing the stream handle is acceptable
        rawResponse: streamed,
      };
    }

    // Wait until the run is fully complete (no more outputs/callbacks)
    const completed = await streamed.completed;

    // Build the final unified message from the COMPLETED run result (not the stream handle)
    const finalUnified = this.convertAgentResultToUnified(completed);
    finalUnified.finish_reason = 'stop';
    if (fullText && !finalUnified.text) finalUnified.text = fullText;

    // Prefer the completed RunResult as the raw payload for the final message
    finalUnified.rawResponse = completed;

    yield finalUnified;
  }

  private handleError(error: unknown): UnifiedError {
    if (error instanceof OpenAI.APIError) {
      return {
        code: error.code || 'openai_error',
        message: error.message,
        type: this.mapErrorType(error.status),
        statusCode: error.status,
        provider: 'openai',
        details: error,
      };
    }

    return {
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      type: 'api_error',
      provider: 'openai',
      details: error,
    };
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
