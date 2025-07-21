import Anthropic from '@anthropic-ai/sdk';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedError,
  Message,
  MessageContent,
  TextContent,
  UsageStats,
  Tool,
} from '../../types/unified-api';
import BaseProvider from '../base-provider';
import { validateChatRequest } from '../../utils/validation';
import { ResponseFormat } from '../../response-format';

// Anthropic実装
export class AnthropicProvider extends BaseProvider {
  private client: Anthropic;
  
  constructor({ apiKey, model, tools } : { apiKey: string, model?: string, tools?: Tool[] }) {
    super({ model, tools });
    this.client = new Anthropic({ apiKey });
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);
    
    try {
      const anthropicRequest = await this.convertToAnthropicFormat(request);
      let response = await this.client.messages.create(anthropicRequest) as Anthropic.Message;
      let messages = [...anthropicRequest.messages];
      
      // stop_reason が 'tool_use' の場合、ツールを実行して結果を返す
      while (response.stop_reason === 'tool_use' && this.tools) {
        const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
        const toolResults: any[] = [];
        
        for (const toolBlock of toolUseBlocks) {
          const customFunction = this.tools.find(func => func.function.name === toolBlock.name);
          if (customFunction) {
            try {
              // CustomFunctionのargsとtool_useのinputをマージ
              const mergedArgs = {
                ...(customFunction.args || {}),
                ...(toolBlock.input as Record<string, any>)
              };
              const result = await customFunction.handler(mergedArgs);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
              });
            } catch (error) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                is_error: true,
                content: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
        
        // ツール実行結果を含めて再度リクエスト
        if (toolResults.length > 0) {
          messages = [
            ...messages,
            {
              role: 'assistant' as const,
              content: response.content,
            },
            {
              role: 'user' as const,
              content: toolResults,
            },
          ];
          
          const followUpRequest = {
            ...anthropicRequest,
            messages: messages,
          };
          
          response = await this.client.messages.create(followUpRequest) as Anthropic.Message;
        } else {
          // ツール結果がない場合はループを抜ける
          break;
        }
      }
      
      return this.convertFromAnthropicFormat(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    validateChatRequest(request);
    
    const anthropicRequest = await this.convertToAnthropicFormat(request);
    let messages = [...anthropicRequest.messages];
    
    // Keep trying to get a response until we don't get tool calls
    while (true) {
      const stream = await this.client.messages.create({
        ...anthropicRequest,
        messages,
        stream: true,
      });
      
      // Accumulate content blocks
      const contentBlocks: any[] = [];
      let stopReason: string | null = null;
      let hasToolUse = false;
      
      // First pass: detect if there are tool calls
      const allChunks: any[] = [];
      for await (const chunk of stream) {
        allChunks.push(chunk);
        
        if (chunk.type === 'content_block_start') {
          contentBlocks.push({ ...chunk.content_block });
          if (chunk.content_block.type === 'tool_use') {
            hasToolUse = true;
          }
        } else if (chunk.type === 'content_block_delta') {
          const blockIndex = chunk.index;
          if (blockIndex < contentBlocks.length) {
            const block = contentBlocks[blockIndex];
            if (block.type === 'text' && chunk.delta.type === 'text_delta') {
              block.text = (block.text || '') + chunk.delta.text;
            } else if (block.type === 'tool_use' && chunk.delta.type === 'input_json_delta') {
              // Accumulate tool input JSON
              if (!block._rawInput) block._rawInput = '';
              block._rawInput += chunk.delta.partial_json;
            }
          }
        } else if (chunk.type === 'content_block_stop') {
          const blockIndex = chunk.index;
          if (blockIndex < contentBlocks.length) {
            const block = contentBlocks[blockIndex];
            if (block.type === 'tool_use' && block._rawInput) {
              // Parse the complete tool input
              try {
                block.input = JSON.parse(block._rawInput);
                delete block._rawInput;
              } catch (_e) {
                block.input = {};
              }
            }
          }
        } else if (chunk.type === 'message_delta') {
          if (chunk.delta.stop_reason) {
            stopReason = chunk.delta.stop_reason;
          }
        }
      }
      
      // If we have tool use and tools are available, execute them
      if (stopReason === 'tool_use' && this.tools && hasToolUse) {
        const toolUseBlocks = contentBlocks.filter(block => block.type === 'tool_use');
        const toolResults: any[] = [];
        
        for (const toolBlock of toolUseBlocks) {
          const customFunction = this.tools.find(func => func.function.name === toolBlock.name);
          if (customFunction) {
            try {
              // Merge default args with tool input
              const mergedArgs = {
                ...(customFunction.args || {}),
                ...(toolBlock.input as Record<string, any>)
              };
              const result = await customFunction.handler(mergedArgs);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
              });
            } catch (error) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                is_error: true,
                content: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
        
        // Continue with tool results if we have any
        if (toolResults.length > 0) {
          // Clean up contentBlocks before sending to API
          const cleanContentBlocks = contentBlocks.map(block => {
            const cleanBlock = { ...block };
            delete cleanBlock._rawInput;
            return cleanBlock;
          });
          
          messages = [
            ...messages,
            {
              role: 'assistant' as const,
              content: cleanContentBlocks,
            },
            {
              role: 'user' as const,
              content: toolResults,
            },
          ];
          // Continue the loop to get the next response
          continue;
        }
      }
      
      // Second pass: yield chunks
      if (!hasToolUse) {
        // No tool use, stream text deltas immediately
        for (const chunk of allChunks) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            yield this.convertStreamChunk(chunk);
          }
        }
      } else {
        // Tool use was executed, now stream the final response
        // Convert accumulated content blocks to streaming format
        for (const block of contentBlocks) {
          if (block.type === 'text' && block.text) {
            // Simulate text streaming
            const text = block.text;
            const chunkSize = 20; // Approximate chunk size
            for (let i = 0; i < text.length; i += chunkSize) {
              const chunkText = text.slice(i, Math.min(i + chunkSize, text.length));
              yield {
                id: this.generateMessageId(),
                model: this.model || 'claude-3-5-haiku-latest',
                provider: 'anthropic',
                message: {
                  id: this.generateMessageId(),
                  role: 'assistant',
                  content: [{ type: 'text', text: chunkText }],
                  created_at: new Date(),
                },
                text: chunkText,
                created_at: new Date(),
                raw_response: null,
              };
            }
          }
        }
      }
      
      break;
    }
  }
  
  private async convertToAnthropicFormat(request: UnifiedChatRequest): Promise<Anthropic.MessageCreateParams> {
    if (!request.model && !this.model) {
      throw new Error('Model is required for Anthropic requests');
    }

    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');
    
    let messages = await Promise.all(otherMessages.map(async msg => {
      const content = this.normalizeContent(msg.content);
      
      const anthropicContent = await Promise.all(content.map(async c => {
        switch (c.type) {
          case 'text':
            return { type: 'text' as const, text: c.text };
          case 'image':
            return {
              type: 'image' as const,
              source: {
                type: (c.source.url ? 'url' : 'base64') as any,
                media_type: c.source.media_type || 'image/jpeg',
                data: c.source.data,
                url: c.source.url,
              },
            };
          case 'tool_use': {
            // customFunctionsからツールを検索して実行
            const customFunction = this.tools?.find(func => func.function.name === c.name);
            if (customFunction) {
              try {
                // CustomFunctionのargsとtool_useのinputをマージ
                const mergedArgs = {
                  ...(customFunction.args || {}),
                  ...c.input
                };
                const result = await customFunction.handler(mergedArgs);
                return {
                  type: 'tool_result' as const,
                  tool_use_id: c.id,
                  is_error: false,
                  content: [{
                    type: 'text' as const,
                    text: typeof result === 'string' ? result : JSON.stringify(result),
                  }],
                };
              } catch (error) {
                return {
                  type: 'tool_result' as const,
                  tool_use_id: c.id,
                  is_error: true,
                  content: [{
                    type: 'text' as const,
                    text: error instanceof Error ? error.message : 'Unknown error',
                  }],
                };
              }
            }
            return {
              type: 'tool_use' as const,
              id: c.id,
              name: c.name,
              input: c.input,
            };
          }
          case 'tool_result':
            return {
              type: 'tool_result' as const,
              tool_use_id: c.tool_use_id,
              is_error: c.is_error,
              content: c.content?.map(tc => ({
                type: 'text' as const,
                text: tc.type === 'text' ? tc.text : '[Unsupported content]',
              })) || [],
            };
          default:
            return { type: 'text' as const, text: '[Unsupported content type]' };
        }
      }));
      
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: anthropicContent as any,
      };
    }));

    // Handle response_format for Anthropic
    if (request.generation_config?.response_format instanceof ResponseFormat) {
      messages = request.generation_config.response_format.addRequestSuffix(messages);
    }

    // toolsの結合: request.toolsとcustomFunctionsを統合
    const tools = [
      ...(request.tools?.map(tool => ({
        name: tool.function.name,
        description: tool.function.description || '',
        input_schema: {
          type: 'object' as const,
          ...tool.function.parameters || {},
        },
      })) || []),
      ...(this.tools ? this.tools.map((func: Tool) => ({
        name: func.function.name,
        description: func.function.description || '',
        input_schema: {
          type: 'object' as const,
          ...func.function.parameters || {},
        },
      })) : []),
    ];
    
    return {
      model: request.model || this.model as Anthropic.Model,
      messages: messages as any,
      system: systemMessage ? this.extractTextFromContent(systemMessage.content) : undefined,
      max_tokens: request.generation_config?.max_tokens || 4096,
      temperature: request.generation_config?.temperature,
      top_p: request.generation_config?.top_p,
      top_k: request.generation_config?.top_k,
      stop_sequences: request.generation_config?.stop_sequences,
      tools: tools.length > 0 ? tools : undefined,
    };
  }
  
  private convertFromAnthropicFormat(response: Anthropic.Message): UnifiedChatResponse {
    const content: MessageContent[] = response.content.map(block => {
      switch (block.type) {
        case 'text':
          return { type: 'text' as const, text: block.text };
        case 'tool_use':
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, any>,
          };
        default:
          return { type: 'text' as const, text: '[Unknown content type]' };
      }
    });
    
    const unifiedMessage: Message = {
      id: response.id,
      role: response.role,
      content,
      created_at: new Date(),
    };
    
    const usage: UsageStats = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    };
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: response.id,
      model: response.model,
      provider: 'anthropic',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      usage,
      finish_reason: response.stop_reason as any,
      created_at: new Date(),
      raw_response: response,
    };
  }
  
  private convertStreamChunk(chunk: any): UnifiedChatResponse {
    if (!this.model) {
      throw new Error('Model is required for streaming responses');
    }

    const content: MessageContent[] = [{
      type: 'text',
      text: chunk.delta.text,
    }];
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: 'assistant',
      content,
      created_at: new Date(),
    };
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: this.generateMessageId(),
      model: this.model,
      provider: 'anthropic',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      created_at: new Date(),
      raw_response: chunk,
    };
  }
  
  private extractTextFromContent(content: MessageContent[] | string): string {
    if (typeof content === 'string') return content;
    
    const textContent = content.find(c => c.type === 'text') as TextContent | undefined;
    return textContent?.text || '';
  }
  
  private handleError(error: any): UnifiedError {
    if (error instanceof Anthropic.APIError) {
      const errorBody = error.error?.error;
      return {
        code: errorBody?.type || 'anthropic_error',
        message: errorBody?.message || error.message,
        type: this.mapErrorType(error.status),
        status_code: error.status,
        provider: 'anthropic',
        details: error,
      };
    }
    
    return {
      code: 'unknown_error',
      message: error.message || 'Unknown error occurred',
      type: 'api_error',
      provider: 'anthropic',
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
