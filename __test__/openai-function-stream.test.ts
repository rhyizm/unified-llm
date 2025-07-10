import { OpenAIProvider } from '../src/providers/openai';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('OpenAI Streaming with Tools Debug', () => {
  it('should handle streaming function calls with arguments', async () => {
    console.log('🔍 Testing streaming function calls...');
    
    // 既存テストと同じ関数を使用
    const openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4.1-mini',
      tools: [getAuthor],
    });

    const messages = [
      {
        id: 'test-stream-1',
        role: 'user' as const,
        content: 'Who is the author of this project?',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      for await (const chunk of openai.stream({ messages, model: 'gpt-4.1-mini' })) {
        chunks.push(chunk);
        console.log('📦 Chunk:', JSON.stringify(chunk, null, 2));
      }

      // Check if we received chunks
      expect(chunks.length).toBeGreaterThan(3);
      
      // Reconstruct the full response from chunks
      let fullContent = '';
      let toolCalls: any[] = [];
      
      for (const chunk of chunks) {
        if (chunk.message.content?.[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      console.log('📥 Full streamed response:', fullContent);

      // Verify the response contains the expected result
      expect(fullContent).toContain('rhyizm');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);

  it('should handle streaming function calls with default arguments', async () => {
    console.log('🔍 Testing streaming function calls with default args...');
    
    // 既存テストと同じ関数を使用（デフォルト引数をテスト）
    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name'
            }
          },
          required: []
        }
      },
      args: {
        city: 'Tokyo' // デフォルト値
      },
      handler: async (args: Record<string, any>) => {
        return `The author lives in ${args.city}`;
      }
    };

    const openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4.1-mini',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-stream-2',
        role: 'user' as const,
        content: 'Use the getAuthorResidence function to tell me where the author lives',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      for await (const chunk of openai.stream({ messages, model: 'gpt-4.1-mini' })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(3);

      // Reconstruct the full response
      let fullContent = '';
      for (const chunk of chunks) {
        if (chunk.message.content?.[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      expect(fullContent).toContain('Tokyo');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);

  it('should handle streaming function calls with overridden arguments', async () => {
    console.log('🔍 Testing streaming function calls with overridden args...');
    
    // 既存テストと同じ関数を使用（引数のオーバーライドをテスト）
    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name'
            }
          },
          required: []
        }
      },
      args: {
        city: 'Tokyo' // デフォルト値
      },
      handler: async (args: Record<string, any>) => {
        return `The author lives in ${args.city}`;
      }
    };

    const openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4.1-mini',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-stream-3',
        role: 'user' as const,
        content: 'Call getAuthorResidence with city "Osaka"',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      for await (const chunk of openai.stream({ messages, model: 'gpt-4.1-mini' })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(3);

      // Reconstruct the full response
      let fullContent = '';
      for (const chunk of chunks) {
        if (chunk.message.content?.[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      expect(fullContent).toContain('Osaka');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);
});
