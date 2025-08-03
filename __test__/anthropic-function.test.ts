import { AnthropicProvider } from '../src/providers/anthropic';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import { ResponseFormat } from '../src/response-format';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Anthropic Tools Debug', () => {
  it('should debug if tools are being sent to Anthropic API', async () => {
    
    // Use the base Anthropic assistant directly
    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
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
      const response = await anthropic.chat({
        messages,
        model: 'claude-3-5-haiku-latest',
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

    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-2',
        role: 'user' as const,
        content: 'Where does the author live?',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await anthropic.chat({
        messages,
        model: 'claude-3-5-haiku-latest'
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

    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest',
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
      const response = await anthropic.chat({
        messages,
        model: 'claude-3-5-haiku-latest'
      });

      const contentString = JSON.stringify(response.message.content);

      expect(contentString).toContain('Osaka');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);

  it('should generate structured output with defined schema', async () => {
    
    // Define schema for product review
    const productReviewSchema = {
      type: 'object' as const,
      properties: {
        productName: { type: 'string' as const },
        rating: { type: 'number' as const },
        pros: {
          type: 'array' as const,
          items: { type: 'string' as const }
        },
        cons: {
          type: 'array' as const,
          items: { type: 'string' as const }
        },
        recommendation: { type: 'boolean' as const }
      },
      required: ['productName', 'rating', 'pros', 'cons', 'recommendation'],
      additionalProperties: false
    };

    const responseFormat = new ResponseFormat({
      name: 'product_review',
      description: 'Product review analysis',
      schema: productReviewSchema
    });

    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest'
    });

    const messages = [
      {
        id: 'test-4',
        role: 'user' as const,
        content: 'Generate a review for iPhone 15 Pro with a rating of 4.5 stars, mentioning great camera and battery life as pros, high price as con',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await anthropic.chat({
        messages,
        model: 'claude-3-5-haiku-latest',
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
        const textContent = content[0].text;
        
        // Try to extract JSON from the response (Anthropic may include explanatory text)
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedContent = JSON.parse(jsonMatch[0]);
        } else {
          parsedContent = JSON.parse(textContent);
        }
      }

      // Verify the response matches the schema
      expect(parsedContent).toHaveProperty('productName');
      expect(parsedContent).toHaveProperty('rating');
      expect(parsedContent).toHaveProperty('pros');
      expect(parsedContent).toHaveProperty('cons');
      expect(parsedContent).toHaveProperty('recommendation');
      
      expect(typeof parsedContent.productName).toBe('string');
      expect(typeof parsedContent.rating).toBe('number');
      expect(Array.isArray(parsedContent.pros)).toBe(true);
      expect(Array.isArray(parsedContent.cons)).toBe(true);
      expect(typeof parsedContent.recommendation).toBe('boolean');
      
      // Verify content includes expected information
      expect(parsedContent.productName.toLowerCase()).toContain('iphone');
      expect(parsedContent.rating).toBeCloseTo(4.5, 1);
      expect(parsedContent.pros.some((pro: string) => 
        pro.toLowerCase().includes('camera') || 
        pro.toLowerCase().includes('battery')
      )).toBe(true);
      expect(parsedContent.cons.some((con: string) => 
        con.toLowerCase().includes('price') || 
        con.toLowerCase().includes('expensive')
      )).toBe(true);

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);
});
