import { LLMClient } from '../llm-client.js';
import { defineTool }  from '../types/unified-api.js';
import type { Tool }  from '../types/unified-api.js';

// Tools will be injected at runtime to avoid circular dependency
let injectedTools: Tool[] | undefined;

export function setTools(tools: Tool[]) {
  injectedTools = tools;
}

export const callAnotherClient = defineTool({
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
  handler: async (args: { id: string; threadId: string }) => {
    const client = new LLMClient({
      id: args.id,
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      tools: injectedTools
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
});