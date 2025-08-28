import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  Tool,
} from '../../types/unified-api';
import { MCPServerConfig } from '../../types/mcp';
import BaseProvider from '../base-provider';
import { OpenAIAgentProvider } from './agent-provider';
import { OpenAICompletionProvider } from './completion-provider';

export class OpenAIProvider extends BaseProvider {
  private provider: OpenAIAgentProvider | OpenAICompletionProvider;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseURL?: string;
    tools?: Tool[];
    mcpServers?: MCPServerConfig[];
    options?: { useResponsesAPI?: boolean };
    logLevel?: string;
  }) {
    super({ model: options.model, tools: options.tools });
    
    if (options.mcpServers) {
      this.provider = new OpenAIAgentProvider({
        apiKey: options.apiKey,
        model: options.model,
        tools: options.tools,
        mcpServers: options.mcpServers,
        logLevel: options.logLevel,
      });
    } else {
      this.provider = new OpenAICompletionProvider({
        apiKey: options.apiKey,
        model: options.model,
        baseURL: options.baseURL,
        tools: options.tools,
        options: options.options,
        logLevel: options.logLevel,
      });
    }
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    return this.provider.chat(request);
  }

  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    yield* this.provider.stream(request);
  }
}