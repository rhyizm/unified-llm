import * as fs from 'fs';
import { Tool } from '../../types/unified-api';

export const cat: Tool = {
  type: 'function',
  function: {
    name: 'cat',
    description: 'Read and return the contents of a file',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The path to the file to read'
        }
      },
      required: ['filePath']
    }
  },
  handler: async (args: Record<string, any>) => {
    try {
      const fileContent = fs.readFileSync(args.filePath, 'utf-8');
      return fileContent;
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`);
    }
  }
};