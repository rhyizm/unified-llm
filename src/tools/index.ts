// src/openai/tools/index.ts
import { cat, tree } from './commands';
import { callAnotherClient } from './callAnotherClient';
import { getAuthor } from './getAuthor';
import { getProjectInfo } from './getProjectInfo';
import { getCurrentTime } from './getCurrentTime';
import { Tool } from '../types/unified-api';

export interface FunctionMap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (params: any) => Promise<any>;
}

export interface ArgumentMap {
  [functionName: string]: { [key: string]: string };
}

const tools: Tool[] = [cat, tree, callAnotherClient, getAuthor, getProjectInfo, getCurrentTime];

export { callAnotherClient };

export default tools;
