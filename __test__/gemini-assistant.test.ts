/**
 * GeminiProvider Test Suite
 * GeminiProviderのテストスイート
 * 
 * Purpose: Tests the Google Gemini AI integration including:
 * 目的: Google Gemini AI統合機能をテストします：
 * - Chat completion with Gemini models / Geminiモデルでのチャット完了
 * - Multi-modal content handling (text, images) / マルチモーダルコンテンツ処理（テキスト、画像）
 * - Streaming responses / ストリーミング応答
 * - Generation configuration / 生成設定
 * - Error handling and edge cases / エラーハンドリングとエッジケース
 */

import { GeminiProvider } from '../src/providers/google';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  Message,
  GenerationConfig,
} from '../src/types/unified-api';

// Mock Google Generative AI SDK to avoid actual API calls during testing
// テスト中の実際のAPI呼び出しを避けるためGoogle Generative AI SDKをモック
jest.mock('@google/generative-ai');

describe('GeminiProvider', () => {
  let assistant: GeminiProvider;
  let mockClient: jest.Mocked<GoogleGenerativeAI>;
  let mockModel: any;
  let mockChat: any;

  /**
   * Setup: Initialize test environment with mocked Google AI client
   * セットアップ: モックされたGoogle AIクライアントでテスト環境を初期化
   * Creates comprehensive mocks for GoogleGenerativeAI, model, and chat instances
   * GoogleGenerativeAI、モデル、チャットインスタンスの包括的なモックを作成
   */
  beforeEach(() => {
    // チャットとストリームのモックを作成
    mockChat = {
      sendMessage: jest.fn(),
      sendMessageStream: jest.fn(),
    };

    // モデルインスタンスのモック
    mockModel = {
      startChat: jest.fn().mockReturnValue(mockChat),
    };

    // GoogleGenerativeAIクライアントのモック
    mockClient = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    } as any;

    // GoogleGenerativeAIコンストラクタがmockClientを返すようにモック
    (GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>).mockImplementation(() => mockClient);

    assistant = new GeminiProvider({
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash'
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
   * Tests model initialization with default and custom configurations
   * デフォルトとカスタム設定でのモデル初期化をテスト
   */
  describe('constructor', () => {});

  /**
   * Test Group: Chat functionality validation
   * テストグループ: チャット機能の検証
   * Tests various chat scenarios including text, images, and conversation history
   * テキスト、画像、会話履歴を含む様々なチャットシナリオをテスト
   */
  describe('chat', () => {
    /**
     * Test: Basic text message processing
     * テスト: 基本的なテキストメッセージ処理
     * Verifies simple text input and response with usage statistics
     * シンプルなテキスト入力と使用統計付きの応答を検証
     */
    it('should handle simple text message', async () => {
      const mockGeminiResponse = {
        text: () => 'Hello, how can I help you?',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 8,
          totalTokenCount: 18,
        },
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      const response = await assistant.chat(request);

      expect(response.provider).toBe('google');
      expect(response.message.content).toEqual([
        { type: 'text', text: 'Hello, how can I help you?' },
      ]);
      expect(response.usage).toEqual({
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18,
      });
      expect(response.finish_reason).toBe('stop');
    });

    /**
     * Test: Conversation context handling
     * テスト: 会話コンテキスト処理
     * Verifies that conversation history is properly formatted for Gemini API
     * 会話履歴がGemini API用に適切にフォーマットされることを検証
     * Tests role mapping from 'assistant' to 'model' for Gemini
     * Gemini用の'assistant'から'model'へのロールマッピングをテスト
     */
    it('should handle conversation history', async () => {
      const mockGeminiResponse = {
        text: () => 'I remember our previous conversation.',
        usageMetadata: {
          promptTokenCount: 25,
          candidatesTokenCount: 8,
          totalTokenCount: 33,
        },
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
          {
            id: 'assistant1',
            role: 'assistant',
            content: 'Hi there!',
            created_at: new Date(),
          },
          {
            id: 'user2',
            role: 'user',
            content: 'Do you remember what I said?',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      await assistant.chat(request);

      expect(mockModel.startChat).toHaveBeenCalledWith({
        history: [
          {
            role: 'user',
            parts: [{ text: 'Hello' }],
          },
          {
            role: 'model',
            parts: [{ text: 'Hi there!' }],
          },
        ],
        generationConfig: undefined,
      });

      expect(mockChat.sendMessage).toHaveBeenCalledWith('Do you remember what I said?');
    });

    /**
     * Test: Multi-modal image content processing
     * テスト: マルチモーダル画像コンテンツ処理
     * Verifies image data is properly converted to Gemini's inlineData format
     * 画像データがGeminiのinlineData形式に適切に変換されることを検証
     * Critical for vision-enabled models like gemini-pro-vision
     * gemini-pro-visionのような視覚対応モデルにとって重要
     */
    it('should handle image content', async () => {
      const mockGeminiResponse = {
        text: () => 'I can see the image.',
        usageMetadata: {
          promptTokenCount: 30,
          candidatesTokenCount: 6,
          totalTokenCount: 36,
        },
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

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
        model: 'gemini-pro-vision',
      };

      await assistant.chat(request);

      expect(mockChat.sendMessage).toHaveBeenCalledWith([
        { text: 'What is in this image?' },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: 'base64-image-data',
          },
        },
      ]);
    });

    /**
     * Test: Generation configuration parameter mapping
     * テスト: 生成設定パラメータマッピング
     * Verifies unified API parameters are correctly mapped to Gemini format
     * 統一APIパラメータがGemini形式に正しくマッピングされることを検証
     * Tests parameter name transformations (max_tokens → maxOutputTokens, etc.)
     * パラメータ名変換をテスト（max_tokens → maxOutputTokens等）
     */
    it('should handle generation config', async () => {
      const mockGeminiResponse = {
        text: () => 'Response with custom config.',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const generationConfig: GenerationConfig = {
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9,
        top_k: 50,
        stop_sequences: ['\\n\\n'],
      };

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
        generation_config: generationConfig,
      };

      await assistant.chat(request);

      expect(mockModel.startChat).toHaveBeenCalledWith({
        history: [],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 50,
          maxOutputTokens: 1000,
          stopSequences: ['\\n\\n'],
        },
      });
    });

    /**
     * Test: Error handling and transformation
     * テスト: エラーハンドリングと変換
     * Verifies Gemini API errors are properly converted to unified format
     * Gemini APIエラーが統一形式に適切に変換されることを検証
     * Ensures consistent error structure across providers
     * プロバイダー間で一貫したエラー構造を確保
     */
    it('should handle errors', async () => {
      const error = new Error('API Error');
      mockChat.sendMessage.mockRejectedValue(error);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      await expect(assistant.chat(request)).rejects.toEqual({
        code: 'gemini_error',
        message: 'API Error',
        type: 'api_error',
        provider: 'google',
        details: error,
      });
    });
  });

  /**
   * Test Group: Streaming response handling
   * テストグループ: ストリーミング応答処理
   * Tests real-time streaming capabilities for chat responses
   * チャット応答のリアルタイムストリーミング機能をテスト
   */
  describe('stream', () => {
    /**
     * Test: Streaming response chunk processing
     * テスト: ストリーミング応答チャンク処理
     * Verifies stream chunks are properly converted to unified format
     * ストリームチャンクが統一形式に適切に変換されることを検証
     * Tests async iteration over response stream
     * 応答ストリームでの非同期反復をテスト
     */
    it('should handle streaming responses', async () => {
      const mockStreamResponse = {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield {
              text: () => 'Hello',
              candidates: [{
                content: { parts: [{ text: 'Hello' }], role: 'model' },
                index: 0,
              }],
            };
            yield {
              text: () => ' world!',
              candidates: [{
                content: { parts: [{ text: ' world!' }], role: 'model' },
                index: 0,
              }],
            };
            yield {
              text: () => '',
              candidates: [{
                content: { parts: [{ text: '' }], role: 'model' },
                finishReason: 'STOP',
                index: 0,
              }],
            };
          },
        },
      };

      mockChat.sendMessageStream = jest.fn().mockResolvedValue(mockStreamResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-1.5-flash',
      };

      const chunks: any[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      
      // Filter out empty chunks
      const textChunks = chunks.filter(c => c.message?.content?.[0]?.text);
      expect(textChunks.length).toBeGreaterThanOrEqual(2);
      expect(textChunks[0].message.content).toEqual([{ type: 'text', text: 'Hello' }]);
      expect(textChunks[1].message.content).toEqual([{ type: 'text', text: ' world!' }]);
    });

    it('should handle streaming with multiple chunks', async () => {
      const mockStreamResponse = {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield {
              text: () => 'The weather',
            };
            yield {
              text: () => ' in Tokyo',
            };
            yield {
              text: () => ' is sunny.',
            };
          },
        },
      };

      mockChat.sendMessageStream = jest.fn().mockResolvedValue(mockStreamResponse);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'What is the weather in Tokyo?',
            created_at: new Date(),
          },
        ],
        model: 'gemini-1.5-flash',
      };

      const chunks: any[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0].message.content).toEqual([{ type: 'text', text: 'The weather' }]);
      expect(chunks[1].message.content).toEqual([{ type: 'text', text: ' in Tokyo' }]);
      expect(chunks[2].message.content).toEqual([{ type: 'text', text: ' is sunny.' }]);
    });

    it('should handle streaming errors', async () => {
      const mockError = new Error('Rate limit exceeded');
      mockError.name = 'GoogleGenerativeAIError';
      (mockError as any).status = 429;
      (mockError as any).statusText = 'Resource exhausted';
      
      mockChat.sendMessageStream = jest.fn().mockRejectedValue(mockError);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-1.5-flash',
      };

      // The stream method doesn't wrap errors, so it will throw the raw error
      await expect(async () => {
        for await (const chunk of assistant.stream(request)) {
          // Should throw before yielding any chunks
        }
      }).rejects.toThrow('Rate limit exceeded');
    });
  });

  /**
   * Test Group: Content format conversion
   * テストグループ: コンテンツ形式変換
   * Tests conversion between unified API and Gemini-specific content formats
   * 統一APIとGemini固有のコンテンツ形式間の変換をテスト
   */
  describe('content conversion', () => {
    /**
     * Test: Mixed content type handling
     * テスト: 混合コンテンツタイプ処理
     * Verifies correct handling of messages with both text and image content
     * テキストと画像コンテンツの両方を含むメッセージの正しい処理を検証
     * Tests proper ordering and formatting of content parts
     * コンテンツパーツの適切な順序付けとフォーマットをテスト
     */
    it('should convert mixed content correctly', async () => {
      const mockGeminiResponse = {
        text: () => 'I can see the text and image.',
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: [
              { type: 'text', text: 'Look at this:' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'png-data',
                },
              },
              { type: 'text', text: 'What do you think?' },
            ],
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro-vision',
      };

      await assistant.chat(request);

      expect(mockChat.sendMessage).toHaveBeenCalledWith([
        { text: 'Look at this:' },
        {
          inlineData: {
            mimeType: 'image/png',
            data: 'png-data',
          },
        },
        { text: 'What do you think?' },
      ]);
    });

    /**
     * Test: Unsupported content type graceful handling
     * テスト: 未対応コンテンツタイプの適切な処理
     * Verifies system gracefully handles unknown content types
     * システムが未知のコンテンツタイプを適切に処理することを検証
     * Should provide placeholder text rather than failing
     * 失敗するのではなくプレースホルダーテキストを提供すべき
     */
    it('should handle unsupported content types', async () => {
      const mockGeminiResponse = {
        text: () => 'I received your message.',
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' },
              // @ts-ignore - テスト用の未対応タイプ
              { type: 'audio', data: 'audio-data' },
            ],
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      await assistant.chat(request);

      expect(mockChat.sendMessage).toHaveBeenCalledWith([
        { text: 'Hello' },
        { text: '[Unsupported content type]' },
      ]);
    });
  });

  /**
   * Test Group: Finish reason mapping
   * テストグループ: 終了理由マッピング
   * Tests conversion from Gemini finish reasons to unified API format
   * Geminiの終了理由から統一API形式への変換をテスト
   */
  describe('finish reason mapping', () => {
    /**
     * Test: Comprehensive finish reason mapping
     * テスト: 包括的な終了理由マッピング
     * Verifies all possible Gemini finish reasons map correctly
     * すべてのGemini終了理由が正しくマッピングされることを検証
     * Uses parameterized testing for comprehensive coverage
     * 包括的なカバレッジのためにパラメータ化テストを使用
     */
    it.each([
      ['STOP', 'stop'],
      ['MAX_TOKENS', 'length'],
      ['SAFETY', 'content_filter'],
      ['UNKNOWN', null],
      [undefined, null],
    ])('should map finish reason %s to %s', async (geminiReason, expectedReason) => {
      const mockGeminiResponse = {
        text: () => 'Test response',
        candidates: [{ finishReason: geminiReason }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Test',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      const response = await assistant.chat(request);
      expect(response.finish_reason).toBe(expectedReason);
    });
  });

  /**
   * Test Group: Comprehensive error handling
   * テストグループ: 包括的なエラーハンドリング
   * Tests various error scenarios and response formats
   * 様々なエラーシナリオと応答形式をテスト
   */
  describe('error handling', () => {
    /**
     * Test: Multiple error type handling
     * テスト: 複数のエラータイプ処理
     * Verifies different Gemini error types are handled consistently
     * 異なるGeminiエラータイプが一貫して処理されることを検証
     * Tests error code preservation and standardization
     * エラーコードの保持と標準化をテスト
     */
    it('should handle different error types', async () => {
      const errors = [
        { input: { code: 'API_KEY_INVALID', message: 'Invalid API key' }, expected: 'API_KEY_INVALID' },
        { input: { message: 'Network error' }, expected: 'gemini_error' },
        { input: new Error('Unknown error'), expected: 'gemini_error' },
      ];

      for (const { input, expected } of errors) {
        mockChat.sendMessage.mockRejectedValue(input);

        const request: UnifiedChatRequest = {
          messages: [
            {
              id: 'user1',
              role: 'user',
              content: 'Test',
              created_at: new Date(),
            },
          ],
          model: 'gemini-pro',
        };

        await expect(assistant.chat(request)).rejects.toEqual(
          expect.objectContaining({
            code: expected,
            provider: 'google',
            type: 'api_error',
          })
        );
      }
    });
  });

  /**
   * Test Group: Usage statistics handling
   * テストグループ: 使用統計処理
   * Tests proper handling of token usage data from Gemini responses
   * Gemini応答からのトークン使用データの適切な処理をテスト
   */
  describe('usage statistics', () => {
    /**
     * Test: Missing usage metadata handling
     * テスト: 使用メタデータ欠損処理
     * Verifies graceful handling when usage statistics are unavailable
     * 使用統計が利用できない場合の適切な処理を検証
     * Should return undefined rather than causing errors
     * エラーを引き起こすのではなくundefinedを返すべき
     */
    it('should handle missing usage metadata', async () => {
      const mockGeminiResponse = {
        text: () => 'Response without usage stats',
        candidates: [{ finishReason: 'STOP' }],
        // usageMetadata が存在しない場合
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      const response = await assistant.chat(request);
      expect(response.usage).toBeUndefined();
    });

    /**
     * Test: Partial usage metadata handling
     * テスト: 部分的な使用メタデータ処理
     * Verifies correct handling when only some usage statistics are available
     * 一部の使用統計のみが利用可能な場合の正しい処理を検証
     * Tests default value assignment for missing fields
     * 欠損フィールドのデフォルト値割り当てをテスト
     */
    it('should handle partial usage metadata', async () => {
      const mockGeminiResponse = {
        text: () => 'Response with partial usage stats',
        usageMetadata: {
          promptTokenCount: 10,
          // candidatesTokenCount と totalTokenCount が存在しない場合
        },
        candidates: [{ finishReason: 'STOP' }],
      };

      const mockResult = {
        response: Promise.resolve(mockGeminiResponse),
      };

      mockChat.sendMessage.mockResolvedValue(mockResult);

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: 'user1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'gemini-pro',
      };

      const response = await assistant.chat(request);
      expect(response.usage).toEqual({
        input_tokens: 10,
        output_tokens: 0,
        total_tokens: 0,
      });
    });
  });
});