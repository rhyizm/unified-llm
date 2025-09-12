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

export class OpenAIResponsesProvider extends BaseProvider {
  private apiKey: string;
  private baseURL?: string;

  constructor({ apiKey, model, baseURL, tools, logLevel = 'warn' }: {
    apiKey: string,
    model?: string,
    baseURL?: string,
    tools?: Tool[],
    logLevel?: string
  }) {
    super({ model, tools });
    this.apiKey = apiKey;
    this.baseURL = baseURL;

    // Validate log level for OpenAI responses (uses env var like SDK)
    const validatedLogLevel = validateOpenAILogLevel(logLevel);
    if (validatedLogLevel) {
      process.env.OPENAI_LOG = validatedLogLevel;
    }
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    validateChatRequest(request);
    try {
      return await this.chatWithResponsesAPI(request);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async *stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    validateChatRequest(request);
    try {
      yield* this.streamWithResponsesAPI(request);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async chatWithResponsesAPI(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const responsesRequest = this.convertToResponsesAPIFormat(request);

    const url = this.baseURL
      ? `${this.baseURL}/responses`
      : 'https://api.openai.com/v1/responses';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'responses-v1',
      },
      body: JSON.stringify(responsesRequest),
    });

    if (!response.ok) {
      let message = 'API request failed';
      try {
        const error = await response.json();
        message = error.error?.message || message;
      } catch {}
      throw new Error(message);
    }

    const data = await response.json();
    return this.convertFromResponsesAPIFormat(data);
  }

  private async *streamWithResponsesAPI(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedStreamEventResponse> {
    const responsesRequest = this.convertToResponsesAPIFormat(request);

    const url = this.baseURL
      ? `${this.baseURL}/responses`
      : 'https://api.openai.com/v1/responses';

    const response = await fetch(url, {
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
      let message = 'API request failed';
      try {
        const error = await response.json();
        message = error.error?.message || message;
      } catch {}
      throw new Error(message);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    // Buffer deltas then emit unified events: start -> text_delta* -> stop
    const textPieces: string[] = [];
    let doneReading = false;
    while (!doneReading) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') { doneReading = true; break; }
          try {
            const json = JSON.parse(data);
            if (json.type === 'response.output_text.delta' && json.delta?.text) {
              textPieces.push(json.delta.text);
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // emit events
    yield {
      id: this.generateMessageId(),
      model: responsesRequest.model || this.model!,
      provider: 'openai',
      message: { id: this.generateMessageId(), role: 'assistant', content: [], createdAt: new Date() },
      text: '',
      createdAt: new Date(),
      rawResponse: undefined,
      eventType: 'start',
      outputIndex: 0,
    } satisfies UnifiedStreamEventResponse;

    let acc = '';
    for (const piece of textPieces) {
      acc += piece;
      const ev: UnifiedStreamEventResponse = {
        id: this.generateMessageId(),
        model: responsesRequest.model || this.model!,
        provider: 'openai',
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
      model: responsesRequest.model || this.model!,
      provider: 'openai',
      message: { id: this.generateMessageId(), role: 'assistant', content: acc ? [{ type: 'text', text: acc }] : [], createdAt: new Date() },
      text: acc,
      createdAt: new Date(),
      rawResponse: undefined,
      eventType: 'stop',
      outputIndex: 0,
    } satisfies UnifiedStreamEventResponse;
  }

  private convertToResponsesAPIFormat(request: UnifiedChatRequest): any {
    const latestMessage = request.messages[request.messages.length - 1];
    const content = this.normalizeContent(latestMessage.content);

    let input: any;

    if (content.length === 1 && content[0].type === 'text') {
      input = content[0].text;
    } else {
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
                url: c.source.url || `data:${c.source.mediaType};base64,${c.source.data}`,
              },
            };
          case 'tool_result':
            return {
              type: 'tool_result_content',
              toolUseId: c.toolUseId,
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
      temperature: request.generationConfig?.temperature,
      max_outputTokens: request.generationConfig?.max_tokens,
      top_p: request.generationConfig?.top_p,
      tools: [
        ...(request.tools?.map(tool => ({
          type: 'function',
          function: normalizeFunctionForCompletions(tool.function),
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function',
          function: normalizeFunctionForCompletions(func.function),
        })) || []),
      ].length > 0 ? [
        ...(request.tools?.map(tool => ({
          type: 'function',
          function: normalizeFunctionForCompletions(tool.function),
        })) || []),
        ...(this.tools?.map(func => ({
          type: 'function',
          function: normalizeFunctionForCompletions(func.function),
        })) || []),
      ] : undefined,
      tool_choice: request.tool_choice as any,
      text: request.generationConfig?.responseFormat ? {
        format: request.generationConfig.responseFormat
      } : undefined,
      previous_response_id: undefined,
      store: true,
    };
  }

  private convertFromResponsesAPIFormat(response: any): UnifiedChatResponse {
    const outputMessage = response.output?.find((item: any) => item.type === 'message');
    if (!outputMessage) {
      throw new Error('No message in response output');
    }

    const content: MessageContent[] = [];

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
      createdAt: new Date(),
    };

    const usage: UsageStats | undefined = response.usage ? {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.total_tokens,
    } : undefined;

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
      createdAt: new Date(response.createdAt * 1000),
      rawResponse: response,
    };
  }

  private convertResponsesStreamChunk(chunk: any): UnifiedChatResponse {
    const content: MessageContent[] = [];

    if (chunk.delta?.content) {
      content.push({ type: 'text', text: chunk.delta.content });
    }

    const unifiedMessage: Message = {
      id: this.generateMessageId(),
      role: chunk.delta?.role || 'assistant',
      content,
      createdAt: new Date(),
    };

    const contentArray = Array.isArray(unifiedMessage.content) ? unifiedMessage.content : [{ type: 'text', text: unifiedMessage.content }];
    const textContent = contentArray.find((c: any) => c.type === 'text');

    return {
      id: chunk.id,
      model: chunk.model,
      provider: 'openai',
      message: unifiedMessage,
      text: (textContent as any)?.text || '',
      finish_reason: chunk.status === 'completed' ? 'stop' : undefined,
      createdAt: new Date(chunk.createdAt || Date.now()),
      rawResponse: chunk,
    };
  }

  private handleError(error: any): UnifiedError {
    return {
      code: 'openai_responses_error',
      message: error?.message || 'Unknown error occurred',
      type: 'api_error',
      provider: 'openai',
      details: error,
    };
  }

  // parameters normalization moved to utils/tool-schema.ts
}
