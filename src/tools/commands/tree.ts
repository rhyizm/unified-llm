import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../../types/unified-api';

const treeHelper = async (directory: string, indent: string = '', excludeFolders: string[] = [], isLast: boolean = true): Promise<string> => {
  let result = '';
  const files = fs.readdirSync(directory).filter(file => !excludeFolders.includes(file));

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const isFileLast = index === files.length - 1;
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      result += `${indent}${isFileLast ? '└── ' : '├── '}${file}/\n`;
      const subtree = await treeHelper(filePath, `${indent}${isFileLast ? '    ' : '|   '}`, excludeFolders, isFileLast);
      result += subtree;
    } else {
      result += `${indent}${isFileLast ? '└── ' : '├── '}${file}\n`;
    }
  }

  if (isLast && indent === '') {
    result = result.trimEnd();
  }

  return result;
};

export const tree: Tool = {
  type: 'function',
  function: {
    name: 'tree',
    description: 'Display directory structure in tree format',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'The directory path to display (defaults to current directory)',
          default: '.'
        },
        excludeFolders: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of folder names to exclude',
          default: ['node_modules', '.git']
        }
      },
      required: []
    }
  },
  handler: async (args: Record<string, any>) => {
    const directory = args.directory || '.';
    const excludeFolders = args.excludeFolders || ['node_modules', '.git'];
    return await treeHelper(directory, '', excludeFolders, true);
  }
};
