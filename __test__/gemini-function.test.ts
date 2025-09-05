import { GeminiProvider } from '../src/providers/google';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import { ResponseFormat } from '../src/response-format';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Gemini Tools Debug', () => {
  it('should debug if tools are being sent to Gemini API', async () => {
    
    // Use the base Gemini assistant directly
    const gemini = new GeminiProvider({
      apiKey: process.env.GOOGLE_API_KEY!,
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
      const response = await gemini.chat({
        messages,
        model: 'gemini-2.5-flash',
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

    const gemini = new GeminiProvider({
      apiKey: process.env.GOOGLE_API_KEY!,
      model: 'gemini-2.5-flash',
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
      const response = await gemini.chat({
        messages,
        model: 'gemini-2.5-flash',
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

    const gemini = new GeminiProvider({
      apiKey: process.env.GOOGLE_API_KEY!,
      model: 'gemini-2.5-flash',
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
      const response = await gemini.chat({
        messages,
        model: 'gemini-2.5-flash',
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
    
    // Define schema for sentiment analysis
    const sentimentAnalysisSchema = {
      type: 'object' as const,
      properties: {
        text: { type: 'string' as const },
        sentiment: { 
          type: 'string' as const,
          enum: ['positive', 'negative', 'neutral']
        },
        confidence: { type: 'number' as const },
        keywords: {
          type: 'array' as const,
          items: { type: 'string' as const }
        },
        summary: { type: 'string' as const }
      },
      required: ['text', 'sentiment', 'confidence', 'keywords', 'summary'],
      additionalProperties: false
    };

    const responseFormat = new ResponseFormat({
      name: 'sentiment_analysis',
      description: 'Sentiment analysis result',
      schema: sentimentAnalysisSchema
    });

    const gemini = new GeminiProvider({
      apiKey: process.env.GOOGLE_API_KEY!,
      model: 'gemini-2.5-flash'
    });

    const messages = [
      {
        id: 'test-4',
        role: 'user' as const,
        content: 'Analyze the sentiment of: "I absolutely love this new smartphone! The camera quality is amazing and the battery lasts all day."',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await gemini.chat({
        messages,
        model: 'gemini-2.5-flash',
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
      expect(parsedContent).toHaveProperty('text');
      expect(parsedContent).toHaveProperty('sentiment');
      expect(parsedContent).toHaveProperty('confidence');
      expect(parsedContent).toHaveProperty('keywords');
      expect(parsedContent).toHaveProperty('summary');
      
      expect(typeof parsedContent.text).toBe('string');
      expect(['positive', 'negative', 'neutral']).toContain(parsedContent.sentiment);
      expect(typeof parsedContent.confidence).toBe('number');
      expect(Array.isArray(parsedContent.keywords)).toBe(true);
      expect(typeof parsedContent.summary).toBe('string');
      
      // Verify content includes expected information
      expect(parsedContent.sentiment).toBe('positive');
      expect(parsedContent.confidence).toBeGreaterThan(0.7);
      expect(parsedContent.keywords.some((keyword: string) => 
        keyword.toLowerCase().includes('smartphone') || 
        keyword.toLowerCase().includes('camera') ||
        keyword.toLowerCase().includes('battery')
      )).toBe(true);

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);
});
