/**
 * AnthropicProvider Test Suite
 * Anthropicアシスタントのテストスイート
 * 
 * Purpose: Tests the AnthropicProvider class functionality including:
 * 目的: AnthropicProviderクラスの機能をテストします：
 * - Constructor initialization / コンストラクタ初期化
 * - Chat completion / チャット完了
 * - Error handling / エラーハンドリング
 * - Streaming responses / ストリーミング応答
 * - Tool usage / ツール使用
 */

import { AnthropicProvider } from '../src/providers/anthropic';
import Anthropic from '@anthropic-ai/sdk';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  Message,
  ToolDefinition,
} from '../src/types/unified-api';

// Mock Anthropic SDK to avoid actual API calls during testing
// テスト中の実際のAPI呼び出しを避けるためAnthropic SDKをモック
jest.mock('@anthropic-ai/sdk');

describe('AnthropicProvider', () => {
  let assistant: AnthropicProvider;
  let mockClient: jest.Mocked<Anthropic>;

  /**
   * Setup: Initialize test environment before each test
   * セットアップ: 各テスト前にテスト環境を初期化
   */
  beforeEach(() => {
    // Create mock Anthropic client with required methods
    // 必要なメソッドを持つモックAnthropicクライアントを作成
    mockClient = {
      messages: {
        create: jest.fn(),
      },
    } as any;

    // Mock Anthropic constructor to return our mock client
    // Anthropicコンストラクタがモックくライアントを返すようにモック
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => mockClient);

    // Initialize assistant instance for testing
    // テスト用のアシスタントインスタンスを初期化
    assistant = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-haiku-20240307',
    });
  });

  /**
   * Cleanup: Reset all mocks after each test to ensure test isolation
   * クリーンアップ: テストの分離を確保するため各テスト後にモックをリセット
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test Group: Constructor behavior validation
   * テストグループ: コンストラクタの動作検証
   */
  describe('constructor', () => {
    /**
     * Test: Custom model initialization
     * テスト: カスタムモデルの初期化
     * Verifies that assistant can be created with a specific model
     * 特定のモデルでアシスタントが作成できることを検証
     */
    it('should initialize with default model', () => {
      const defaultAssistant = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229',
      });
      expect(defaultAssistant).toBeInstanceOf(AnthropicProvider);
    });
  });

  /**
   * Test Group: Chat functionality validation
   * テストグループ: チャット機能の検証
   */
  describe('chat', () => {
    /**
     * Test: Basic text message handling
     * テスト: 基本的なテキストメッセージの処理
     * Verifies that the assistant can process and respond to simple text messages
     * アシスタントが単純なテキストメッセージを処理し応答できることを検証
     */
    it('should handle simple text message', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello, how can I help you?', citations: null }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: 'standard' },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockResponse as any);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      const response = await assistant.chat(request);

      expect(response.id).toBe('msg_test123');
      expect(response.provider).toBe('anthropic');
      expect(response.message.content).toEqual([
        { type: 'text', text: 'Hello, how can I help you?' },
      ]);
      expect(response.usage).toEqual({
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18,
      });
    });

    it('should handle system message correctly', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'I am a helpful assistant.', citations: null }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 15, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: 'standard' },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockResponse as any);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'sys1',
            role: 'system',
            content: 'You are a helpful assistant.',
            created_at: new Date(),
          },
          {
            id: 'user1',
            role: 'user',
            content: 'Who are you?',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      await assistant.chat(request);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant.',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: [{ type: 'text', text: 'Who are you?' }],
            }),
          ]),
        })
      );
    });

    it('should handle tool calls', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'get_weather',
            input: { location: 'Tokyo' },
          },
        ],
        model: 'claude-3-opus-20240229',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 15, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: 'standard' },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockResponse as any);

      const tools: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather information',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        },
      ];

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'What is the weather in Tokyo?',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
        tools,
      };

      const response = await assistant.chat(request);

      expect(response.message.content).toEqual([
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          input: { location: 'Tokyo' },
        },
      ]);
      expect(response.finish_reason).toBe('tool_use');
    });

    it('should handle Anthropic API errors', async () => {
      const apiError = {
        status: 400,
        message: 'Bad Request',
        error: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Invalid request',
          }
        }
      };
      
      Object.setPrototypeOf(apiError, Anthropic.APIError.prototype);

      (mockClient.messages.create as jest.Mock).mockRejectedValue(apiError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      await expect(assistant.chat(request)).rejects.toEqual({
        code: 'invalid_request_error',
        message: 'Invalid request',
        type: 'invalid_request',
        status_code: 400,
        provider: 'anthropic',
        details: apiError,
      });
    });

    it('should handle unknown errors', async () => {
      const unknownError = new Error('Network error');
      (mockClient.messages.create as jest.Mock).mockRejectedValue(unknownError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      await expect(assistant.chat(request)).rejects.toEqual({
        code: 'unknown_error',
        message: 'Network error',
        type: 'api_error',
        provider: 'anthropic',
        details: unknownError,
      });
    });
  });

  describe('stream', () => {
    it('should handle streaming responses', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'message_start',
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-3-haiku-20240307',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          };
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' world!' },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
          };
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 2 },
          };
          yield {
            type: 'message_stop',
          };
        },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockStreamResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-haiku-20240307',
      };

      const chunks: any[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      
      const textChunks = chunks.filter(c => c.message?.content?.[0]?.text);
      expect(textChunks.length).toBeGreaterThanOrEqual(2);
      expect(textChunks[0].message.content).toEqual([{ type: 'text', text: 'Hello' }]);
      expect(textChunks[1].message.content).toEqual([{ type: 'text', text: ' world!' }]);
    });

    it('should handle streaming with empty response', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          // Anthropic stream implementation only yields text_delta chunks
          // Empty stream case
        },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockStreamResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'What is the weather in Tokyo?',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-haiku-20240307',
      };

      const chunks: any[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(0);
    });

    it('should handle streaming errors', async () => {
      const apiError = {
        status: 429,
        message: 'Rate limit exceeded',
        error: {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded',
          }
        }
      };
      
      Object.setPrototypeOf(apiError, Anthropic.APIError.prototype);

      (mockClient.messages.create as jest.Mock).mockRejectedValue(apiError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-haiku-20240307',
      };

      // The create method will throw immediately when called
      try {
        await assistant.stream(request).next();
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeDefined();
        expect(error.message).toContain('Rate limit');
      }
    });
  });

  describe('format conversion', () => {
    it('should convert image content correctly', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'I can see the image.', citations: null }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: 'standard' },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockResponse as any);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: 'base64-image-data',
                },
              },
            ],
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      await assistant.chat(request);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                { type: 'text', text: 'What is in this image?' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: 'base64-image-data',
                  },
                },
              ]),
            }),
          ]),
        })
      );
    });

    it('should handle generation config parameters', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response with custom config.', citations: null }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: 'standard' },
      };

      (mockClient.messages.create as jest.Mock).mockResolvedValue(mockResponse as any);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
        generation_config: {
          temperature: 0.7,
          max_tokens: 1000,
          top_p: 0.9,
          top_k: 50,
          stop_sequences: ['\\n\\n'],
        },
      };

      await assistant.chat(request);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          max_tokens: 1000,
          top_p: 0.9,
          top_k: 50,
          stop_sequences: ['\\n\\n'],
        })
      );
    });
  });

  describe('error mapping', () => {
    it('should handle API errors consistently', async () => {
      const apiError = new Anthropic.APIError(
        401,
        {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
        'Unauthorized',
        new Headers()
      );

      (mockClient.messages.create as jest.Mock).mockRejectedValue(apiError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      await expect(assistant.chat(request)).rejects.toEqual(
        expect.objectContaining({
          type: 'api_error',
          code: 'anthropic_error',
          provider: 'anthropic',
        })
      );
    });

    it('should handle unknown errors', async () => {
      const unknownError = new Error('Unknown error');
      (mockClient.messages.create as jest.Mock).mockRejectedValue(unknownError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'claude-3-opus-20240229',
      };

      await expect(assistant.chat(request)).rejects.toEqual(
        expect.objectContaining({
          type: 'api_error',
          code: 'unknown_error',
          provider: 'anthropic',
        })
      );
    });
  });
});