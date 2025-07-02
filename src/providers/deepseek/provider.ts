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

export class DeepSeekProvider extends BaseProvider {
  private apiKey: string;
  private baseUrl: string = 'https://api.deepseek.com/v1';
  
  constructor({ apiKey, model, tools }: { 
    apiKey: string, 
    model?: string, 
    tools?: Tool[]
  }) {
    super({ model: model || 'deepseek-chat', tools });
    this.apiKey = apiKey;
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);
    
    try {
      const deepseekRequest = this.convertToDeepSeekFormat(request);
      let response = await this.makeAPICall('/chat/completions', deepseekRequest);
      let messages = [...deepseekRequest.messages];
      
      // Handle tool calls if present
      while (response.choices[0].finish_reason === 'tool_calls' && this.tools) {
        const toolCalls = response.choices[0].message.tool_calls;
        const toolResults: any[] = [];
        
        if (toolCalls) {
          for (const toolCall of toolCalls) {
            if (toolCall.type === 'function') {
              const customFunction = this.tools.find(func => func.function.name === toolCall.function.name);
              if (customFunction) {
                try {
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
        
        // Make follow-up request with tool results
        if (toolResults.length > 0) {
          messages = [
            ...messages,
            response.choices[0].message as any,
            ...toolResults,
          ];
          
          const followUpRequest = {
            ...deepseekRequest,
            messages,
          };
          
          response = await this.makeAPICall('/chat/completions', followUpRequest);
        } else {
          break;
        }
      }
      
      return this.convertFromDeepSeekFormat(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse> {
    validateChatRequest(request);
    
    const deepseekRequest = this.convertToDeepSeekFormat(request);
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        ...deepseekRequest,
        stream: true,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw this.handleError(error);
    }
    
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
            yield this.convertStreamChunk(chunk);
          } catch (_e) {
            // Ignore parse errors
          }
        }
      }
    }
  }
  
  private async makeAPICall(endpoint: string, payload: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw this.handleError(error);
    }
    
    return response.json();
  }
  
  private convertToDeepSeekFormat(request: UnifiedChatRequest): any {
    const model = request.model || this.model;
    if (!model) {
      throw new Error('Model is required for DeepSeek chat completions');
    }

    const messages = request.messages.map(msg => {
      const content = this.normalizeContent(msg.content);
      
      // Handle tool result messages
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
      
      // Handle system messages
      if (msg.role === 'system') {
        return {
          role: 'system' as const,
          content: content.length === 1 && content[0].type === 'text' 
            ? content[0].text 
            : content.filter(c => c.type === 'text').map(c => c.text).join('\n') || '[System message]',
        };
      }
      
      // Handle simple text messages
      if (content.length === 1 && content[0].type === 'text') {
        return {
          role: msg.role as any,
          content: content[0].text,
          name: msg.name,
        };
      }
      
      // Handle tool use content
      const toolUseContents = content.filter(c => c.type === 'tool_use');
      if (toolUseContents.length > 0) {
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
      
      // Handle multimodal content
      const deepseekContent = content.map(c => {
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
        content: deepseekContent as any,
        name: msg.name,
      };
    }).flat();
    
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
      response_format: request.generation_config?.response_format,
    };
  }
  
  private convertFromDeepSeekFormat(response: any): UnifiedChatResponse {
    const choice = response.choices[0];
    const message = choice.message;
    
    const content: MessageContent[] = [];
    
    if (message.content) {
      content.push({ type: 'text', text: message.content });
    }
    
    if (message.tool_calls) {
      message.tool_calls.forEach((toolCall: any) => {
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
    
    return {
      id: response.id,
      model: response.model,
      provider: 'deepseek' as const,
      message: unifiedMessage,
      usage,
      finish_reason: choice.finish_reason as any,
      created_at: new Date(response.created * 1000),
      raw_response: response,
    };
  }
  
  private convertStreamChunk(chunk: any): UnifiedChatResponse {
    const choice = chunk.choices[0];
    const delta = choice.delta;
    
    const content: MessageContent[] = [];
    
    if (delta.content) {
      content.push({ type: 'text', text: delta.content });
    }
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: delta.role || 'assistant',
      content,
      created_at: new Date(),
    };
    
    return {
      id: chunk.id,
      model: chunk.model,
      provider: 'deepseek' as const,
      message: unifiedMessage,
      finish_reason: choice.finish_reason as any,
      created_at: new Date(chunk.created * 1000),
      raw_response: chunk,
    };
  }
  
  private handleError(error: any): UnifiedError {
    return {
      code: error.error?.code || 'deepseek_error',
      message: error.error?.message || error.message || 'Unknown error occurred',
      type: this.mapErrorType(error.status_code || error.status),
      status_code: error.status_code || error.status,
      provider: 'deepseek',
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