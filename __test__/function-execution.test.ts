import { LLMClient } from '../src';
import type { Tool } from '../src/types/unified-api';
import tools from '../src/tools';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Function Execution Test', () => {
  it('should directly test function calling with Anthropic', async () => {
    
    // Create assistant with tools
    const claude = new LLMClient({
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-haiku-20240307',
      tools: tools as unknown as Tool[],
    });


    // Test direct chat call with tools
    const messages = [
      {
        id: 'test-1',
        role: 'user' as const,
        content: 'Please call the getAuthor function to find out who the author of this project is.',
        created_at: new Date(),
      }
    ];

    
    try {
      const response = await claude.chat({
        messages,
        model: 'claude-3-haiku-20240307',
      });


      expect(response.provider).toBe('anthropic');
      expect(response.message).toBeDefined();

      // Check if function was called or if response contains author info
      let functionCalled = false;
      let containsAuthorInfo = false;

      if (Array.isArray(response.message.content)) {
        functionCalled = response.message.content.some(item => 
          item.type === 'tool_use' && item.name === 'getAuthor'
        );
        containsAuthorInfo = response.message.content.some(item => 
          item.type === 'text' && item.text.toLowerCase().includes('rhyizm')
        );
      } else if (typeof response.message.content === 'string') {
        containsAuthorInfo = response.message.content.toLowerCase().includes('rhyizm');
      }


    } catch (error) {
      console.error('❌ Error during function calling test:', error);
      throw error;
    }

  }, 30000);

  it('should test tools functions directly', async () => {

    // Test all functions in the map
    for (const func of tools) {
      const funcName = func.function.name;

      
      try {
        if (funcName === 'getAuthor') {
          const result = await (func.handler as any)({});
          expect(result).toBe('The author of this project is rhyizm');
        }
      } catch (error) {
        console.error(`❌ Error testing ${funcName}:`, error);
      }
    }

  });
});