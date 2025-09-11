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
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      model: 'gpt-4o-mini'
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
    const shouldSkip = !config.apiKey || (config.provider === 'azure' && (!config.endpoint || !config.deploymentName));
    
    describe.skipIf(shouldSkip)(`${name} Provider`, () => {
      let client: LLMClient;

      beforeAll(() => {
        client = new LLMClient(config);
      });

      it('should handle simple text message', async () => {
        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Reply with exactly: "Hello from unified-llm"'
            }
          ]
        });

        expect(response.message).toBeDefined();
        expect(response.message.role).toBe('assistant');
        expect(response.message.content).toBeDefined();
        
        const content = getTextFromContent(response.message.content);
        
        expect(content.toLowerCase()).toContain('hello from unified-llm');
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

        const content = getTextFromContent(response2.message.content);

        expect(content).toContain('TestUser');
      }, 30000);

      it('should handle system prompts', async () => {
        const clientWithSystem = new LLMClient({
          ...config,
          systemPrompt: 'You are a helpful assistant that always responds in JSON format.'
        });

        const response = await clientWithSystem.chat({
          messages: [
            {
              role: 'user',
              content: 'Create a simple user object with name "Alice" and age 30'
            }
          ]
        });

        const content = getTextFromContent(response.message.content);

        expect(content).toContain('Alice');
        expect(content).toContain('30');
      }, 30000);

      it('should handle temperature setting', async () => {
        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Generate a random number between 1 and 10'
            }
          ],
          generationConfig: {
            temperature: 0
          }
        });

        expect(response.message).toBeDefined();
        
        const response2 = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Generate a random number between 1 and 10'
            }
          ],
          generationConfig: {
            temperature: 0
          }
        });

        expect(response2.message).toBeDefined();
      }, 30000);
    });
  });
});
