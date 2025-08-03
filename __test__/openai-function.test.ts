import { OpenAIProvider } from '../src/providers/openai';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import { ResponseFormat } from '../src/response-format';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('OpenAI Tools Debug', () => {
  it('should debug if tools are being sent to OpenAI API', async () => {
    
    // Use the base OpenAI assistant directly
    const openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4.1-mini',
      tools: [getAuthor],
    });

    const messages = [
      {
        id: 'test-1',
        role: 'user' as const,
        content: 'Who is the author of this project?',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await openai.chat({
        messages,
        model: 'gpt-4.1-mini',
        generationConfig: {
          temperature: 0.7
        }
      });

      const contentString = JSON.stringify(response.message.content);

      expect(contentString).toContain('rhyizm');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }

  }, 30000);

  it('should use default args when not provided', async () => {
    
    // カスタム関数：デフォルト引数付き
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
        id: 'test-2',
        role: 'user' as const,
        content: 'Use the getAuthorResidence function to tell me where the author lives',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await openai.chat({
        messages,
        model: 'gpt-4.1-mini',
        generationConfig: {
          temperature: 0.7
        }
      });

      const contentString = JSON.stringify(response.message.content);

      expect(JSON.stringify(contentString)).toContain('Tokyo');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);

  it('should override default args when provided', async () => {
    
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

    const openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4.1-mini',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-3',
        role: 'user' as const,
        content: 'Call getAuthorResidence with city "Osaka"',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await openai.chat({
        messages,
        model: 'gpt-4.1-mini',
        generationConfig: {
          temperature: 0.7
        }
      });

      const contentString = JSON.stringify(response.message.content);

      expect(contentString).toContain('Osaka');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);

  it('should generate structured output with defined schema', async () => {
    
    // Define schema for user profile
    const userProfileSchema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        age: { type: 'number' as const },
        email: { type: 'string' as const },
        interests: {
          type: 'array' as const,
          items: { type: 'string' as const }
        }
      },
      required: ['name', 'age', 'email', 'interests'],
      additionalProperties: false
    };

    const responseFormat = new ResponseFormat({
      name: 'user_profile',
      description: 'User profile information',
      schema: userProfileSchema
    });

    const openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4.1-mini'
    });

    const messages = [
      {
        id: 'test-4',
        role: 'user' as const,
        content: 'Generate a user profile for a 25-year-old software developer named Alice who likes coding and reading',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await openai.chat({
        messages,
        model: 'gpt-4.1-mini',
        generationConfig: {
          temperature: 0.7,
          responseFormat: responseFormat
        }
      });

      // Parse the response content
      const content = response.message.content;
      let parsedContent: any;
      
      if (typeof content === 'string') {
        parsedContent = JSON.parse(content);
      } else if (Array.isArray(content) && content[0]?.type === 'text') {
        parsedContent = JSON.parse(content[0].text);
      }

      // Verify the response matches the schema
      expect(parsedContent).toHaveProperty('name');
      expect(parsedContent).toHaveProperty('age');
      expect(parsedContent).toHaveProperty('email');
      expect(parsedContent).toHaveProperty('interests');
      
      expect(typeof parsedContent.name).toBe('string');
      expect(typeof parsedContent.age).toBe('number');
      expect(typeof parsedContent.email).toBe('string');
      expect(Array.isArray(parsedContent.interests)).toBe(true);
      
      // Verify content includes expected information
      expect(parsedContent.name.toLowerCase()).toContain('alice');
      expect(parsedContent.age).toBe(25);
      expect(parsedContent.interests.some((interest: string) => 
        interest.toLowerCase().includes('coding') || 
        interest.toLowerCase().includes('programming') ||
        interest.toLowerCase().includes('software')
      )).toBe(true);

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);
});
