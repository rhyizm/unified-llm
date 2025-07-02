import { AzureOpenAIProvider } from '../src/providers/azure';
import { UnifiedChatRequest } from '../src/types/unified-api';
import OpenAI from 'openai';

// Mock OpenAI client (Azure extends OpenAI)
jest.mock('openai');

describe('AzureOpenAIProvider', () => {
  let assistant: AzureOpenAIProvider;
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

    // Mock OpenAI constructor
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockClient);
    
    // Also create mock for AzureOpenAI as property of OpenAI
    const AzureOpenAIMock = jest.fn().mockImplementation(() => mockClient);
    (OpenAI as any).AzureOpenAI = AzureOpenAIMock;

    assistant = new AzureOpenAIProvider(
      {
        endpoint: 'https://test.openai.azure.com',
        deployment: 'test-deployment',
        apiVersion: '2024-02-01',
      },
      {
        apiKey: 'test-api-key',
      }
    );
  });

  describe('constructor', () => {
    it('should initialize with Azure configuration', () => {
      expect(assistant).toBeInstanceOf(AzureOpenAIProvider);
    });
  });

  describe('chat', () => {
    it('should handle simple text message', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
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
      };

      const response = await assistant.chat(request);

      expect(response).toMatchObject({
        id: 'chatcmpl-123',
        provider: 'openai', // Azure provider extends OpenAI and returns 'openai' as provider
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

    it('should handle tool calls', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-456',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
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

  describe('stream', () => {
    it('should handle streaming responses', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4',
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
            model: 'gpt-4',
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
            model: 'gpt-4',
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
            model: 'gpt-4',
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
            model: 'gpt-4',
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
            model: 'gpt-4',
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
      const apiError = new Error('Rate limit exceeded');
      (apiError as any).status = 429;
      (apiError as any).code = 'rate_limit_exceeded';

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
      };

      // Azure extends OpenAI provider which doesn't transform stream errors
      const streamGenerator = assistant.stream(request);
      await expect(streamGenerator.next()).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('error handling', () => {
    it('should handle API errors', async () => {
      const apiError = new Error('Invalid API key');
      (apiError as any).status = 401;
      (apiError as any).code = 'invalid_api_key';

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
      };

      // Azure extends OpenAI provider which transforms errors
      await expect(assistant.chat(request)).rejects.toMatchObject({
        code: 'invalid_api_key',
        message: 'Invalid API key',
      });
    });

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
      };

      await expect(assistant.chat(request)).rejects.toEqual(unknownError);
    });
  });
});