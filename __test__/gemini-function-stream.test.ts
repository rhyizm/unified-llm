import { GeminiProvider } from '../src/providers/google';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Gemini Streaming Function Calls', () => {
  it('should handle streaming without function calls', async () => {
    
    const gemini = new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: 'gemini-2.5-flash',
      tools: [], // No tools provided
    });

    const messages = [
      {
        id: 'test-stream-1',
        role: 'user' as const,
        content: 'What is the capital of France?',
        createdAt: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      
      for await (const chunk of gemini.stream({ messages, model: 'gemini-2.5-flash' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }


      // Verify we received chunks and the response contains expected content
      expect(chunks.length).toBeGreaterThan(1);
      expect(fullContent.toLowerCase()).toContain('paris');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 100000);

  it('should handle streaming function calls with arguments', async () => {
    
    const gemini = new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: 'gemini-2.5-flash',
      tools: [getAuthor],
    });

    const messages = [
      {
        id: 'test-stream-2',
        role: 'user' as const,
        content: 'Who is the author of this project?',
        createdAt: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      let toolCalls: any[] = [];
      
      for await (const chunk of gemini.stream({ messages, model: 'gemini-2.5-flash' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'tool_use') {
          toolCalls.push(chunk.message.content[0]);
        }
      }


      // Verify the response contains the expected result
      expect(chunks.length).toBeGreaterThan(1);
      expect(fullContent).toContain('rhyizm');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 100000);

  it('should handle streaming function calls with default arguments', async () => {
    
    // Custom function with default arguments
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
        city: 'Tokyo' // Default value
      },
      handler: async (args: Record<string, any>) => {
        return `The author lives in ${args.city}`;
      }
    };

    const gemini = new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: 'gemini-2.5-flash',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-stream-3',
        role: 'user' as const,
        content: 'Call the getAuthorResidence function without providing any parameters to use the default city',
        createdAt: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      
      for await (const chunk of gemini.stream({ messages, model: 'gemini-2.5-flash' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      
      expect(chunks.length).toBeGreaterThan(1);
      expect(fullContent).toContain('Tokyo');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 100000);

  it('should handle streaming function calls with overridden arguments', async () => {
    
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
        city: 'Tokyo' // Default value
      },
      handler: async (args: Record<string, any>) => {
        return `The author lives in ${args.city}`;
      }
    };

    const gemini = new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: 'gemini-2.5-flash',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-stream-4',
        role: 'user' as const,
        content: 'Call getAuthorResidence with city "Osaka"',
        createdAt: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      
      for await (const chunk of gemini.stream({ messages, model: 'gemini-2.5-flash' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      
      expect(chunks.length).toBeGreaterThan(1);
      expect(fullContent).toContain('Osaka');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 100000);
});