// src/utils/tools/normalize-local-tools.ts
import type { OpenAiTool } from '../mcp/mcp-tool-catalog.js';
import type { LocalToolHandler } from './execute-tool-calls.js';

export type OpenAiToolInput = Omit<OpenAiTool, 'type'> & { type: OpenAiTool['type'] | string };

export type LocalToolHandlersInput =
  | Map<string, LocalToolHandler>
  | ReadonlyMap<string, LocalToolHandler>
  | Record<string, LocalToolHandler>
  | Map<string, unknown>
  | ReadonlyMap<string, unknown>
  | Record<string, unknown>;

export type LocalToolsInput = {
  tools: ReadonlyArray<OpenAiToolInput>;
  handlers: LocalToolHandlersInput;
};

export function normalizeLocalTools(
  input?: LocalToolsInput,
): { tools: OpenAiTool[]; handlers: Map<string, LocalToolHandler> } | undefined {
  if (!input) return undefined;

  const handlersEntries =
    input.handlers instanceof Map
      ? Array.from(input.handlers.entries())
      : Object.entries(input.handlers ?? {});

  const normalizedHandlers = new Map<string, LocalToolHandler>();
  for (const [name, handler] of handlersEntries) {
    if (typeof handler !== 'function') {
      throw new Error(`Local tool handler for "${name}" is not a function.`);
    }
    normalizedHandlers.set(name, handler as LocalToolHandler);
  }

  const normalizedTools = input.tools.map((tool) => {
    if (tool.type !== 'function') {
      throw new Error(
        `Unsupported local tool type: ${String(tool.type)} (only "function" is supported).`,
      );
    }
    return {
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
  });

  return { tools: normalizedTools, handlers: normalizedHandlers };
}
