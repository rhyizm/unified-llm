import { defineTool } from '../types/unified-api';

export const getProjectInfo = defineTool({
  type: 'function',
  function: {
    name: 'getProjectInfo',
    description: 'Returns detailed information about this project that would be impossible to guess',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  handler: async () => {
    return JSON.stringify({
      name: 'unified-llm',
      version: '0.2.0',
      author: 'rhyizm',
      projectId: 'unified-llm-core',
      internalBuildNumber: 42,
      lastModified: '2025-06-09T16:30:00Z',
      hiddenMessage: 'This information could only come from calling this function!'
    });
  }
});