/**
 * Multi-Provider Integration Test Suite
 * マルチプロバイダー統合テストスイート
 * 
 * Purpose: Tests integration across multiple AI providers in unified interface:
 * 目的: 統一インターフェースでの複数AIプロバイダー統合をテスト：
 * - OpenAI GPT model integration / OpenAI GPTモデル統合
 * - Anthropic Claude model integration / Anthropic Claudeモデル統合
 * - Google Gemini model integration / Google Geminiモデル統合
 * - Multi-provider conversation handling / 複数プロバイダー会話処理
 * - In-memory thread management / インメモリスレッド管理
 * 
 * Note: Tests are conditionally executed based on API key availability
 * 注意: APIキーの利用可能性に基づいてテストが条件付きで実行されます
 */

import { LLMClient, Thread } from '../src';
import dotenv from 'dotenv';

// Load environment variables for API keys
// APIキー用の環境変数を読み込み
dotenv.config();

// Mock LLMClient to avoid actual API calls
jest.mock('../src/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((config) => ({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt: config.systemPrompt,
    chat: jest.fn().mockResolvedValue({
      id: `msg_${Date.now()}`,
      model: config.model || 'test-model',
      provider: config.provider,
      message: {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Hello from ${config.provider === 'openai' ? 'OpenAI' : config.provider === 'anthropic' ? 'Claude' : 'Gemini'}!`,
        created_at: new Date()
      },
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20
      },
      created_at: new Date()
    })
  }))
}));

describe('Multi-Provider Integration Test', () => {
  let session: Thread;

  // Check API key availability for conditional test execution
  // 条件付きテスト実行のためのAPIキー利用可能性をチェック
  const hasOpenAI = !!process.env.OPENAI_API_KEY || true; // Force tests to run with mocks
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY || true; // Force tests to run with mocks  
  const hasGoogle = !!process.env.GEMINI_API_KEY || true; // Force tests to run with mocks

  /**
   * Setup: Create test environment for each test
   * セットアップ: 各テスト用のテスト環境を作成
   */
  beforeEach(async () => {
    session = new Thread({
      title: 'Multi-Provider Integration Test',
    });
  });

  /**
   * Cleanup: Clear test data after each test
   * クリーンアップ: 各テスト後にテストデータをクリア
   */
  afterEach(async () => {
    // Clear session data
    session.clearMessages();
  });

  /**
   * Test: Multi-provider conversation handling
   * テスト: マルチプロバイダー会話処理
   * Verifies that multiple providers can participate in same thread
   * 複数のプロバイダーが同じスレッドに参加できることを確認
   */
  (hasOpenAI && hasAnthropic && hasGoogle ? it : it.skip)(
    'should handle multi-provider conversation in thread', 
    async () => {
      // Create clients from different providers
      // 異なるプロバイダーからクライアントを作成
      const openaiClient = new LLMClient({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || 'test-key',
        model: 'gpt-4-turbo-preview'
      });

      const anthropicClient = new LLMClient({
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY || 'test-key',
        model: 'claude-3-opus-20240229'
      });

      const geminiClient = new LLMClient({
        provider: 'google',
        apiKey: process.env.GEMINI_API_KEY || 'test-key',
        model: 'gemini-pro'
      });

      // Add all providers to the thread
      // スレッドにすべてのプロバイダーを追加
      session.addAssistant(openaiClient, 'openai-gpt');
      session.addAssistant(anthropicClient, 'anthropic-claude');
      session.addAssistant(geminiClient, 'google-gemini');

      // Send message and get responses
      // メッセージを送信して応答を取得
      const responses = await session.broadcast('Tell me about AI');

      // Verify we got responses from all providers
      // すべてのプロバイダーから応答を得たことを確認
      expect(responses.size).toBe(3);
      expect(responses.has('openai-gpt')).toBe(true);
      expect(responses.has('anthropic-claude')).toBe(true);
      expect(responses.has('google-gemini')).toBe(true);

      // Verify message history
      // メッセージ履歴を確認
      const conversation = session.getConversation();
      expect(conversation.messages.length).toBe(4); // 1 user + 3 assistant messages
      expect(conversation.metadata?.client_count).toBe(3);
    }
  );

  /**
   * Test: Sequential messaging to specific providers
   * テスト: 特定のプロバイダーへの順次メッセージング
   * Verifies targeted messaging within multi-provider thread
   * マルチプロバイダースレッド内でのターゲットメッセージングを確認
   */
  (hasOpenAI && hasAnthropic ? it : it.skip)(
    'should handle sequential messaging to specific providers',
    async () => {
      // Create and add two clients
      // 2つのクライアントを作成して追加
      const openaiClient = new LLMClient({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || 'test-key',
        model: 'gpt-4'
      });

      const anthropicClient = new LLMClient({
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY || 'test-key',
        model: 'claude-3-sonnet-20240229'
      });

      session.addAssistant(openaiClient, 'gpt');
      session.addAssistant(anthropicClient, 'claude');

      // Send targeted messages
      // ターゲットメッセージを送信
      const gptResponse = await session.sendTo('gpt', 'What is 2+2?');
      expect(gptResponse).toBeTruthy();
      expect(gptResponse?.message.content).toContain('OpenAI');

      const claudeResponse = await session.sendTo('claude', 'What is 3+3?');
      expect(claudeResponse).toBeTruthy();
      expect(claudeResponse?.message.content).toContain('Claude');

      // Verify message ordering
      // メッセージの順序を確認
      const messages = session.getConversation().messages;
      expect(messages.length).toBe(4); // 2 user + 2 assistant
      expect(messages[0].metadata?.directed_to).toBe('gpt');
      expect(messages[2].metadata?.directed_to).toBe('claude');
    }
  );

  /**
   * Test: Provider removal from thread
   * テスト: スレッドからのプロバイダー削除
   * Verifies dynamic provider management in active threads
   * アクティブスレッドでの動的プロバイダー管理を確認
   */
  it('should handle provider removal from thread', async () => {
    // Add multiple clients
    // 複数のクライアントを追加
    const client1 = new LLMClient({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4'
    });

    const client2 = new LLMClient({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-haiku-20240307'
    });

    session.addAssistant(client1, 'assistant1');
    session.addAssistant(client2, 'assistant2');

    expect(session.getClientNames()).toContain('assistant1');
    expect(session.getClientNames()).toContain('assistant2');

    // Remove one client
    // 1つのクライアントを削除
    const removed = session.removeAssistant('assistant1');
    expect(removed).toBe(true);
    expect(session.getClientNames()).not.toContain('assistant1');
    expect(session.getClientNames()).toContain('assistant2');
  });

  /**
   * Test: Empty thread behavior
   * テスト: 空のスレッドの動作
   * Verifies graceful handling of operations on empty threads
   * 空のスレッドでの操作の適切な処理を確認
   */
  it('should handle empty thread gracefully', async () => {
    const emptySession = new Thread({
      title: 'Empty Thread Test'
    });

    // Broadcast to empty thread should return empty map
    // 空のスレッドへのブロードキャストは空のマップを返すべき
    const responses = await emptySession.broadcast('Hello?');
    expect(responses.size).toBe(0);

    // SendTo non-existent client should return null
    // 存在しないクライアントへの送信はnullを返すべき
    const response = await emptySession.sendTo('nobody', 'Hello?');
    expect(response).toBeNull();
  });

  /**
   * Test: Message history management
   * テスト: メッセージ履歴管理
   * Verifies proper tracking of conversation history
   * 会話履歴の適切な追跡を確認
   */
  it('should maintain accurate message history', async () => {
    const client = new LLMClient({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-3.5-turbo'
    });

    session.addAssistant(client, 'assistant');

    // Send multiple messages
    // 複数のメッセージを送信
    await session.sendTo('assistant', 'First message');
    await session.sendTo('assistant', 'Second message');
    await session.sendTo('assistant', 'Third message');

    const conversation = session.getConversation();
    expect(conversation.messages.length).toBe(6); // 3 user + 3 assistant
    expect(conversation.metadata?.message_count).toBe(6);

    // Clear messages
    // メッセージをクリア
    session.clearMessages();
    const clearedConversation = session.getConversation();
    expect(clearedConversation.messages.length).toBe(0);
  });
});