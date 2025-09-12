import OpenAI from 'openai';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamEventResponse,
  UnifiedError,
  Message,
  MessageContent,
  UsageStats,
  Tool,
} from '../../types/unified-api';
import { validateChatRequest } from '../../utils/validation';
import { validateOpenAILogLevel } from '../../validators';
import { normalizeFunctionForCompletions } from '../../utils/tool-schema';
import BaseProvider from '../base-provider';
import { ResponseFormat } from '../../response-format';

export class OpenAICompletionProvider extends BaseProvider {
  protected client: OpenAI;
  
  constructor({ apiKey, model, baseURL, tools, logLevel = 'warn' }: { 
    apiKey: string, 
    model?: string, 
    baseURL?: string,
    tools?: Tool[],
    logLevel?: string
  }) {
    super({ model: model, tools });
    
    // Validate log level for OpenAI SDK (v4 doesn't support logLevel parameter)
    // We need to use environment variable for v4
    const validatedLogLevel = validateOpenAILogLevel(logLevel);
    if (validatedLogLevel) {
      process.env.OPENAI_LOG = validatedLogLevel;
    }
    
    this.client = new OpenAI({ 
      apiKey,
      baseURL: baseURL || undefined // OpenAI SDKにbaseURLを渡す
    });
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);
    
    try {
      return this.chatWithChatCompletions(request);
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
  
  
  
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    validateChatRequest(request);
    
    yield* this.streamWithChatCompletions(request);
  }
  
  private async *streamWithChatCompletions(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    const openAIRequest = this.convertToOpenAIFormat(request);
    let messages = [...openAIRequest.messages];
    
    // Loop until we reach a final assistant text response (no tool_calls)
    while (true) {
      const stream = await this.client.chat.completions.create({
        ...openAIRequest,
        messages,
        stream: true,
      });
      // Phase-local accumulators
      const toolCallAccumulator: Map<number, {
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> = new Map();

      let finishReason: string | null = null;
      const assistantMessage: any = { role: 'assistant', content: null };
      let fullContent = '';
      const bufferedTextDeltas: string[] = [];

      // Read entire phase, buffering to decide on tool usage
      for await (const chunk of stream) {
        // Some providers (e.g., Azure variants) may emit non-choice keepalive/meta chunks
        const choice = (chunk as any)?.choices?.[0];
        if (!choice) {
          continue; // skip chunks without choices
        }
        const delta = (choice as any).delta || {};

        // Accumulate any text deltas
        if (delta.content) {
          bufferedTextDeltas.push(delta.content);
          fullContent += delta.content;
        }

        // Detect and accumulate tool call deltas
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;
            if (!toolCallAccumulator.has(index)) {
              toolCallAccumulator.set(index, {
                id: toolCallDelta.id || '',
                type: toolCallDelta.type || 'function',
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || '',
                },
              });
            } else {
              const existing = toolCallAccumulator.get(index)!;
              if (toolCallDelta.id) existing.id = toolCallDelta.id;
              if (toolCallDelta.function?.name) existing.function.name = toolCallDelta.function.name;
              if (toolCallDelta.function?.arguments) existing.function.arguments += toolCallDelta.function.arguments;
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // If tool calls were requested, execute and loop to next phase without emitting
      if (finishReason === 'tool_calls' && this.tools && toolCallAccumulator.size > 0) {
        if (fullContent) {
          assistantMessage.content = fullContent;
        }
        assistantMessage.tool_calls = Array.from(toolCallAccumulator.values());

        const toolResults: any[] = [];
        for (const toolCall of toolCallAccumulator.values()) {
          if (toolCall.type === 'function') {
            const customFunction = this.tools.find(func => func.function.name === toolCall.function.name);
            if (customFunction) {
              try {
                const mergedArgs = {
                  ...(customFunction.args || {}),
                  ...JSON.parse(toolCall.function.arguments),
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

        if (toolResults.length > 0) {
          messages = [
            ...messages,
            assistantMessage,
            ...toolResults,
          ];
          // Continue to next loop iteration for the final assistant answer
          continue;
        }
      }

      // No tool calls: emit unified streaming events by replaying buffered deltas
      let accumulated = '';
      // start
      yield {
        id: this.generateMessageId(),
        model: (this.model || openAIRequest.model)!,
        provider: 'openai',
        message: {
          id: this.generateMessageId(),
          role: 'assistant',
          content: [],
          createdAt: new Date(),
        },
        text: '',
        createdAt: new Date(),
        rawResponse: undefined,
        eventType: 'start',
        outputIndex: 0,
      } satisfies UnifiedStreamEventResponse;

      for (const piece of bufferedTextDeltas) {
        if (!piece) continue;
        accumulated += piece;
        const ev: UnifiedStreamEventResponse = {
          id: this.generateMessageId(),
          model: (this.model || openAIRequest.model)!,
          provider: 'openai',
          message: {
            id: this.generateMessageId(),
            role: 'assistant',
            content: [{ type: 'text', text: piece }],
            createdAt: new Date(),
          },
          text: accumulated,
          createdAt: new Date(),
          rawResponse: undefined,
          eventType: 'text_delta',
          outputIndex: 0,
          delta: { type: 'text', text: piece },
        };
        yield ev;
      }

      // stop
      yield {
        id: this.generateMessageId(),
        model: (this.model || openAIRequest.model)!,
        provider: 'openai',
        message: {
          id: this.generateMessageId(),
          role: 'assistant',
          content: accumulated ? [{ type: 'text', text: accumulated }] : [],
          createdAt: new Date(),
        },
        text: accumulated,
        finish_reason: finishReason as any,
        createdAt: new Date(),
        rawResponse: undefined,
        eventType: 'stop',
        outputIndex: 0,
      } satisfies UnifiedStreamEventResponse;

      break; // finished without tool calls
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
            tool_call_id: tr.toolUseId,
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
                url: c.source.url || `data:${c.source.mediaType};base64,${c.source.data}`,
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
      temperature: request.generationConfig?.temperature,
      max_tokens: request.generationConfig?.max_tokens,
      top_p: request.generationConfig?.top_p,
      frequency_penalty: request.generationConfig?.frequencyPenalty,
      presence_penalty: request.generationConfig?.presencePenalty,
      stop: request.generationConfig?.stopSequences,
      tools: [
        ...(request.tools?.map(tool => ({
          type: 'function' as const,
          function: normalizeFunctionForCompletions(tool.function),
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function' as const,
          function: normalizeFunctionForCompletions(func.function),
        })) || []),
      ].length > 0 ? [
        ...(request.tools?.map(tool => ({
          type: 'function' as const,
          function: normalizeFunctionForCompletions(tool.function),
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function' as const,
          function: normalizeFunctionForCompletions(func.function),
        })) || []),
      ] : undefined,
      tool_choice: request.tool_choice as any,
      response_format: this.convertResponseFormat(request.generationConfig?.responseFormat),
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

  // parameters normalization moved to utils/tool-schema.ts
  
  /* removed: convertToResponsesAPIFormat moved to OpenAIResponsesProvider */
  
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
      provider: 'openai',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      usage,
      finish_reason: choice.finish_reason as any,
      createdAt: new Date(response.created * 1000),
      rawResponse: response,
    };
  }
  
  /* removed: convertFromResponsesAPIFormat moved to OpenAIResponsesProvider */
  
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
      createdAt: new Date(),
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
      createdAt: new Date(chunk.created * 1000),
      rawResponse: chunk,
    };
  }
  
  /* removed: convertResponsesStreamChunk moved to OpenAIResponsesProvider */
  
  private handleError(error: any): UnifiedError {
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
