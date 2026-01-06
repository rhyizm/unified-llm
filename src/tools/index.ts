// src/openai/tools/index.ts
import { cat } from './commands/cat.js';
import { tree } from './commands/tree.js';
import { callAnotherClient, setTools } from './callAnotherClient.js';
import { getAuthor } from './getAuthor.js';
import { getProjectInfo } from './getProjectInfo.js';
import { getCurrentTime } from './getCurrentTime.js';
import type { Tool } from '../types/unified-api.js';
import { defineTool } from '../types/unified-api.js';

export interface FunctionMap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (params: any) => Promise<any>;
}

export interface ArgumentMap {
  [functionName: string]: { [key: string]: string };
}

const tools = [cat, tree, callAnotherClient, getAuthor, getProjectInfo, getCurrentTime] as const;

// Inject tools into callAnotherClient to avoid circular dependency
setTools(tools as unknown as Tool[]);

export { callAnotherClient, defineTool };

export default tools;
