import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/llm-client';
import type { Message, TextContent } from '../../src/types/unified-api';
import dotenv from 'dotenv';

dotenv.config();

const providers = [
  { 
    name: 'OpenAI',
    config: {
      provider: 'openai' as const,
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-5-nano'
    }
  },
  {
    name: 'Anthropic',
    config: {
      provider: 'anthropic' as const,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-haiku-latest'
    }
  },
  {
    name: 'Google Gemini',
    config: {
      provider: 'google' as const,
      apiKey: process.env.GOOGLE_API_KEY,
      model: 'gemini-2.5-flash'
    }
  },
  {
    name: 'DeepSeek',
    config: {
      provider: 'deepseek' as const,
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat'
    }
  },
  {
    name: 'Azure OpenAI',
    config: {
      provider: 'azure' as const,
      apiKey: process.env.AZURE_OPENAI_KEY,
      baseURL: process.env.AZURE_OPENAI_ENDPOINT,
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION,
      model: 'gpt-5-nano'
    }
  }
];

describe('Chat E2E Tests', () => {
  const getTextFromContent = (content: Message['content']): string => {
    if (typeof content === 'string') return content;
    const firstText = content.find((c): c is TextContent => c.type === 'text');
    return firstText?.text ?? '';
  };

  providers.forEach(({ name, config }) => {    
    describe(`${name} Provider`, () => {
      let client: LLMClient;

      beforeAll(() => {
        client = new LLMClient(config);
      });

      it('should handle simple text message', async () => {
        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Could you count from 5 to 1?'
            }
          ]
        });

        expect(response.message).toBeDefined();
        expect(response.message.role).toBe('assistant');
        expect(response.message.content).toBeDefined();
        
        const content = getTextFromContent(response.message.content);
        const text = getTextFromContent(response.text);
        
        expect(content).toContain('1');
        expect(content).toContain('2');
        expect(content).toContain('3');
        expect(content).toContain('4');
        expect(content).toContain('5');
        expect(text).toContain('1');
        expect(text).toContain('2');
        expect(text).toContain('3');
        expect(text).toContain('4');
        expect(text).toContain('5');
      }, 30000);

      it('should handle multi-turn conversation', async () => {
        const response1 = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'My name is TestUser. Remember this.'
            }
          ]
        });

        expect(response1.message).toBeDefined();

        const response2 = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'My name is TestUser. Remember this.'
            },
            response1.message,
            {
              role: 'user',
              content: 'What is my name? Reply with just the name.'
            }
          ]
        });

        const content = getTextFromContent(response2.text);

        expect(content).toContain('TestUser');
      }, 30000);

      it('should handle system prompts', async () => {
        const clientWithSystem = new LLMClient({
          ...config,
          systemPrompt: 'You are an LLM tester temporarily launched during testing of Unified LLM. Unified LLM was developed by rhyizm <rhyizm@gmail.com>.'
        });

        const response = await clientWithSystem.chat({
          messages: [
            {
              role: 'user',
              content: 'Who created Unified LLM?'
            }
          ]
        });

        const content = getTextFromContent(response.message.content);

        expect(content).toContain('rhyizm');
      }, 30000);
    });
  });
});
