import { OpenAIAgentProvider } from '../src/providers/openai/agent-provider';
import { Tool, UnifiedChatResponse } from '../src/types/unified-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Simple test tool
const getTime: Tool = {
  type: 'function',
  function: {
    name: 'getCurrentTime',
    description: 'Get the current time',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'Timezone (e.g., UTC, PST)',
        },
      },
    },
  },
  args: {
    timezone: 'UTC',
  },
  handler: async (args: Record<string, any>) => {
    const now = new Date();
    return `Current time in ${args.timezone}: ${now.toISOString()}`;
  },
};

describe('OpenAI Agent Provider Integration', () => {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // Skip tests if no API key is provided
  const testCondition = apiKey ? it : it.skip;

  testCondition('should handle basic chat requests', async () => {
    const provider = new OpenAIAgentProvider({
      apiKey: apiKey!,
      model: 'gpt-4o-mini',
    });

    const response = await provider.chat({
      messages: [
        {
          id: '1',
          role: 'system',
          content: 'You are a helpful assistant.',
          createdAt: new Date(),
        },
        {
          id: '2',
          role: 'user',
          content: 'Say hello and tell me what 2+2 equals.',
          createdAt: new Date(),
        },
      ],
    });

    expect(response.provider).toBe('openai');
    expect(response.text).toBeTruthy();
    expect(response.text.toLowerCase()).toMatch(/hello|hi|hey/);
    expect(response.text).toMatch(/4|four/);
  }, 30000);

  testCondition('should handle tool calls', async () => {
    const provider = new OpenAIAgentProvider({
      apiKey: apiKey!,
      model: 'gpt-4o-mini',
      tools: [getTime],
    });

    const response = await provider.chat({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What time is it? Use the getCurrentTime function.',
          createdAt: new Date(),
        },
      ],
    });

    expect(response.provider).toBe('openai');
    expect(response.text).toBeTruthy();
    // The response should mention time or timezone
    expect(response.text.toLowerCase()).toMatch(/time|utc|now/);
  }, 30000);

  testCondition('should handle streaming responses', async () => {
    const provider = new OpenAIAgentProvider({
      apiKey: apiKey!,
      model: 'gpt-4o-mini',
    });

    const stream = provider.stream({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Count from 1 to 3.',
          createdAt: new Date(),
        },
      ],
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.text);
    }

    const fullText = chunks.join('');
    expect(fullText).toBeTruthy();
    expect(fullText).toMatch(/1|one/i);
    expect(fullText).toMatch(/2|two/i);
    expect(fullText).toMatch(/3|three/i);
  }, 30000);

  testCondition('should include all content in message.content array', async () => {
    const provider = new OpenAIAgentProvider({
      apiKey: apiKey!,
      model: 'gpt-4o-mini',
      tools: [getTime],
    });

    const response = await provider.chat({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What time is it? Use the getCurrentTime function and then explain the result.',
          createdAt: new Date(),
        },
      ],
    });

    expect(response.provider).toBe('openai');
    expect(response.message.content).toBeInstanceOf(Array);
    expect(response.message.content.length).toBeGreaterThanOrEqual(1);
    
    // Check that content contains the response text
    const contents = response.message.content as any[];
    const hasContent = contents.some(c => c.text && c.text.length > 0);
    
    expect(hasContent).toBe(true);
    expect(response.text).toBeTruthy();
    
    // Should have at least one content item, possibly more if tools were used
    expect(contents.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  testCondition('should include all content in streaming message.content array', async () => {
    const provider = new OpenAIAgentProvider({
      apiKey: apiKey!,
      model: 'gpt-4o-mini',
      tools: [getTime],
    });

    const stream = provider.stream({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What time is it? Use the getCurrentTime function.',
          createdAt: new Date(),
        },
      ],
    });

    let finalResponse: UnifiedChatResponse | undefined;
    for await (const chunk of stream) {
      finalResponse = chunk;
    }

    expect(finalResponse).toBeDefined();
    expect(finalResponse!.message.content).toBeInstanceOf(Array);
    expect(finalResponse!.message.content.length).toBeGreaterThan(0);
    
    // The final response should contain all content including tool results
    const contents = finalResponse!.message.content as any[];
    expect(contents.length).toBeGreaterThan(0);
    expect(finalResponse!.text).toBeTruthy();
  }, 30000);

  testCondition('should handle error gracefully', async () => {
    const provider = new OpenAIAgentProvider({
      apiKey: 'invalid-key',
      model: 'gpt-4o-mini',
    });

    await expect(
      provider.chat({
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'Hello',
            createdAt: new Date(),
          },
        ],
      })
    ).rejects.toThrow();
  }, 30000);
});