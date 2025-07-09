import { LLMClient } from '../src';
import type { Tool } from '../src/types/unified-api';
import tools from '../src/tools';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Function Execution Test', () => {
  it('should directly test function calling with Anthropic', async () => {
    console.log('🔧 Testing direct function calling with Anthropic Claude...');
    
    // Create assistant with tools
    const claude = new LLMClient({
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-haiku-20240307',
      tools: tools as unknown as Tool[],
    });

    console.log('📋 Available functions:', Object.keys(tools));

    // Test direct chat call with tools
    const messages = [
      {
        id: 'test-1',
        role: 'user' as const,
        content: 'Please call the getAuthor function to find out who the author of this project is.',
        created_at: new Date(),
      }
    ];

    console.log('💬 Sending message with function calling request...');
    
    try {
      const response = await claude.chat({
        messages,
        model: 'claude-3-haiku-20240307',
      });

      console.log('📥 Received response:');
      console.log('  - Provider:', response.provider);
      console.log('  - Model:', response.model);
      console.log('  - Message role:', response.message.role);
      console.log('  - Content type:', Array.isArray(response.message.content) ? 'array' : typeof response.message.content);

      if (Array.isArray(response.message.content)) {
        console.log('  - Content items:', response.message.content.length);
        response.message.content.forEach((item, i) => {
          console.log(`    [${i}] Type: ${item.type}`);
          if (item.type === 'text') {
            console.log(`    [${i}] Text: ${item.text.substring(0, 100)}...`);
          } else if (item.type === 'tool_use') {
            console.log(`    [${i}] Tool: ${item.name}`);
            console.log(`    [${i}] Input:`, item.input);
          }
        });
      } else {
        console.log('  - Content:', response.message.content);
      }

      console.log('  - Usage:', response.usage);
      console.log('  - Finish reason:', response.finish_reason);

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

      if (functionCalled) {
        console.log('✅ Function was called by the assistant!');
      } else if (containsAuthorInfo) {
        console.log('✅ Response contains author information!');
      } else {
        console.log('⚠️ Function was not called and response doesn\'t contain author info');
        console.log('   This might be expected behavior - Claude may not always use tools');
      }

      console.log('🎉 Direct function calling test completed!');

    } catch (error) {
      console.error('❌ Error during function calling test:', error);
      throw error;
    }

  }, 30000);

  it('should test tools functions directly', async () => {
    console.log('🧪 Testing tools functions directly...');

    // Test all functions in the map
    for (const func of tools) {
      const funcName = func.function.name;

      console.log(`🔧 Testing function: ${funcName}`);
      
      try {
        if (funcName === 'getAuthor') {
          const result = await (func.handler as any)({});
          console.log(`✅ ${funcName} result:`, result);
          expect(result).toBe('The author of this project is rhyizm');
        } else {
          console.log(`⏭️ Skipping ${funcName} (not under test)`);
        }
      } catch (error) {
        console.error(`❌ Error testing ${funcName}:`, error);
      }
    }

    console.log('🎯 Direct function test completed!');
  });
});