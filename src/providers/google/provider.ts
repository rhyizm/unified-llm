/* -----------------------------------------------------------
 *  GoogleProvider
 *  - Google Generative AI を Enbod の LLMProvider インターフェースに適合
 *  - “ローカル Assistant” という扱いなので、ID は擬似値を発行し
 *    すべてメモリ内で完結させる
 * ---------------------------------------------------------- */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamEventResponse,
  UnifiedError,
  Message,
  MessageContent,
  UsageStats,
  GenerationConfig,
  Tool,
} from '../../types/unified-api';
import BaseProvider from '../base-provider';
import { validateChatRequest } from '../../utils/validation';
import { ResponseFormat } from '../../response-format';


// type ChatHistory = { role: 'user' | 'assistant'; content: string }[];

/** スタブ実装。SDK を呼ばずにビルドだけ通す */
export class GeminiProvider extends BaseProvider {
  private client: GoogleGenerativeAI;
  
  constructor({ apiKey, model, tools }: { apiKey: string, model?: string, tools?: Tool[] }) {
    super({ model: model || 'gemini-pro', tools });
    this.client = new GoogleGenerativeAI(apiKey);
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);
    
    try {
      const model = request.model || this.model;
      if (!model) {
        throw new Error('Model is required for Gemini chat');
      }

      const modelInstance = this.client.getGenerativeModel({ model });

      const tools = this.convertToolsToGeminiFormat(request.tools, this.tools);
      
      // Extract system prompt from messages
      const systemMessage = request.messages.find(m => m.role === 'system');
      const systemInstruction = systemMessage ? this.extractTextFromContent(systemMessage.content) : undefined;
      
      // Standard flow: exclude function results and system messages from history since Gemini handles them differently
      const filteredMessages = request.messages.filter(msg => {
        const content = this.normalizeContent(msg.content);
        return !content.some(c => c.type === 'tool_result') && msg.role !== 'system';
      });
      
      const history = await this.convertToGeminiHistory(filteredMessages.slice(0, -1));
      const chatConfig: any = {
        history,
        generationConfig: this.convertGenerationConfig(request.generationConfig),
        tools: tools.length > 0 ? tools : undefined,
      };
      
      if (systemInstruction) {
        chatConfig.systemInstruction = {
          parts: [{ text: systemInstruction }],
          role: 'user'
        };
      }
      
      const chat = modelInstance.startChat(chatConfig);
      
      const lastMessage = filteredMessages[filteredMessages.length - 1];
      const prompt = this.extractPromptFromMessage(lastMessage);
      
      let result = await chat.sendMessage(prompt);
      let response = await result.response;
      
      // ツール呼び出しがある場合、実行して結果を返す
      while (this.hasFunctionCalls(response) && this.tools) {
        const functionCalls = this.extractFunctionCalls(response);
        const functionResults: any[] = [];
        
        for (const call of functionCalls) {
          const customFunction = this.tools.find(func => func.function.name === call.name);
          if (customFunction) {
            try {
              // CustomFunctionのargsとfunction callのargsをマージ
              const mergedArgs = {
                ...(customFunction.args || {}),
                ...call.args
              };
              const callResult = await customFunction.handler(mergedArgs);
              functionResults.push({
                name: call.name,
                response: { result: callResult },
              });
            } catch (error) {
              functionResults.push({
                name: call.name,
                response: { error: error instanceof Error ? error.message : 'Unknown error' },
              });
            }
          }
        }
        
        // 関数実行結果を送信して次の応答を取得
        if (functionResults.length > 0) {
          // Gemini形式に変換
          const parts = functionResults.map(funcResult => ({
            functionResponse: {
              name: funcResult.name,
              response: funcResult.response
            }
          }));
          
          result = await chat.sendMessage(parts);
          response = await result.response;
        } else {
          break;
        }
      }
      
      return this.convertFromGeminiFormat(response, result);
    } catch (error) {
      throw this.handleError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    validateChatRequest(request);
    
    const model = request.model || this.model;
    if (!model) {
      throw new Error('Model is required for Gemini chat');
    }
    const modelInstance = this.client.getGenerativeModel({ model });

    const tools = this.convertToolsToGeminiFormat(request.tools, this.tools);
    
    // Extract system prompt from messages
    const systemMessage = request.messages.find(m => m.role === 'system');
    const systemInstruction = systemMessage ? this.extractTextFromContent(systemMessage.content) : undefined;
    
    // Filter out system messages and tool results from history
    const filteredMessages = request.messages.filter(msg => {
      const content = this.normalizeContent(msg.content);
      return !content.some(c => c.type === 'tool_result') && msg.role !== 'system';
    });
    
    const history = await this.convertToGeminiHistory(filteredMessages.slice(0, -1));
    
    // Keep trying to get a response until we don't get tool calls
    while (true) {
      
      const chatConfig: any = {
        history,
        generationConfig: this.convertGenerationConfig(request.generationConfig),
        tools: tools.length > 0 ? tools : undefined,
      };
      
      if (systemInstruction) {
        chatConfig.systemInstruction = {
          parts: [{ text: systemInstruction }],
          role: 'user'
        };
      }
      
      const chat = modelInstance.startChat(chatConfig);
      
      const lastMessage = filteredMessages[filteredMessages.length - 1];
      const prompt = this.extractPromptFromMessage(lastMessage);
      
      const result = await chat.sendMessageStream(prompt);
      
      // Collect all chunks first to detect if there are function calls
      const chunks = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
      }
      
      // Get the complete response to check for function calls
      const completeResponse = await result.response;
      const hasFunctionCalls = this.hasFunctionCalls(completeResponse);
      
      if (!hasFunctionCalls) {
        // No function calls, emit unified events from collected chunks
        const pieces: string[] = [];
        if (chunks.length === 1) {
          const singleChunk = chunks[0];
          const text = singleChunk.text();
          const words = text.split(' ');
          const chunkSize = Math.max(1, Math.floor(words.length / 2));
          for (let i = 0; i < words.length; i += chunkSize) {
            const chunkWords = words.slice(i, i + chunkSize);
            const chunkText = chunkWords.join(' ') + (i + chunkSize < words.length ? ' ' : '');
            pieces.push(chunkText);
          }
        } else {
          for (const chunk of chunks) {
            const text = chunk.text();
            if (text) pieces.push(text);
          }
        }

        yield {
          id: this.generateMessageId(),
          model: model,
          provider: 'google',
          message: { id: this.generateMessageId(), role: 'assistant', content: [], createdAt: new Date() },
          text: '',
          createdAt: new Date(),
          rawResponse: undefined,
          eventType: 'start',
          outputIndex: 0,
        } satisfies UnifiedStreamEventResponse;

        let acc = '';
        for (const p of pieces) {
          acc += p;
          const ev: UnifiedStreamEventResponse = {
            id: this.generateMessageId(),
            model: model,
            provider: 'google',
            message: { id: this.generateMessageId(), role: 'assistant', content: [{ type: 'text', text: p }], createdAt: new Date() },
            text: acc,
            createdAt: new Date(),
            rawResponse: undefined,
            eventType: 'text_delta',
            outputIndex: 0,
            delta: { type: 'text', text: p },
          };
          yield ev;
        }

        yield {
          id: this.generateMessageId(),
          model: model,
          provider: 'google',
          message: { id: this.generateMessageId(), role: 'assistant', content: acc ? [{ type: 'text', text: acc }] : [], createdAt: new Date() },
          text: acc,
          createdAt: new Date(),
          rawResponse: undefined,
          eventType: 'stop',
          outputIndex: 0,
        } satisfies UnifiedStreamEventResponse;
        break;
      } else {
        // Function calls detected, execute them
        const functionCalls = this.extractFunctionCalls(completeResponse);
        const functionResults: any[] = [];
        
        for (const call of functionCalls) {
          const customFunction = this.tools?.find(func => func.function.name === call.name);
          if (customFunction) {
            try {
              // Merge default args with function call args
              const mergedArgs = {
                ...(customFunction.args || {}),
                ...call.args
              };
              const callResult = await customFunction.handler(mergedArgs);
              functionResults.push({
                name: call.name,
                response: { result: callResult },
              });
            } catch (error) {
              functionResults.push({
                name: call.name,
                response: { error: error instanceof Error ? error.message : 'Unknown error' },
              });
            }
          }
        }
        
        // If we have function results, execute them and return the final response in streaming format
        if (functionResults.length > 0) {
          // Create a streaming response with the function result
          const resultText = functionResults.map(result => 
            typeof result.response.result === 'string' 
              ? result.response.result 
              : JSON.stringify(result.response.result)
          ).join('\n');
          
          // Split the result into chunks for streaming simulation
          const words = resultText.split(' ');
          const chunkSize = Math.max(1, Math.floor(words.length / 3)); // Create at least 3 chunks
          
          let acc = '';
          yield {
            id: this.generateMessageId(),
            model: model,
            provider: 'google',
            message: { id: this.generateMessageId(), role: 'assistant', content: [], createdAt: new Date() },
            text: '',
            createdAt: new Date(),
            rawResponse: undefined,
            eventType: 'start',
            outputIndex: 0,
          } satisfies UnifiedStreamEventResponse;
          for (let i = 0; i < words.length; i += chunkSize) {
            const chunkWords = words.slice(i, i + chunkSize);
            const chunkText = chunkWords.join(' ') + (i + chunkSize < words.length ? ' ' : '');
            acc += chunkText;
            const ev: UnifiedStreamEventResponse = {
              id: this.generateMessageId(),
              model: model,
              provider: 'google',
              message: { id: this.generateMessageId(), role: 'assistant', content: [{ type: 'text', text: chunkText }], createdAt: new Date() },
              text: acc,
              createdAt: new Date(),
              rawResponse: undefined,
              eventType: 'text_delta',
              outputIndex: 0,
              delta: { type: 'text', text: chunkText },
            };
            yield ev;
          }
          yield {
            id: this.generateMessageId(),
            model: model,
            provider: 'google',
            message: { id: this.generateMessageId(), role: 'assistant', content: [{ type: 'text', text: acc }], createdAt: new Date() },
            text: acc,
            createdAt: new Date(),
            rawResponse: undefined,
            eventType: 'stop',
            outputIndex: 0,
          } satisfies UnifiedStreamEventResponse;
          
          // Break out of the loop after streaming function results
          break;
        }
      }
      
      break;
    }
  }
  
  private convertToolsToGeminiFormat(requestTools?: any[], providerTools?: Tool[]): any[] {
    const allTools = [];
    
    // request.toolsを追加
    if (requestTools && requestTools.length > 0) {
      allTools.push(...requestTools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters || { type: 'object', properties: {} }
      })));
    }
    
    // provider.toolsを追加
    if (providerTools && providerTools.length > 0) {
      allTools.push(...providerTools.map(func => ({
        name: func.function.name,
        description: func.function.description || '',
        parameters: func.function.parameters || { type: 'object', properties: {} }
      })));
    }
    
    if (allTools.length === 0) return [];
    
    // Gemini expects a single object with functionDeclarations array
    return [{
      functionDeclarations: allTools
    }];
  }

  private hasFunctionCalls(response: any): boolean {
    try {
      const functionCalls = response.functionCalls();
      return functionCalls && functionCalls.length > 0;
    } catch {
      // candidates approach
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts) {
          return candidate.content.parts.some((part: any) => part.functionCall);
        }
      }
      return false;
    }
  }

  private extractFunctionCalls(response: any): any[] {
    try {
      const functionCalls = response.functionCalls();
      return functionCalls || [];
    } catch {
      // candidates approach
      const calls: any[] = [];
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts) {
          candidate.content.parts.forEach((part: any) => {
            if (part.functionCall) {
              calls.push({
                name: part.functionCall.name,
                args: part.functionCall.args || {}
              });
            }
          });
        }
      }
      return calls;
    }
  }

  private async convertToGeminiHistory(messages: Message[]): Promise<any[]> {
    return Promise.all(messages.map(async msg => {
      // Debug logging can be enabled for message conversion if needed
      
      const content = this.normalizeContent(msg.content);
      const parts = await Promise.all(content.map(async c => {
        // Debug logging for content items can be enabled if needed
        switch (c.type) {
          case 'text':
            return { text: c.text };
          case 'image':
            return {
              inlineData: {
                mimeType: c.source.mediaType || 'image/jpeg',
                data: c.source.data || '',
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
                  functionResponse: {
                    name: c.name,
                    response: { result: typeof result === 'string' ? result : JSON.stringify(result) }
                  }
                };
              } catch (error) {
                return {
                  functionResponse: {
                    name: c.name,
                    response: { error: error instanceof Error ? error.message : 'Unknown error' }
                  }
                };
              }
            }
            return {
              functionCall: {
                name: c.name,
                args: c.input
              }
            };
          }
          case 'tool_result': {
            const responseContent = Array.isArray(c.content) 
              ? c.content.map(item => {
                  if (item.type === 'text') {
                    // Try to parse JSON result to extract the actual value
                    try {
                      const parsed = JSON.parse(item.text);
                      return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                    } catch {
                      return item.text;
                    }
                  }
                  return '[Non-text content]';
                }).join('\n')
              : '[Tool result]';
            
            return {
              functionResponse: {
                name: (c as any).functionName || (c as any).toolUseId,
                response: responseContent
              }
            };
          }
          default:
            return { text: '[Unsupported content type]' };
        }
      }));
      
      // For Gemini, function responses must come from 'function' role
      // Check if this message contains functionResponse parts
      const hasFunctionResponse = parts.some(part => 'functionResponse' in part);
      
      let role: string;
      if (hasFunctionResponse) {
        role = 'function'; // Function responses must be from function according to Gemini docs
      } else {
        role = msg.role === 'assistant' ? 'model' : 'user';
      }
      
      return {
        role,
        parts,
      };
    }));
  }
  
  private extractPromptFromMessage(message: Message): string | any[] {
    const content = this.normalizeContent(message.content);
    
    if (content.length === 1 && content[0].type === 'text') {
      return content[0].text;
    }
    
    return content.map(c => {
      switch (c.type) {
        case 'text':
          return { text: c.text };
        case 'image':
          return {
            inlineData: {
              mimeType: c.source.mediaType || 'image/jpeg',
              data: c.source.data || '',
            },
          };
        default:
          return { text: '[Unsupported content type]' };
      }
    });
  }
  
  private convertGenerationConfig(config?: GenerationConfig): any {
    if (!config) return undefined;
    
    const result: any = {
      temperature: config.temperature,
      topP: config.top_p,
      topK: config.top_k,
      maxOutputTokens: config.max_tokens,
      stopSequences: config.stopSequences,
    };
    
    // Handle response format
    if (config.responseFormat) {
      // If it's a ResponseFormat instance, use its toGoogle method
      if (config.responseFormat instanceof ResponseFormat) {
        const googleFormat = config.responseFormat.toGoogle();
        result.responseMimeType = googleFormat.responseMimeType;
        result.responseSchema = googleFormat.responseSchema;
      }
      // Handle legacy format
      else if (config.responseFormat.type === 'json_object') {
        result.responseMimeType = 'application/json';
        
        if (config.responseFormat.schema) {
          result.responseSchema = this.convertToGoogleSchema(config.responseFormat.schema);
        }
      }
    }
    
    return result;
  }
  
  private convertToGoogleSchema(schema: any): any {
    const converted: any = {
      type: this.mapToGoogleType(schema.type)
    };

    if (schema.description) {
      converted.description = schema.description;
    }

    if (schema.type === 'object' && schema.properties) {
      converted.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        converted.properties[key] = this.convertToGoogleSchema(value);
      }
      if (schema.required) {
        converted.required = schema.required;
      }
    }

    if (schema.type === 'array' && schema.items) {
      converted.items = this.convertToGoogleSchema(schema.items);
    }

    if (schema.enum) {
      converted.enum = schema.enum;
    }

    return converted;
  }

  private mapToGoogleType(type: string): string {
    const typeMap: Record<string, string> = {
      'object': 'OBJECT',
      'array': 'ARRAY',
      'string': 'STRING',
      'number': 'NUMBER',
      'boolean': 'BOOLEAN',
      'null': 'NULL'
    };
    return typeMap[type] || 'STRING';
  }
  
  private convertFromGeminiFormat(response: any, _result: any): UnifiedChatResponse {
    if (!this.model) {
      throw new Error('Model is required for Gemini response conversion');
    }

    const content: MessageContent[] = [];
    
    // Debug logging can be enabled if needed
    // console.log('🔍 Debug Gemini response structure:', { ... });
    
    // Check candidates for content
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      // console.log('🔍 Candidate content:', candidate.content);
      
      if (candidate.content && candidate.content.parts) {
        candidate.content.parts.forEach((part: any, _index: number) => {
          // console.log(`🔍 Part ${index}:`, part);
          
          if (part.text) {
            content.push({ type: 'text', text: part.text });
          } else if (part.functionCall) {
            content.push({
              type: 'tool_use',
              id: this.generateMessageId(),
              name: part.functionCall.name,
              input: part.functionCall.args || {}
            });
          }
        });
      }
    }
    
    // Fallback to legacy methods if candidates approach doesn't work
    if (content.length === 0) {
      try {
        const text = response.text();
        if (text) {
          content.push({ type: 'text', text });
        }
      } catch (_e) {
        // console.log('🔍 No text method available');
      }
      
      try {
        const functionCalls = response.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
          functionCalls.forEach((call: any) => {
            content.push({
              type: 'tool_use',
              id: this.generateMessageId(),
              name: call.name,
              input: call.args || {}
            });
          });
        }
      } catch (_e) {
        // console.log('🔍 No functionCalls method available');
      }
    }
    
    // コンテンツが空の場合はプレースホルダーを追加
    if (content.length === 0) {
      content.push({ type: 'text', text: '[No content from Gemini]' });
    }
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: 'assistant',
      content,
      createdAt: new Date(),
    };
    
    // Geminiは使用統計を異なる形式で提供
    const usage: UsageStats | undefined = response.usageMetadata ? {
      inputTokens: response.usageMetadata.promptTokenCount || 0,
      outputTokens: response.usageMetadata.candidatesTokenCount || 0,
      totalTokens: response.usageMetadata.totalTokenCount || 0,
    } : undefined;
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: this.generateMessageId(),
      model: this.model,
      provider: 'google',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      usage,
      finish_reason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
      createdAt: new Date(),
      rawResponse: response,
    };
  }
  
  private convertStreamChunk(chunk: any): UnifiedChatResponse {
    if (!this.model) {
      throw new Error('Model is required for Gemini stream');
    }

    const text = chunk.text();
    const content: MessageContent[] = [{ type: 'text', text }];
    
    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: 'assistant',
      content,
      createdAt: new Date(),
    };
    
    // Extract text for convenience field
    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');
    
    return {
      id: this.generateMessageId(),
      model: this.model,
      provider: 'google',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      createdAt: new Date(),
      rawResponse: chunk,
    };
  }
  
  private mapFinishReason(reason?: string): UnifiedChatResponse['finish_reason'] {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      default:
        return null;
    }
  }
  
  private extractTextFromContent(content: MessageContent[] | string): string {
    if (typeof content === 'string') return content;
    
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n') || '';
  }

  private handleError(error: any): UnifiedError {
    return {
      code: error.code || 'gemini_error',
      message: error.message || 'Unknown error occurred',
      type: 'api_error',
      provider: 'google',
      details: error,
    };
  }
}
