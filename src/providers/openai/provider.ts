import OpenAI from 'openai';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedError,
  Message,
  MessageContent,
  UsageStats,
  Tool,
} from '../../types/unified-api';
import { validateChatRequest } from '../../utils/validation';
import BaseProvider from '../base-provider';
import { ResponseFormat } from '../../response-format';

export class OpenAIProvider extends BaseProvider {
  protected client: OpenAI;
  private apiKey: string;
  private useResponsesAPI: boolean;
  
  constructor({ apiKey, model, tools, options }: { 
    apiKey: string, 
    model?: string, 
    tools?: Tool[],
    options?: { useResponsesAPI?: boolean }
  }) {
    super({ model: model, tools });
    this.apiKey = apiKey;
    this.useResponsesAPI = options?.useResponsesAPI || false;
    this.client = new OpenAI({ apiKey });
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);
    
    try {
      if (this.useResponsesAPI) {
        return this.chatWithResponsesAPI(request);
      } else {
        return this.chatWithChatCompletions(request);
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }
  
  private async chatWithChatCompletions(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    if (!request.model && !this.model) {
      throw new Error('Model is required for OpenAI chat completions');
    }
    const openAIRequest = this.convertToOpenAIFormat(request);
    let response = await this.client.chat.completions.create(openAIRequest) as OpenAI.ChatCompletion;
    let messages = [...openAIRequest.messages];
    
    // ツール呼び出しがある場合、実行して結果を返す
    while (response.choices[0].finish_reason === 'tool_calls' && this.tools) {
      const toolCalls = response.choices[0].message.tool_calls;
      const toolResults: any[] = [];
      
      if (toolCalls) {
        for (const toolCall of toolCalls) {
          if (toolCall.type === 'function') {
            const customFunction = this.tools.find(func => func.function.name === toolCall.function.name);
            if (customFunction) {
              try {
                // CustomFunctionのargsとfunction callのargsをマージ
                const mergedArgs = {
                  ...(customFunction.args || {}),
                  ...JSON.parse(toolCall.function.arguments)
                };
                const result = await customFunction.handler(mergedArgs);
                toolResults.push({
                  role: 'tool' as const,
                  content: typeof result === 'string' ? result : JSON.stringify(result),
                  tool_call_id: toolCall.id,
                });
              } catch (error) {
                toolResults.push({
                  role: 'tool' as const,
                  content: error instanceof Error ? error.message : 'Unknown error',
                  tool_call_id: toolCall.id,
                });
              }
            }
          }
        }
      }
      
      // ツール実行結果を含めて再度リクエスト
      if (toolResults.length > 0) {
        messages = [
          ...messages,
          response.choices[0].message as any,
          ...toolResults,
        ];
        
        const followUpRequest = {
          ...openAIRequest,
          messages,
        };
        
        response = await this.client.chat.completions.create(followUpRequest) as OpenAI.ChatCompletion;
      } else {
        break;
      }
    }
    
    return this.convertFromOpenAIFormat(response);
  }
  
  private async chatWithResponsesAPI(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    // NOTE: Responses API is not yet available in the OpenAI SDK
    // This implementation uses the raw HTTP client to call the new API
    const responsesRequest = this.convertToResponsesAPIFormat(request);
    
    // Make raw HTTP request to the Responses API
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'responses-v1',
      },
      body: JSON.stringify(responsesRequest),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }
    
