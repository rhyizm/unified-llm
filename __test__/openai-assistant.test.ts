import { OpenAIProvider } from '../src/providers/openai';
import { UnifiedChatRequest } from '../src/types/unified-api';
import OpenAI from 'openai';

// Mock OpenAI client
jest.mock('openai');

describe('OpenAIProvider', () => {
  let assistant: OpenAIProvider;
  let mockClient: jest.Mocked<OpenAI>;

  beforeEach(() => {
    const createMock = jest.fn();
    mockClient = {
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any;

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockClient);

    assistant = new OpenAIProvider({ apiKey: 'test-api-key', model: 'gpt-4o-mini' });
  });

  describe('constructor', () => {
    it('should initialize with default model', () => {
      const defaultAssistant = new OpenAIProvider({ apiKey: 'test-key' });
      expect(defaultAssistant).toBeInstanceOf(OpenAIProvider);
    });

    it('should initialize with custom model', () => {
      const customAssistant = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4' });
      expect(customAssistant).toBeInstanceOf(OpenAIProvider);
    });
  });

  describe('chat', () => {
    it('should handle simple text message', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
              refusal: null,
            },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      };

      (mockClient.chat.completions.create as jest.Mock).mockResolvedValue(mockResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4o-mini',
      };

      const response = await assistant.chat(request);

      expect(response).toMatchObject({
        id: 'chatcmpl-123',
        model: 'gpt-4o-mini',
        provider: 'openai',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help you?' }],
        },
        usage: {
          input_tokens: 10,
          output_tokens: 8,
          total_tokens: 18,
        },
        finish_reason: 'stop',
      });
    });

    it('should handle OpenAI API errors', async () => {
      const apiError = {
        status: 403,
        message: 'Project does not have access to model',
        code: 'model_not_found',
      };
      
      Object.setPrototypeOf(apiError, OpenAI.APIError.prototype);

      (mockClient.chat.completions.create as jest.Mock).mockRejectedValue(apiError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4-turbo-preview',
      };

      await expect(assistant.chat(request)).rejects.toMatchObject({
        code: 'model_not_found',
        message: 'Project does not have access to model',
      });
    });

    it('should handle tool calls', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-456',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'getCurrentTime',
                    arguments: '{}',
                  },
                },
              ],
            },
            logprobs: null,
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      };

      (mockClient.chat.completions.create as jest.Mock).mockResolvedValue(mockResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'What time is it?',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4o-mini',
        tools: [
          {
            type: 'function',
            function: {
              name: 'getCurrentTime',
              description: 'Get the current time',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
        ],
      };

      const response = await assistant.chat(request);

      expect(response.message.content).toEqual([
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'getCurrentTime',
          input: {},
        },
      ]);
      expect(response.finish_reason).toBe('tool_calls');
    });
  });

  describe('error handling', () => {
    it('should handle unknown errors', async () => {
      const unknownError = new Error('Network error');
      (mockClient.chat.completions.create as jest.Mock).mockRejectedValue(unknownError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4o-mini',
      };

      await expect(assistant.chat(request)).rejects.toEqual(unknownError);
    });
  });

  describe('stream', () => {
    it('should handle streaming responses', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                delta: { content: 'Hello' },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                delta: { content: ' world!' },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
        },
      };

      (mockClient.chat.completions.create as jest.Mock).mockResolvedValue(mockStreamResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4o-mini',
      };

      const chunks: any[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0].message.content).toEqual([{ type: 'text', text: 'Hello' }]);
      expect(chunks[1].message.content).toEqual([{ type: 'text', text: ' world!' }]);
      expect(chunks[2].finish_reason).toBe('stop');
    });

    it('should handle streaming with tool calls', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            id: 'chatcmpl-456',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_123',
                      type: 'function',
                      function: {
                        name: 'getCurrentTime',
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: 'chatcmpl-456',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments: '{}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: 'chatcmpl-456',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'tool_calls',
              },
            ],
          };
        },
      };

      (mockClient.chat.completions.create as jest.Mock).mockResolvedValue(mockStreamResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'What time is it?',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4o-mini',
        tools: [
          {
            type: 'function',
            function: {
              name: 'getCurrentTime',
              description: 'Get the current time',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
        ],
      };

      const chunks: any[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.finish_reason).toBe('tool_calls');
    });

    it('should handle streaming errors', async () => {
      const apiError = {
        status: 403,
        message: 'Rate limit exceeded',
        code: 'rate_limit_exceeded',
      };
      
      Object.setPrototypeOf(apiError, OpenAI.APIError.prototype);

      (mockClient.chat.completions.create as jest.Mock).mockRejectedValue(apiError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gpt-4o-mini',
      };

      const streamGenerator = assistant.stream(request);
      await expect(streamGenerator.next()).rejects.toMatchObject({
        code: 'rate_limit_exceeded',
        message: 'Rate limit exceeded',
      });
    });
  });
});
