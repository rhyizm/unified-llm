import { defineTool } from '../types/unified-api.js';

export const getCurrentTime = defineTool({
  type: 'function',
  function: {
    name: 'getCurrentTime',
    description: 'Returns the current date and time in ISO format',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  handler: async () => {
    return new Date().toISOString();
  }
});