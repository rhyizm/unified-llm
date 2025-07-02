import { Tool } from '../types/unified-api';

export const getCurrentTime: Tool = {
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
};