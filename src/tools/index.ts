// src/openai/tools/index.ts
import { cat } from './commands/cat';
import { tree } from './commands/tree';
import { callAnotherClient, setTools } from './callAnotherClient';
import { getAuthor } from './getAuthor';
import { getProjectInfo } from './getProjectInfo';
import { getCurrentTime } from './getCurrentTime';
import type { Tool } from '../types/unified-api';

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

export { callAnotherClient };

export default tools;
