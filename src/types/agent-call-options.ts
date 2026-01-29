import type { Thread } from '../thread.js';
import type { Clock } from '../utils/timing.js';
import type { LocalToolsInput } from '../utils/tools/normalize-local-tools.js';
import type { Logger } from './logger.js';
import type { MCPServerConfig } from './mcp.js';

export type StructuredOutput = {
  format: {
    type: 'json_schema';
    name: string;
    schema: unknown;
    strict?: boolean;
  };
};

export type AgentCallOptions = {
  model: string;
  apiKey?: string;
  endpoint?: string;
  isStream?: boolean;
  baseInput: any[];
  thread?: Thread;
  structuredOutput?: StructuredOutput;
  mcpServers?: MCPServerConfig[];
  localTools?: LocalToolsInput;
  config?: {
    temperature?: number;
    truncation?: string;
  };
  sseCallback?: (event: any) => void;
  signal?: AbortSignal;
  logger?: Logger;
  clock?: Clock;
};
