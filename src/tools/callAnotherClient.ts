import { LLMClient } from '../llm-client';
import { UnifiedChatResponse, Tool } from '../types/unified-api';
import tools from '.';

export const callAnotherClient: Tool = {
  type: 'function',
  function: {
    name: 'callAnotherClient',
    description: 'Call another LLM client with specified ID and thread',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the LLM client to call'
        },
        threadId: {
          type: 'string',
          description: 'The thread ID for the conversation'
        }
      },
      required: ['id', 'threadId']
    }
  },
  handler: async (args: Record<string, any>): Promise<UnifiedChatResponse> => {
    const client = new LLMClient({
      id: args.id,
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      tools: tools,
    });

    const response = await client.chat({
      messages: [{
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: '' }],
        created_at: new Date()
      }],
      model: 'claude-3-haiku-20240307'
    });

    return response;
  }
};