    const data = await response.json();
    return this.convertFromResponsesAPIFormat(data);
  }
  
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    validateChatRequest(request);
    
    if (this.useResponsesAPI) {
      yield* this.streamWithResponsesAPI(request);
    } else {
      yield* this.streamWithChatCompletions(request);
    }
  }
  
  private async *streamWithChatCompletions(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    const openAIRequest = this.convertToOpenAIFormat(request);
    let messages = [...openAIRequest.messages];
    
    // Keep trying to get a response until we don't get tool calls
    while (true) {
      const stream = await this.client.chat.completions.create({
        ...openAIRequest,
        messages,
        stream: true,
      });
      
      // Accumulate tool calls across chunks
      const toolCallAccumulator: Map<number, {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }> = new Map();
      
      let finishReason: string | null = null;
      const assistantMessage: any = { role: 'assistant', content: null };
      let fullContent = '';
      const bufferedChunks: OpenAI.ChatCompletionChunk[] = [];
      let hasToolCalls = false;
      
      for await (const chunk of stream) {
        // Handle tool calls in the delta
        if (chunk.choices[0].delta.tool_calls) {
          hasToolCalls = true;
          for (const toolCallDelta of chunk.choices[0].delta.tool_calls) {
            const index = toolCallDelta.index;
            
            if (!toolCallAccumulator.has(index)) {
              // Initialize new tool call
              toolCallAccumulator.set(index, {
                id: toolCallDelta.id || '',
                type: toolCallDelta.type || 'function',
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || '',
                }
              });
            } else {
              // Accumulate arguments for existing tool call
              const existing = toolCallAccumulator.get(index);
              if (!existing) continue;
              if (toolCallDelta.id) existing.id = toolCallDelta.id;
              if (toolCallDelta.function?.name) existing.function.name = toolCallDelta.function.name;
              if (toolCallDelta.function?.arguments) existing.function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
        
        // If we detect tool calls, start buffering. Otherwise, yield immediately.
        if (hasToolCalls) {
          bufferedChunks.push(chunk);
          // Accumulate text content for tool call processing
          if (chunk.choices[0].delta.content) {
            fullContent += chunk.choices[0].delta.content;
          }
        } else {
          // No tool calls detected yet, yield chunk immediately
          yield this.convertStreamChunk(chunk);
        }
        
        // Capture finish reason
        if (chunk.choices[0].finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }
      
      // If we have tool calls and tools are available, execute them
      if (finishReason === 'tool_calls' && this.tools && toolCallAccumulator.size > 0) {
        // Build the complete assistant message
        if (fullContent) {
          assistantMessage.content = fullContent;
        }
        
        if (toolCallAccumulator.size > 0) {
          assistantMessage.tool_calls = Array.from(toolCallAccumulator.values());
        }
        
        const toolResults: any[] = [];
        
        for (const toolCall of toolCallAccumulator.values()) {
          if (toolCall.type === 'function') {
            const customFunction = this.tools.find(func => func.function.name === toolCall.function.name);
            if (customFunction) {
              try {
                // Merge default args with function call args
                const mergedArgs = {
                  ...(customFunction.args || {}),
                  ...JSON.parse(toolCall.function.arguments)
                };
                const result = await customFunction.handler(mergedArgs);
                toolResults.push({
                  role: 'tool' as const,
                  content: typeof result === 'string' ? result : JSON.stringify(result),
                  tool_call_id: toolCall.id,
                });
              } catch (error) {
                toolResults.push({
                  role: 'tool' as const,
                  content: error instanceof Error ? error.message : 'Unknown error',
                  tool_call_id: toolCall.id,
                });
              }
            }
          }
        }
        
        // Continue with tool results if we have any
        if (toolResults.length > 0) {
          messages = [
            ...messages,
            assistantMessage,
            ...toolResults,
          ];
          // Continue the loop to get the next response
          continue;
        }
      }
      
      // If we buffered chunks due to tool calls but no tools to execute, yield them now
      if (hasToolCalls && bufferedChunks.length > 0) {
        for (const chunk of bufferedChunks) {
          yield this.convertStreamChunk(chunk);
        }
      }
      
      break;
    }
  }
  
  private async *streamWithResponsesAPI(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    const responsesRequest = this.convertToResponsesAPIFormat(request);
    
    // Make raw HTTP request to the Responses API with streaming
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'text/event-stream',
        'OpenAI-Beta': 'responses-v1',
      },
      body: JSON.stringify({
        ...responsesRequest,
        stream: true,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }
    
    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const chunk = JSON.parse(data);
            yield this.convertResponsesStreamChunk(chunk);
          } catch (_e) {
            // Ignore parse errors
          }
        }
      }
    }
  }
  
  private convertToOpenAIFormat(request: UnifiedChatRequest): OpenAI.ChatCompletionCreateParams {
    const model = request.model || this.model;
    if (!model) {
      throw new Error('Model is required for OpenAI chat completions');
    }

    const messages = request.messages.map(msg => {
      const content = this.normalizeContent(msg.content);
      
      // tool_resultメッセージの特別処理
      if (msg.role === 'tool' || content.some(c => c.type === 'tool_result')) {
        const toolResults = content.filter(c => c.type === 'tool_result');
        if (toolResults.length > 0) {
          return toolResults.map(tr => ({
            role: 'tool' as const,
            content: Array.isArray(tr.content) 
              ? tr.content.map(item => item.type === 'text' ? item.text : '[Non-text content]').join('\n')
              : '[Tool result]',
            tool_call_id: tr.tool_use_id,
          }));
        }
      }
      
      // システムメッセージの処理 - OpenAIではmessages配列内でrole: "system"として送信
      if (msg.role === 'system') {
        return {
          role: 'system' as const,
          content: content.length === 1 && content[0].type === 'text' 
            ? content[0].text 
            : content.filter(c => c.type === 'text').map(c => c.text).join('\n') || '[System message]',
        };
      }
      
      // OpenAIは単一のテキストメッセージの場合、文字列として送信
      if (content.length === 1 && content[0].type === 'text') {
        return {
          role: msg.role as any,
          content: content[0].text,
          name: msg.name,
        };
      }
      
      // tool_useコンテンツがある場合の特別処理
      const toolUseContents = content.filter(c => c.type === 'tool_use');
      if (toolUseContents.length > 0) {
        // assistantメッセージでtool_callsを含む場合
        const textContent = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        return {
          role: msg.role as any,
          content: textContent || null,
          tool_calls: toolUseContents.map(toolUse => ({
            id: toolUse.id,
            type: 'function' as const,
            function: {
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input)
            }
          })),
          name: msg.name,
        };
      }
      
      // マルチモーダルコンテンツの変換
      const openAIContent = content.map(c => {
        switch (c.type) {
          case 'text':
            return { type: 'text' as const, text: c.text };
          case 'image':
            return {
              type: 'image_url' as const,
              image_url: {
                url: c.source.url || `data:${c.source.media_type};base64,${c.source.data}`,
              },
            };
          default:
            return { type: 'text' as const, text: '[Unsupported content type]' };
        }
      });
      
      return {
        role: msg.role as any,
        content: openAIContent as any,
        name: msg.name,
      };
    }).flat(); // tool_resultで配列になる可能性があるのでflatten
    
    return {
      model: model,
      messages,
      temperature: request.generation_config?.temperature,
      max_tokens: request.generation_config?.max_tokens,
      top_p: request.generation_config?.top_p,
      frequency_penalty: request.generation_config?.frequency_penalty,
      presence_penalty: request.generation_config?.presence_penalty,
      stop: request.generation_config?.stop_sequences,
      tools: [
        ...(request.tools?.map(tool => ({
          type: 'function' as const,
          function: tool.function,
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function' as const,
          function: func.function,
        })) || []),
      ].length > 0 ? [
        ...(request.tools?.map(tool => ({
          type: 'function' as const,
          function: tool.function,
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function' as const,
          function: func.function,
        })) || []),
      ] : undefined,
      tool_choice: request.tool_choice as any,
      response_format: this.convertResponseFormat(request.generation_config?.response_format),
    };
  }
  
  private convertResponseFormat(responseFormat: any): any {
    if (!responseFormat) return undefined;
    
    // If it's a ResponseFormat instance, use its toOpenAI method
    if (responseFormat instanceof ResponseFormat) {
      return responseFormat.toOpenAI();
    }
    
    // Handle legacy format for backward compatibility
    if (responseFormat.type === 'json_object' && responseFormat.schema) {
      // Convert to new structured output format
      return {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: responseFormat.schema,
          strict: true
        }
      };
    }
    
    // Return as-is for other formats
    return responseFormat;
  }
  
  private convertToResponsesAPIFormat(request: UnifiedChatRequest): any {
    // Responses APIでは、inputに単一のメッセージまたはメッセージ配列を送信
    // 最新のメッセージをinputとして使用し、それ以前のメッセージはprevious_response_idで参照
    const latestMessage = request.messages[request.messages.length - 1];
    const content = this.normalizeContent(latestMessage.content);
    
    let input: any;
    
    // 単一のテキストメッセージの場合は文字列として送信
    if (content.length === 1 && content[0].type === 'text') {
      input = content[0].text;
    } else {
      // マルチモーダルコンテンツの場合は配列として送信
      input = content.map(c => {
        switch (c.type) {
          case 'text':
            return {
              type: 'input_text',
              text: c.text
            };
          case 'image':
            return {
              type: 'input_image',
              image_url: {
                url: c.source.url || `data:${c.source.media_type};base64,${c.source.data}`,
              },
            };
          case 'tool_result':
            // tool_resultはtool_result_contentとして送信
            return {
              type: 'tool_result_content',
              tool_use_id: c.tool_use_id,
              content: Array.isArray(c.content)
                ? c.content.map(item => item.type === 'text' ? item.text : '[Non-text content]').join('\n')
                : '[Tool result]'
            };
          default:
            return {
              type: 'input_text',
              text: '[Unsupported content type]'
            };
        }
      });
    }
    
    return {
      model: request.model || this.model,
      input,
      temperature: request.generation_config?.temperature,
      max_output_tokens: request.generation_config?.max_tokens,
      top_p: request.generation_config?.top_p,
      tools: [
        ...(request.tools?.map(tool => ({
          type: 'function',
          function: tool.function,
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function',
          function: func.function,
        })) || []),
      ].length > 0 ? [
        ...(request.tools?.map(tool => ({
          type: 'function',
          function: tool.function,
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function',
          function: func.function,
        })) || []),
      ] : undefined,
      tool_choice: request.tool_choice as any,
      text: request.generation_config?.response_format ? {
        format: request.generation_config.response_format
      } : undefined,
      // TODO: previous_response_idの管理方法を検討
      previous_response_id: undefined,
      store: true,
    };
  }
  
  private convertFromOpenAIFormat(response: OpenAI.ChatCompletion): UnifiedChatResponse {
    const choice = response.choices[0];
    const message = choice.message;
    
    const content: MessageContent[] = [];
    
    if (message.content) {
      content.push({ type: 'text', text: message.content });
    }
    
    if (message.tool_calls) {
      message.tool_calls.forEach(toolCall => {
        if (toolCall.type === 'function') {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          });
        }
      });
    }
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: message.role as any,
      content,
      created_at: new Date(),
    };
    
    const usage: UsageStats | undefined = response.usage ? {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    } : undefined;
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: response.id,
      model: response.model,
      provider: 'openai',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      usage,
      finish_reason: choice.finish_reason as any,
      created_at: new Date(response.created * 1000),
      raw_response: response,
    };
  }
  
  private convertFromResponsesAPIFormat(response: any): UnifiedChatResponse {
    // Responses APIはoutput配列にメッセージを含む
    const outputMessage = response.output?.find((item: any) => item.type === 'message');
    if (!outputMessage) {
      throw new Error('No message in response output');
    }
    
    const content: MessageContent[] = [];
    
    // outputMessage.contentから内容を抽出
    if (outputMessage.content) {
      outputMessage.content.forEach((item: any) => {
        switch (item.type) {
          case 'output_text':
            content.push({ type: 'text', text: item.text });
            break;
          case 'tool_use':
            content.push({
              type: 'tool_use',
              id: item.id,
              name: item.name,
              input: item.input,
            });
            break;
        }
      });
    }
    
    const unifiedMessage: Message = {
      id: outputMessage.id || this.generateMessageId(),
      role: outputMessage.role || 'assistant',
      content,
      created_at: new Date(),
    };
    
    const usage: UsageStats | undefined = response.usage ? {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.total_tokens,
    } : undefined;
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: response.id,
      model: response.model,
      provider: 'openai',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      usage,
      finish_reason: outputMessage.status === 'completed' ? 'stop' : undefined,
      created_at: new Date(response.created_at * 1000),
      raw_response: response,
    };
  }
  
  private convertStreamChunk(chunk: OpenAI.ChatCompletionChunk): UnifiedChatResponse {
    const choice = chunk.choices[0];
    const delta = choice.delta;
    
    const content: MessageContent[] = [];
    
    if (delta.content) {
      content.push({ type: 'text', text: delta.content });
    }
    
    // Handle tool calls in streaming chunks
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        // In streaming, we get partial tool calls, so we need to indicate this is a partial update
        // The actual accumulation and execution happens in streamWithChatCompletions
        content.push({
          type: 'tool_use',
          id: toolCallDelta.id || `partial-${toolCallDelta.index}`,
          name: toolCallDelta.function?.name || '',
          input: {}, // Input will be accumulated in streamWithChatCompletions
        });
      }
    }
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: delta.role || 'assistant',
      content,
      created_at: new Date(),
    };
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: chunk.id,
      model: chunk.model,
      provider: 'openai',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      finish_reason: choice.finish_reason as any,
      created_at: new Date(chunk.created * 1000),
      raw_response: chunk,
    };
  }
  
  private convertResponsesStreamChunk(chunk: any): UnifiedChatResponse {
    // Responses APIのストリーミングフォーマットに対応
    const content: MessageContent[] = [];
    
    if (chunk.delta?.content) {
      content.push({ type: 'text', text: chunk.delta.content });
    }
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: chunk.delta?.role || 'assistant',
      content,
      created_at: new Date(),
    };
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: chunk.id,
      model: chunk.model,
      provider: 'openai',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      finish_reason: chunk.status === 'completed' ? 'stop' : undefined,
      created_at: new Date(chunk.created_at || Date.now()),
      raw_response: chunk,
    };
  }
  
  private handleError(error: any): UnifiedError {
    if (error instanceof OpenAI.APIError) {
      return {
        code: error.code || 'openai_error',
        message: error.message,
        type: this.mapErrorType(error.status),
        status_code: error.status,
        provider: 'openai',
        details: error,
      };
    }
    
    return {
      code: 'unknown_error',
      message: error.message || 'Unknown error occurred',
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