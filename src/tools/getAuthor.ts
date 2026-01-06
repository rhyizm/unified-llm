import { defineTool } from '../types/unified-api.js';

/**
 * Returns information about the project author
*/
export const getAuthor = defineTool({
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
  handler: async () => {
    return 'The author of this project is rhyizm';
  }
});