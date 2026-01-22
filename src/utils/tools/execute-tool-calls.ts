// src/utils/tools/execute-tool-calls.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Logger } from "../../types/index.js";
import { sanitizeToolCallResult } from "../mcp-utils.js";
import { logTimed, toModelSafeError } from "../logging.js";
import { Clock, createDefaultClock } from "../timing.js";

export const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

function safeJsonParse<T = unknown>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * プロバイダー間で共通に扱える tool call の中立形
 */
export type NormalizedToolCall = {
  name: string;
  callId: string;
  arguments?: string | Record<string, unknown>;
};

/**
 * tool result の中立形（実行エンジンの返り値）
 */
export type NormalizedToolResult = {
  name: string;
  callId: string;
  output: string;
};

export type LocalToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type ExecuteToolCallsOptions = {
  logger?: Logger;
  clock?: Clock;
};

/**
 * tool call を実行して結果を文字列として返す（プロバイダー非依存）。
 *
 * - localToolHandlers が該当すれば優先
 * - それ以外は MCP に委譲
 * - 例外は握りつぶして `{ ok:false, error }` を output に詰める（LLMループを止めない）
 * - sanitizeToolCallResult を適用して安全化
 */
export async function executeToolCalls(
  toolCalls: NormalizedToolCall[],
  toolNameToClient: Map<string, Client>,
  localToolHandlers?: Map<string, LocalToolHandler>,
  options?: ExecuteToolCallsOptions,
): Promise<NormalizedToolResult[]> {
  const logger = options?.logger ?? NOOP_LOGGER;
  const clock = options?.clock ?? createDefaultClock();

  const tasks = toolCalls.map(async (call): Promise<NormalizedToolResult> => {
    if (!call.callId) {
      throw new Error(`Missing callId for tool call: ${call.name}`);
    }

    const args =
      typeof call.arguments === "string"
        ? safeJsonParse<Record<string, unknown>>(call.arguments, {})
        : call.arguments ?? {};

    try {
      const localHandler = localToolHandlers?.get(call.name);
      if (localHandler) {
        logger.info("tool.call.request", {
          tool: call.name,
          call_id: call.callId,
          kind: "local",
          args: JSON.stringify(args),
        });

        const result = await logTimed(
          logger,
          clock,
          "tool.call.completed",
          {
            tool: call.name,
            call_id: call.callId,
            kind: "local",
            args_keys_count: Object.keys(args).length,
          },
          async () => localHandler(args),
          "info",
        );

        const outputText =
          typeof result === "string"
            ? result
            : JSON.stringify(result ?? { ok: true });

        logger.info("tool.call.result", {
          tool: call.name,
          call_id: call.callId,
          kind: "local",
          result: outputText,
        });

        return { name: call.name, callId: call.callId, output: outputText };
      }

      const mcpClient = toolNameToClient.get(call.name);
      if (!mcpClient) {
        throw new Error(`No MCP client registered for tool: ${call.name}`);
      }

      logger.info("tool.call.request", {
        tool: call.name,
        call_id: call.callId,
        kind: "mcp",
        args: JSON.stringify(args),
      });

      const result = await logTimed(
        logger,
        clock,
        "tool.call.completed",
        {
          tool: call.name,
          call_id: call.callId,
          kind: "mcp",
          args_keys_count: Object.keys(args).length,
        },
        async () => mcpClient.callTool({ name: call.name, arguments: args }),
        "info",
      );

      const { sanitizedResult } = sanitizeToolCallResult(result);

      logger.info("tool.call.result", {
        tool: call.name,
        call_id: call.callId,
        kind: "mcp",
        result: JSON.stringify(sanitizedResult),
      });

      return {
        name: call.name,
        callId: call.callId,
        output: JSON.stringify(sanitizedResult),
      };
    } catch (err) {
      logger.error("tool.call.failed", {
        tool: call.name,
        call_id: call.callId,
        error: toModelSafeError(err),
      });

      return {
        name: call.name,
        callId: call.callId,
        output: JSON.stringify({ ok: false, error: toModelSafeError(err) }),
      };
    }
  });

  return Promise.all(tasks);
}
