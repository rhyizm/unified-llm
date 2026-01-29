// src/providers/openai/responses-api-client.ts
import {
  accumulateUsage,
} from "../../utils/token-utils.js";
import { Thread } from "../../thread.js";
import type { AgentCallOptions, Logger, StructuredOutput } from "../../types/index.js";
import type { Usage } from "../../types/usage.js";
import { logTimed, NOOP_LOGGER } from "../../utils/logging.js";
import { Clock, createDefaultClock } from "../../utils/timing.js";

import { setupMcpClientsAndTools } from "../../utils/mcp/setup-mcp-tools.js";
import {
  McpToolCatalog,
  type OpenAiTool,
} from "../../utils/mcp/mcp-tool-catalog.js";

import {
  executeToolCalls,
  type LocalToolHandler,
  type NormalizedToolCall,
} from "../../utils/tools/execute-tool-calls.js";
import {
  normalizeLocalTools,
} from "../../utils/tools/normalize-local-tools.js";

// ---------------------------------------------------------
// Responses API を叩くヘルパー（OpenAI固有）
// ---------------------------------------------------------
async function callResponsesAPI(
  body: unknown,
  opts: {
    apiKey: string;
    endpoint?: string;
    isStream?: boolean;
    sseCallback?: (event: any) => void;
    signal?: AbortSignal;
  },
) {
  const DEFAULT_RESPONSES_API_ENDPOINT = "https://api.openai.com/v1/responses";

  const { apiKey, isStream, sseCallback, signal } = opts;

  const endpoint =
    typeof opts.endpoint === "string" && opts.endpoint.trim().length > 0
      ? opts.endpoint.trim()
      : DEFAULT_RESPONSES_API_ENDPOINT;

  if (isStream) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(
        "callResponsesAPI streaming requires body to be a non-array object.",
      );
    }
  }

  const requestBody = isStream === true
    ? { ...(body as Record<string, unknown>), stream: true }
    : body;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAI Responses API error: ${res.status} ${res.statusText}\n${text}`,
    );
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const isEventStream = contentType.includes("text/event-stream");
  const shouldStream = isStream === true || isEventStream;
  const canProgress = shouldStream && typeof sseCallback === "function";

  if (!shouldStream) {
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error("OpenAI Responses API error: empty JSON response body.");
    }
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      const maxPreview = 2000;
      const preview =
        rawText.length > maxPreview
          ? `${rawText.slice(0, maxPreview)}... (truncated, ${rawText.length} chars)`
          : rawText;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `OpenAI Responses API error: failed to parse JSON response: ${message}\n${preview}`,
      );
    }
  }

  if (!res.body) {
    throw new Error("OpenAI Responses API error: missing response body.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let completedResponse: any | null = null;

  const emitProgress = (event: any) => {
    if (!canProgress) return;
    try {
      sseCallback(event);
    } catch {
      // ignore progress sink errors
    }
  };

  const findBoundaryIndex = (value: string): number => {
    const lfIndex = value.indexOf("\n\n");
    const crlfIndex = value.indexOf("\r\n\r\n");
    if (lfIndex === -1) return crlfIndex;
    if (crlfIndex === -1) return lfIndex;
    return Math.min(lfIndex, crlfIndex);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundaryIndex = findBoundaryIndex(buffer);
      while (boundaryIndex !== -1) {
        const boundaryLength = buffer.startsWith("\r\n\r\n", boundaryIndex)
          ? 4
          : 2;

        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + boundaryLength);

        boundaryIndex = findBoundaryIndex(buffer);

        if (!rawEvent.trim()) continue;

        const dataLines = rawEvent
          .split(/\r\n|\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s?/, ""));

        const data = dataLines.join("\n").trim();

        if (!data || data === "[DONE]") continue;

        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        emitProgress(event);

        if (event?.type === "response.completed") {
          completedResponse = event.response ?? null;
          break;
        }

        if (event?.type === "response.incomplete") {
          const reason = event?.response?.incomplete_details?.reason;
          throw new Error(
            `OpenAI Responses API incomplete: ${reason ?? "unknown reason"}`,
          );
        }

        if (event?.type === "response.failed" || event?.type === "error") {
          throw new Error(
            `OpenAI Responses API error event: ${JSON.stringify(event)}`,
          );
        }
      }

      if (completedResponse) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!completedResponse) {
    throw new Error(
      "OpenAI Responses API error: response.completed not received.",
    );
  }

  return completedResponse;
}

// ---------------------------------------------------------
// Responses API の出力から最終テキストを取り出すヘルパー（OpenAI固有）
// ---------------------------------------------------------
function getOutputText(response: any): string {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  if (Array.isArray(response?.output)) {
    const messageTexts: string[] = [];
    for (const item of response.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        const parts = item.content
          .filter(
            (c: any) => c?.type === "output_text" && typeof c.text === "string",
          )
          .map((c: any) => c.text);
        if (parts.length > 0) {
          messageTexts.push(parts.join(""));
        }
      }
    }
    if (messageTexts.length > 0) {
      return messageTexts.join("\n");
    }
  }

  throw new Error("No text output found in Responses API result.");
}

// ---------------------------------------------------------
// OpenAI tool schema（Responses API向け）
// ---------------------------------------------------------
type OpenAIFunctionCall = {
  type: "function_call";
  name: string;
  arguments?: string | Record<string, unknown>;
  call_id?: string;
  id?: string;
};

type OpenAIFunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

/**
 * OpenAI Responses API の output から function_call を抽出する。
 */
function getFunctionCallsFromResponse(response: any): OpenAIFunctionCall[] {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output.filter((item: any) => item?.type === "function_call");
}

/**
 * OpenAIの function_call を中立形（NormalizedToolCall）へ変換する。
 */
function toNormalizedToolCalls(
  functionCalls: OpenAIFunctionCall[],
): NormalizedToolCall[] {
  return functionCalls.map((fc) => {
    const callId = fc.call_id ?? fc.id;
    if (!callId) {
      throw new Error(`Missing call_id for function call: ${fc.name}`);
    }
    return {
      name: fc.name,
      callId,
      arguments: fc.arguments,
    };
  });
}

type TruncationOption = string;
type TemperatureOption = number;

/**
 * OpenAI Responses API の tool calling loop を実行する。
 */
async function runToolCallingLoop(options: {
  baseInput: any[];
  openAiTools: OpenAiTool[];
  toolNameToClient: Map<string, any>;
  localToolHandlers?: Map<string, LocalToolHandler>;
  usage: Usage;
  model: string;
  apiKey: string;
  endpoint?: string;
  isStream?: boolean;
  thread?: Thread;
  structuredOutput?: StructuredOutput;
  temperature?: TemperatureOption;
  truncation?: TruncationOption;
  sseCallback?: (event: any) => void;
  signal?: AbortSignal;
  logger: Logger;
  clock: Clock;
}): Promise<any> {
  const {
    baseInput,
    openAiTools,
    toolNameToClient,
    localToolHandlers,
    usage,
    model,
    apiKey,
    endpoint,
    isStream,
    thread,
    structuredOutput,
    temperature,
    truncation,
    sseCallback,
    signal,
    logger,
    clock,
  } = options;

  const maxLoops = Number(process.env.RESPONSES_MAX_LOOPS) || 10;

  const buildRequestBody = (input: any[], previousResponseId?: string) => ({
    model,
    input,
    previous_response_id: previousResponseId,
    tools: openAiTools,
    tool_choice: "auto",
    parallel_tool_calls: true,
    ...(structuredOutput ? { text: structuredOutput } : {}),
    ...(truncation ? { truncation } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  });

  const requestContext = thread
    ? thread.buildRequestContextForResponsesAPI(baseInput)
    : { input: baseInput };

  let response: any = await logTimed(
    logger,
    clock,
    "llm.step.completed",
    {
      model,
      previous_response_id: requestContext.previous_response_id,
    },
    async () =>
      callResponsesAPI(
        buildRequestBody(
          requestContext.input,
          requestContext.previous_response_id,
        ),
        {
          apiKey,
          endpoint: endpoint,
          isStream,
          sseCallback,
          signal,
        },
      ),
    "info",
  );

  logger.debug("responses.api.result", {
    responseJson: JSON.stringify(response, null, 2),
  });

  accumulateUsage(usage, response?.usage);

  thread?.updatePreviousResponseId(response?.id);

  let lastResponse: any = response;

  for (let loop = 0; loop < maxLoops; loop++) {
    const functionCalls = getFunctionCallsFromResponse(response);

    if (functionCalls.length === 0) {
      break;
    }

    // OpenAI固有の function_call → 中立形
    const normalizedCalls = toNormalizedToolCalls(functionCalls);

    // ツール実行は中立化した共通エンジンで（local優先→MCP）
    const normalizedResults = await executeToolCalls(
      normalizedCalls,
      toolNameToClient,
      localToolHandlers,
      { logger, clock },
    );

    // 中立形の結果 → OpenAIの function_call_output 形式
    const apiFunctionOutputs: OpenAIFunctionCallOutputItem[] =
      normalizedResults.map((r) => ({
        type: "function_call_output",
        call_id: r.callId,
        output: r.output,
      }));

    response = await logTimed(
      logger,
      clock,
      "llm.step.completed",
      {
        model,
        previous_response_id: response.id,
      },
      async () =>
        callResponsesAPI(buildRequestBody(apiFunctionOutputs, response.id), {
          apiKey,
          endpoint: endpoint,
          isStream,
          sseCallback,
          signal,
        }),
      "info",
    );

    logger.debug("responses.api.result", {
      responseJson: JSON.stringify(response, null, 2),
    });

    accumulateUsage(usage, response?.usage);

    thread?.updatePreviousResponseId(response?.id);

    lastResponse = response;
  }

  return lastResponse;
}

/**
 * OpenAI Responses API を用いた Agent 実行（MCP/ローカルツール対応）
 */
export async function callResponsesApiAgent(options: AgentCallOptions): Promise<{
  output: string | unknown;
  usage: Usage;
  rawResponse: unknown;
}> {
  const {
    mcpServers,
    model,
    apiKey,
    endpoint,
    isStream,
    baseInput,
    thread,
    structuredOutput,
    config,
    localTools,
    sseCallback,
    signal,
    logger: loggerOption,
    clock: clockOption,
  } = options;

  const logger = loggerOption ?? NOOP_LOGGER;
  const clock = clockOption ?? createDefaultClock();

  const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY;
  if (!resolvedApiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const temperature = config?.temperature ?? undefined;
  const truncation = config?.truncation ?? undefined;

  const normalizedLocalTools = normalizeLocalTools(localTools);

  let mcpClients: any[] = [];
  let toolNameToClient = new Map<string, any>();
  let openAiTools: OpenAiTool[] = [];

  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
  };

  let lastResponse: any;

  try {
    // ---------------------------------------------------------
    // 1) MCP 接続＆ツール収集
    // ---------------------------------------------------------
    const setup = await setupMcpClientsAndTools({
      mcpServers,
      clientName: "local-mcp-responses-client",
      clientVersion: "1.0.0",
    });

    mcpClients = setup.mcpClients;
    toolNameToClient = setup.toolNameToClient;

    openAiTools = new McpToolCatalog(setup.mcpTools).toOpenAiTools();

    if (normalizedLocalTools) {
      const seenLocalToolNames = new Set<string>();

      for (const tool of normalizedLocalTools.tools) {
        if (toolNameToClient.has(tool.name)) {
          throw new Error(
            `Tool name collision between MCP and local tools: ${tool.name}`,
          );
        }
        if (seenLocalToolNames.has(tool.name)) {
          throw new Error(`Duplicate local tool name: ${tool.name}`);
        }
        if (!normalizedLocalTools.handlers.has(tool.name)) {
          throw new Error(`Missing local tool handler: ${tool.name}`);
        }
        seenLocalToolNames.add(tool.name);
      }

      openAiTools.push(...normalizedLocalTools.tools);
    }

    // ---------------------------------------------------------
    // 2) LLM with Tool Call ループ呼び出し
    // ---------------------------------------------------------
    lastResponse = await runToolCallingLoop({
      baseInput,
      openAiTools,
      toolNameToClient,
      localToolHandlers: normalizedLocalTools?.handlers,
      usage,
      model,
      apiKey: resolvedApiKey,
      endpoint,
      isStream,
      thread,
      structuredOutput,
      truncation,
      temperature,
      sseCallback,
      signal,
      logger,
      clock,
    });

    if (!lastResponse) {
      throw new Error("No response from OpenAI Responses API.");
    }

    // ---------------------------------------------------------
    // 3) 最終出力
    // ---------------------------------------------------------
    const outputText = getOutputText(lastResponse);
    logger.info("responses.output_text", { outputText });

    if (thread) {
      thread.appendToHistory([
        {
          role: "assistant",
          content: outputText,
        },
      ]);
    }

    return { output: outputText, usage, rawResponse: lastResponse };
  } finally {
    await Promise.allSettled(
      mcpClients.map(async (client) => {
        try {
          if (typeof client?.close === "function") {
            await client.close();
          }
        } catch {
          // ignore
        }
      }),
    );
  }
}
