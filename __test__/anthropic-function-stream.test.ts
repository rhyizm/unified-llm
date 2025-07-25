import { AnthropicProvider } from '../src/providers/anthropic';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Anthropic Streaming Function Calls', () => {
  it('should handle streaming without function calls', async () => {
    
    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest',
      tools: [], // No tools provided
    });

    const messages = [
      {
        id: 'test-stream-1',
        role: 'user' as const,
        content: 'What is the capital of France?',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      
      for await (const chunk of anthropic.stream({ messages, model: 'claude-3-5-haiku-latest' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(fullContent.toLowerCase()).toContain('paris');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);

  it('should handle streaming function calls with arguments', async () => {
    
    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest',
      tools: [getAuthor],
    });

    const messages = [
      {
        id: 'test-stream-2',
        role: 'user' as const,
        content: 'Who is the author of this project?',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      let toolCalls: any[] = [];
      
      for await (const chunk of anthropic.stream({ messages, model: 'claude-3-5-haiku-latest' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'tool_use') {
          toolCalls.push(chunk.message.content[0]);
        }
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(fullContent).toContain('rhyizm');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);

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

    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-stream-3',
        role: 'user' as const,
        content: 'Call the getAuthorResidence function without providing any parameters to use the default city',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      
      for await (const chunk of anthropic.stream({ messages, model: 'claude-3-5-haiku-latest' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }

      expect(chunks.length).toBeGreaterThan(3);
      expect(fullContent).toContain('Tokyo');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);

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

    const anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-haiku-latest',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-stream-4',
        role: 'user' as const,
        content: 'Call getAuthorResidence with city "Osaka"',
        created_at: new Date(),
      }
    ];

    try {
      const chunks: any[] = [];
      let fullContent = '';
      
      for await (const chunk of anthropic.stream({ messages, model: 'claude-3-5-haiku-latest' })) {
        chunks.push(chunk);
        if (Array.isArray(chunk.message.content) && chunk.message.content[0]?.type === 'text') {
          fullContent += chunk.message.content[0].text;
        }
      }
      
      expect(chunks.length).toBeGreaterThan(3);
      expect(fullContent).toContain('Osaka');

    } catch (error) {
      console.error('❌ Streaming error:', error);
      throw error;
    }
  }, 30000);
});