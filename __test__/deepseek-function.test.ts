import { DeepSeekProvider } from '../src/providers/deepseek';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('DeepSeek Tools Debug', () => {
  it('should debug if tools are being sent to DeepSeek API', async () => {
    console.log('🔍 Debugging DeepSeek tool sending...');
    
    // Use the base DeepSeek assistant directly
    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat',
      tools: [getAuthor],
    });

    const messages = [
      {
        id: 'test-1',
        role: 'user' as const,
        content: 'Who is the author of this project?',
        created_at: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat'
      });

      const contentString = JSON.stringify(response.message.content);

      console.log('📥 Response with default args:');
      console.log(JSON.stringify(contentString, null, 2));

      expect(contentString).toContain('rhyizm');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }

  }, 30000);

  it('should use default args when not provided', async () => {
    console.log('🔍 Testing default args...');
    
    // カスタム関数：デフォルト引数付き
    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: {},
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

    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-2',
        role: 'user' as const,
        content: 'Where does the author live?',
        created_at: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat'
      });

      const contentString = JSON.stringify(response.message.content);

      console.log('📥 Response with default args:');
      console.log(JSON.stringify(contentString, null, 2));

      expect(JSON.stringify(contentString)).toContain('Tokyo');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);

  it('should override default args when provided', async () => {
    console.log('🔍 Testing args override...');
    
    // 同じ関数でデフォルト引数を上書き
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

    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-3',
        role: 'user' as const,
        content: 'Call getAuthorResidence with city "Osaka"',
        created_at: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat'
      });

      const contentString = JSON.stringify(response.message.content);

      console.log('📥 Response with default args:');
      console.log(JSON.stringify(contentString, null, 2));

      expect(contentString).toContain('Osaka');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);
});