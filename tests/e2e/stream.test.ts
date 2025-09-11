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

describe('Stream E2E Tests', () => {
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

      it('should stream simple text response', async () => {
        const chunks: any[] = [];
        
        for await (const chunk of client.stream({
          messages: [
            {
              role: 'user',
              content: 'Count from 1 to 5, one number at a time'
            }
          ]
        })) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(1);
        
        let fullContent = '';
        for (const chunk of chunks) {
          if (chunk.message?.content) {
            fullContent += getTextFromContent(chunk.message.content);
          }
        }

        expect(fullContent).toContain('1');
        expect(fullContent).toContain('2');
        expect(fullContent).toContain('3');
        expect(fullContent).toContain('4');
        expect(fullContent).toContain('5');
      }, 30000);

      it('should stream with delta updates', async () => {
        const chunks: any[] = [];
        
        for await (const chunk of client.stream({
          messages: [
            {
              role: 'user',
              content: 'Write the word "streaming" letter by letter'
            }
          ]
        })) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(1);
        
        const firstChunk = chunks[0];
        expect(firstChunk).toBeDefined();
        expect(firstChunk.message).toBeDefined();
        
        const lastChunk = chunks[chunks.length - 1];
        // Usage might be in the last chunk or not provided during streaming
        if (lastChunk.usage) {
          expect(lastChunk.usage.totalTokens).toBeGreaterThan(0);
        }
      }, 30000);

      it('should handle streaming with system prompt', async () => {
        const clientWithSystem = new LLMClient({
          ...config,
          systemPrompt: 'You are a helpful assistant that responds concisely.'
        });

        const chunks: any[] = [];
        
        for await (const chunk of clientWithSystem.stream({
          messages: [
            {
              role: 'user',
              content: 'Say "Hello Stream" exactly'
            }
          ]
        })) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(0);
        
        let fullContent = '';
        for (const chunk of chunks) {
          if (chunk.message?.content) {
            fullContent += getTextFromContent(chunk.message.content);
          }
        }

        expect(fullContent.toLowerCase()).toContain('hello stream');
      }, 30000);

      it('should handle streaming errors gracefully', async () => {
        const invalidClient = new LLMClient({
          ...config,
          apiKey: 'invalid-api-key'
        });

        let errorCaught = false;
        
        try {
          for await (const chunk of invalidClient.stream({
            messages: [
              {
                role: 'user',
                content: 'Test message'
              }
            ]
          })) {
            console.log(chunk);
          }
        } catch (error) {
          errorCaught = true;
          expect(error).toBeDefined();
        }

        expect(errorCaught).toBe(true);
      }, 30000);
    });
  });
});
