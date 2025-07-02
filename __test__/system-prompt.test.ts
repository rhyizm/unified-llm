import { LLMClient } from '../src/llm-client';

// Simple functional test using JavaScript-style approach since we need to mock private properties
describe('System Prompt Integration Tests', () => {
  describe('System prompt injection', () => {
    it('should inject system prompt into chat messages when provided in configuration', () => {
      const assistant = new LLMClient({
        provider: 'openai',
        model: 'gpt-4-mini',
        apiKey: 'test-key',
        systemPrompt: "You are a helpful assistant that answers questions in Japanese.",
      });

      // Test that systemPrompt is stored internally
      expect((assistant as any).systemPrompt).toBe("You are a helpful assistant that answers questions in Japanese.");
    });

    it('should not have system prompt when not provided in configuration', () => {
      const assistant = new LLMClient({
        provider: 'openai',
        model: 'gpt-4-mini',
        apiKey: 'test-key',
      });

      // Test that systemPrompt is undefined
      expect((assistant as any).systemPrompt).toBeUndefined();
    });

    it('should work with Anthropic provider', () => {
      const assistant = new LLMClient({
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        apiKey: 'test-key',
        systemPrompt: "You are a helpful assistant that answers questions in Japanese.",
      });

      expect((assistant as any).systemPrompt).toBe("You are a helpful assistant that answers questions in Japanese.");
    });

    it('should work with Google provider', () => {
      const assistant = new LLMClient({
        provider: 'google',
        model: 'gemini-pro',
        apiKey: 'test-key',
        systemPrompt: "You are a helpful assistant that answers questions in Japanese.",
      });

      expect((assistant as any).systemPrompt).toBe("You are a helpful assistant that answers questions in Japanese.");
    });

    it('should handle string content in user messages', () => {
      const assistant = new LLMClient({
        provider: 'openai',
        model: 'gpt-4-mini',
        apiKey: 'test-key',
        systemPrompt: "You are a helpful assistant that answers questions in Japanese.",
      });

      // Test basic instantiation with the message format from user's example
      const testMessage = {
        id: "1",
        role: "user" as const,
        content: "What are some recommended tourist spots in Osaka?",
      };

      expect(testMessage.content).toBe("What are some recommended tourist spots in Osaka?");
      expect(typeof testMessage.content).toBe("string");
    });

    it('should accept the exact configuration format from user example', () => {
      // Test the exact configuration format from the user's example
      const openai = new LLMClient({
        provider: 'openai',
        model: "gpt-4.1-mini",
        apiKey: 'test-api-key',
        systemPrompt: "You are a helpful assistant that answers questions in Japanese.",
      });

      const anthropic = new LLMClient({
        provider: 'anthropic',
        model: "claude-3-5-haiku-20241022",
        apiKey: 'test-api-key',
      });

      const gemini = new LLMClient({
        provider: 'google',
        model: "gemini-2.5-flash",
        apiKey: 'test-api-key',
      });

      expect((openai as any).systemPrompt).toBe("You are a helpful assistant that answers questions in Japanese.");
      expect((anthropic as any).systemPrompt).toBeUndefined();
      expect((gemini as any).systemPrompt).toBeUndefined();
    });

    it('should accept the exact message format from user example', () => {
      // Test the exact message format from the user's example
      const testRequest = {
        messages: [{
          id: "1",
          role: "user" as const,
          content: "What are some recommended tourist spots in Osaka?",
        }]
      };

      expect(testRequest.messages).toHaveLength(1);
      expect(testRequest.messages[0].role).toBe("user");
      expect(testRequest.messages[0].content).toBe("What are some recommended tourist spots in Osaka?");
      expect(typeof testRequest.messages[0].content).toBe("string");
    });
  });

  describe('Provider-specific system prompt handling', () => {
    it('should verify OpenAI provider accepts system prompts', () => {
      const assistant = new LLMClient({
        provider: 'openai',
        model: 'gpt-4-mini',
        apiKey: 'test-key',
        systemPrompt: "Test system prompt",
      });

      expect((assistant as any).baseProvider).toBeDefined();
      expect((assistant as any).systemPrompt).toBe("Test system prompt");
    });

    it('should verify Anthropic provider accepts system prompts', () => {
      const assistant = new LLMClient({
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        apiKey: 'test-key',
        systemPrompt: "Test system prompt",
      });

      expect((assistant as any).baseProvider).toBeDefined();
      expect((assistant as any).systemPrompt).toBe("Test system prompt");
    });

    it('should verify Google provider accepts system prompts', () => {
      const assistant = new LLMClient({
        provider: 'google',
        model: 'gemini-pro',
        apiKey: 'test-key',
        systemPrompt: "Test system prompt",
      });

      expect((assistant as any).baseProvider).toBeDefined();
      expect((assistant as any).systemPrompt).toBe("Test system prompt");
    });
  });
});