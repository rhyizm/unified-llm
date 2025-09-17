import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamEventResponse,
  UnifiedError,
  Message,
  MessageContent,
  MessageRole,
  UsageStats,
  Tool,
} from '../../types/unified-api';
import { validateChatRequest } from '../../utils/validation';
import BaseProvider from '../base-provider';

const VALID_MESSAGE_ROLES: MessageRole[] = [
  'system',
  'user',
  'assistant',
  'tool',
  'function',
  'developer',
];

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
  
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    validateChatRequest(request);

    const deepseekRequest = this.convertToDeepSeekFormat(request);
    const modelName = deepseekRequest.model || this.model || 'deepseek-chat';
    let messages = [...deepseekRequest.messages];

    while (true) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          ...deepseekRequest,
          messages,
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

      const rawChunks: any[] = [];
      const bufferedTextDeltas: string[] = [];
      const toolCallAccumulator: Map<number, {
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> = new Map();
      let finishReason: string | undefined;
      let assistantRole: MessageRole | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') {
            continue;
          }

          try {
            const chunk = JSON.parse(data);
            rawChunks.push(chunk);

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta || {};
            if (typeof delta.role === 'string' && VALID_MESSAGE_ROLES.includes(delta.role as MessageRole)) {
              assistantRole = delta.role as MessageRole;
            }

            const deltaContent = delta.content;
            if (typeof deltaContent === 'string') {
              bufferedTextDeltas.push(deltaContent);
            } else if (Array.isArray(deltaContent)) {
              deltaContent.forEach((part: any) => {
                if (typeof part === 'string') {
                  bufferedTextDeltas.push(part);
                } else if (typeof part?.text === 'string') {
                  bufferedTextDeltas.push(part.text);
                }
              });
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index ?? 0;
                if (!toolCallAccumulator.has(index)) {
                  toolCallAccumulator.set(index, {
                    id: toolCall.id || '',
                    type: toolCall.type || 'function',
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: toolCall.function?.arguments || '',
                    },
                  });
                } else {
                  const existing = toolCallAccumulator.get(index)!;
                  if (toolCall.id) existing.id = toolCall.id;
                  if (toolCall.type) existing.type = toolCall.type;
                  if (toolCall.function?.name) existing.function.name = toolCall.function.name;
                  if (toolCall.function?.arguments) {
                    existing.function.arguments += toolCall.function.arguments;
                  }
                }
              }
            }
          } catch (_e) {
            // Ignore parse errors
          }
        }
      }

      if (finishReason === 'tool_calls' && this.tools && toolCallAccumulator.size > 0) {
        const assistantMessage: any = {
          role: assistantRole || 'assistant',
          content: bufferedTextDeltas.length > 0 ? bufferedTextDeltas.join('') : null,
          tool_calls: Array.from(toolCallAccumulator.values()),
        };

        const toolResults: any[] = [];
        for (const toolCall of toolCallAccumulator.values()) {
          if (toolCall.type !== 'function') continue;

          const customFunction = this.tools.find(func => func.function.name === toolCall.function.name);
          if (!customFunction) {
            continue;
          }

          try {
            const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
            const mergedArgs = {
              ...(customFunction.args || {}),
              ...args,
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

        if (toolResults.length > 0) {
          messages = [
            ...messages,
            assistantMessage,
            ...toolResults,
          ];
          continue; // request a new streamed response with tool outputs in context
        }
      }

      yield {
        id: this.generateMessageId(),
        model: modelName,
        provider: 'deepseek',
        message: { id: this.generateMessageId(), role: 'assistant', content: [], createdAt: new Date() },
        text: '',
        createdAt: new Date(),
        rawResponse: undefined,
        eventType: 'start',
        outputIndex: 0,
      } satisfies UnifiedStreamEventResponse;

      let acc = '';
      for (const piece of bufferedTextDeltas) {
        if (!piece) continue;
        acc += piece;
        const ev: UnifiedStreamEventResponse = {
          id: this.generateMessageId(),
          model: modelName,
          provider: 'deepseek',
          message: { id: this.generateMessageId(), role: 'assistant', content: [{ type: 'text', text: piece }], createdAt: new Date() },
          text: acc,
          createdAt: new Date(),
          rawResponse: undefined,
          eventType: 'text_delta',
          outputIndex: 0,
          delta: { type: 'text', text: piece },
        };
        yield ev;
      }

      yield {
        id: this.generateMessageId(),
        model: modelName,
        provider: 'deepseek',
        message: { id: this.generateMessageId(), role: assistantRole || 'assistant', content: acc ? [{ type: 'text', text: acc }] : [], createdAt: new Date() },
        text: acc,
        finish_reason: finishReason as any,
        createdAt: new Date(),
        rawResponse: rawChunks,
        eventType: 'stop',
        outputIndex: 0,
      } satisfies UnifiedStreamEventResponse;

      break;
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
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText };
      }
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
            tool_call_id: tr.toolUseId,
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
                url: c.source.url || `data:${c.source.mediaType};base64,${c.source.data}`,
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
      temperature: request.generationConfig?.temperature,
      max_tokens: request.generationConfig?.max_tokens,
      top_p: request.generationConfig?.top_p,
      frequencyPenalty: request.generationConfig?.frequencyPenalty,
      presencePenalty: request.generationConfig?.presencePenalty,
      stop: request.generationConfig?.stopSequences,
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
      responseFormat: request.generationConfig?.responseFormat,
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
      createdAt: new Date(),
    };
    
    const usage: UsageStats | undefined = response.usage ? {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    } : undefined;
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: response.id,
      model: response.model,
      provider: 'deepseek' as const,
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      usage,
      finish_reason: choice.finish_reason as any,
      createdAt: new Date(response.created * 1000),
      rawResponse: response,
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
      createdAt: new Date(),
    };
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: chunk.id,
      model: chunk.model,
      provider: 'deepseek' as const,
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      finish_reason: choice.finish_reason as any,
      createdAt: new Date(chunk.created * 1000),
      rawResponse: chunk,
    };
  }
  
  private handleError(error: any): UnifiedError {
    return {
      code: error.error?.code || 'deepseek_error',
      message: error.error?.message || error.message || 'Unknown error occurred',
      type: this.mapErrorType(error.statusCode || error.status),
      statusCode: error.statusCode || error.status,
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
