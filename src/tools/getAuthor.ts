import { Tool } from '../types/unified-api';

/**
 * Returns information about the project author
*/
export const getAuthor: Tool = {
  type: 'function',
  function: {
    name: 'getAuthor',
    description: 'Returns the author of this project',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  args: {},
  handler: async () => {
    return 'The author of this project is rhyizm';
  }
};