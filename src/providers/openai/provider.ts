import OpenAI from 'openai';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  Tool,
} from '../../types/unified-api';
import { MCPServerConfig } from '../../types/mcp';
import BaseProvider from '../base-provider';
import { OpenAIAgentProvider } from './agent-provider';
import { OpenAICompletionProvider } from './completion-provider';
import { OpenAIResponsesProvider } from './responses-provider';

export class OpenAIProvider extends BaseProvider {
  private provider: BaseProvider;

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
      // Build a per-provider OpenAI client to inject into the Agents SDK
      const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
      this.provider = new OpenAIAgentProvider({
        client,
        model: options.model,
        tools: options.tools,
        mcpServers: options.mcpServers,
        // Default to Responses API for Agents; can be extended to be configurable
        openaiApi: 'responses',
        logLevel: options.logLevel,
      });
    } else {
      if (options.options?.useResponsesAPI) {
        this.provider = new OpenAIResponsesProvider({
          apiKey: options.apiKey,
          model: options.model,
          baseURL: options.baseURL,
          tools: options.tools,
          logLevel: options.logLevel,
        });
      } else {
        this.provider = new OpenAICompletionProvider({
          apiKey: options.apiKey,
          model: options.model,
          baseURL: options.baseURL,
          tools: options.tools,
          logLevel: options.logLevel,
        });
      }
    }
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    return this.provider.chat(request);
  }

  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    yield* this.provider.stream(request);
  }
}
