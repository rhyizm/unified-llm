// src/utils/responses-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  accumulateUsage,
  calculateUsageCost,
  ModelPricingKey,
  UsageTotals,
} from "../../utils/token-utils";
import { Thread } from "../../thread";
import type { MCPServerConfig, Logger, OpenAIFunctionCallOutput } from "../../types";
import { createMcpTransport, sanitizeToolCallResult } from "../../utils/mcp-utils";
import { Clock, createDefaultClock } from "../../utils/timing";

export const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

function toModelSafeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}

/**
 * Runs an async task while measuring duration and logging success or failure.
 * Logs include duration_ms and, on failure, a normalized error object.
 */
async function logTimed<T>(
  logger: Logger,
  clock: Clock,
  event: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
  level: "debug" | "info" | "warn" = "info",
): Promise<T> {
  const start = clock.nowMs();
  try {
    const result = await fn();
    const end = clock.nowMs();
    const durationMs = Math.max(0, end - start);
    logger[level](event, {
      ...meta,
      ok: true,
      duration_ms: durationMs,
      ...(clock.nowEpochMs ? { timestamp_epoch_ms: clock.nowEpochMs() } : {}),
    });
    return result;
  } catch (err) {
    const end = clock.nowMs();
    const durationMs = Math.max(0, end - start);
    logger.error(event, {
      ...meta,
      ok: false,
      duration_ms: durationMs,
      error: toModelSafeError(err),
      ...(clock.nowEpochMs ? { timestamp_epoch_ms: clock.nowEpochMs() } : {}),
    });
    throw err;
  }
}

// ---------------------------------------------------------
// Responses API を叩くヘルパー
// ---------------------------------------------------------
async function callResponsesAPI(
  body: unknown,
  opts: {
    apiKey: string;
    onProgress?: (event: any) => void;
    signal?: AbortSignal;
  },
) {
  const { apiKey, onProgress, signal } = opts;
  if (onProgress) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(
        "callResponsesAPI streaming requires body to be a non-array object.",
      );
    }
  }

  const requestBody = onProgress
    ? { ...(body as Record<string, unknown>), stream: true }
    : body;

  const res = await fetch("https://api.openai.com/v1/responses", {
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

  if (!onProgress) {
    return res.json();
  }

  if (!res.body) {
    throw new Error("OpenAI Responses API error: missing response body.");
  }
  // fetch() のレスポンスボディ（ReadableStream）を、手動で読み取るための Reader を取得
  const reader = res.body.getReader();

  // バイト列(Uint8Array) → 文字列 へデコードするためのデコーダ
  // { stream: true } を使うことで、チャンク境界で文字が途中になっても崩れにくくなる
  const decoder = new TextDecoder();

  // SSE はネットワーク都合で「イベント途中まで」しか届かないことがあるため、
  // 受信した文字列をここに溜めて、イベント境界（空行）まで揃ったら切り出して処理する
  let buffer = "";

  // OpenAI の SSE ストリーム上で "response.completed" を受け取ったら、ここに最終 response を保持する
  let completedResponse: any | null = null;

  // onProgress は呼び出し側で好きに実装できるが、
  // ここで例外が起きてもストリーム処理全体が止まらないように握りつぶす
  const emitProgress = (event: any) => {
    try {
      onProgress(event);
    } catch {
      // ignore progress sink errors
    }
  };

  // SSE の 1イベントは「空行」で区切られる（\n\n または \r\n\r\n）
  // buffer の中から「最初のイベント境界」の位置を探す
  const findBoundaryIndex = (value: string): number => {
    const lfIndex = value.indexOf("\n\n");       // LF 区切り
    const crlfIndex = value.indexOf("\r\n\r\n"); // CRLF 区切り
    if (lfIndex === -1) return crlfIndex;
    if (crlfIndex === -1) return lfIndex;
    return Math.min(lfIndex, crlfIndex);
  };

  try {
    // ストリームが終わるまで読み続ける
    while (true) {
      // ReadableStream から次のチャンクを読む（任意サイズ・任意タイミングで届く）
      const { value, done } = await reader.read();
      if (done) break;

      // 受信したバイト列を文字列にデコードして buffer に追記
      buffer += decoder.decode(value, { stream: true });

      // buffer 内に SSE のイベント境界（空行）がある限り、イベント単位に切り出して処理する
      let boundaryIndex = findBoundaryIndex(buffer);
      while (boundaryIndex !== -1) {
        // 境界が \r\n\r\n なら 4文字、\n\n なら 2文字ぶん進めて buffer を消費する
        const boundaryLength = buffer.startsWith("\r\n\r\n", boundaryIndex)
          ? 4
          : 2;

        // 1イベントぶんの生テキスト（SSE の 1メッセージ）
        const rawEvent = buffer.slice(0, boundaryIndex);

        // 処理済みイベント + 区切り（空行）を buffer から取り除く
        buffer = buffer.slice(boundaryIndex + boundaryLength);

        // 次のイベント境界を探す（1チャンクに複数イベントが含まれることがある）
        boundaryIndex = findBoundaryIndex(buffer);

        // 空イベント（空行だけ等）は無視
        if (!rawEvent.trim()) {
          continue;
        }

        // SSE は "data:" 行が複数行になる場合がある。
        // ここでは "data:" 行だけを抜き出して、"data:" プレフィックスを剥がして連結する
        const dataLines = rawEvent
          .split(/\r\n|\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s?/, ""));

        // 連結した data を JSON 文字列として扱う（OpenAI のイベントは JSON）
        const data = dataLines.join("\n").trim();

        // 空、または SSE の終端シグナル "[DONE]" は無視
        if (!data || data === "[DONE]") {
          continue;
        }

        // JSON として解釈できない data は捨てて次へ（堅牢性優先）
        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        // 呼び出し元へイベントを通知（UI更新やログ等）
        emitProgress(event);

        // "response.completed" が来たら、この呼び出しの最終 response が確定
        if (event?.type === "response.completed") {
          completedResponse = event.response ?? null;
          break;
        }

        // ストリームが "incomplete" で終わった場合は例外扱いにする
        if (event?.type === "response.incomplete") {
          const reason = event?.response?.incomplete_details?.reason;
          throw new Error(
            `OpenAI Responses API incomplete: ${reason ?? "unknown reason"}`,
          );
        }

        // failed / error は即例外扱いにする（上位でログ・復旧等）
        if (event?.type === "response.failed" || event?.type === "error") {
          throw new Error(
            `OpenAI Responses API error event: ${JSON.stringify(event)}`,
          );
        }
      }

      // completed を受け取ったら outer ループも抜ける（これ以上読む必要がない）
      if (completedResponse) {
        break;
      }
    }
  } finally {
    // 途中で break / throw した場合でも Reader をキャンセルして確実にリソース解放する
    await reader.cancel().catch(() => {});
  }

  if (!completedResponse) {
    throw new Error("OpenAI Responses API error: response.completed not received.");
  }

  return completedResponse;
}

// ---------------------------------------------------------
// Responses API の出力から最終テキストを取り出すヘルパー
// ---------------------------------------------------------
function getOutputText(response: any): string {
  // SDK ラッパが output_text を付けてくれているケース
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  // 生 output から message -> content -> output_text を順序通りに連結する
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
// JSONパースヘルパー
// ---------------------------------------------------------
function safeJsonParse<T = unknown>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type OpenAiTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: unknown;
};

type OpenAIFunctionCall = {
  type: "function_call";
  name: string;
  arguments?: string | Record<string, unknown>;
  call_id?: string;
  id?: string;
};

type LocalToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * MCP クライアントを接続し、Responses API向けの tools 定義を組み立てる。
 * @returns mcpClients: 接続済みのMCPクライアント配列。
 * @returns openAiTools: LLMに渡すfunctionツール定義。
 *   MCPのツール一覧はSDK独自の形式のため、そのままResponses APIに渡すとtoolとして解釈されず、
 *   tool_choiceでの呼び出しができない（結果としてツール実行が発生しない）。
 */
async function setupMcpClientsAndTools(options: {
  mcpServers: MCPServerConfig[];
}): Promise<{
  mcpClients: Client[];
  openAiTools: OpenAiTool[];
  toolNameToClient: Map<string, Client>;
}> {
  const { mcpServers } = options;
  const mcpClients: Client[] = [];
  const openAiTools: OpenAiTool[] = [];
  const toolNameToClient = new Map<string, Client>();

  try {
    for (const server of mcpServers) {
      const transport = createMcpTransport(server);

      const mcpClient = new Client(
        { name: "local-mcp-responses-client", version: "1.0.0" },
        { capabilities: {} },
      );

      await mcpClient.connect(transport, {});
      mcpClients.push(mcpClient);

      const toolsList = await mcpClient.listTools();

      const allowedTools = toolsList.tools.filter((tool) =>
        server.allowedTools?.includes(tool.name) ?? true
      );

      for (const tool of allowedTools) {
        if (toolNameToClient.has(tool.name)) {
          throw new Error(
            `Tool name collision across MCP servers: ${tool.name}`,
          );
        }
        toolNameToClient.set(tool.name, mcpClient);
        openAiTools.push({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        });
      }
    }
  } catch (error) {
    await Promise.allSettled(
      mcpClients.map(async (client) => {
        try {
          if (typeof client.close === "function") {
            await client.close();
          }
        } catch {
          // ignore
        }
      }),
    );
    throw error;
  }

  return { mcpClients, openAiTools, toolNameToClient };
}

/**
 * Responses API の output から function_call を抽出する。
 * 呼び出しがなければログを出して空配列を返す。
 *
 * @param response - Responses API のレスポンス
 * @returns function_call の配列
 */
function getFunctionCallsFromResponse(response: any): OpenAIFunctionCall[] {
  const output = Array.isArray(response?.output) ? response.output : [];
  const functionCalls = output.filter(
    (item: any) => item?.type === "function_call",
  );

  return functionCalls;
}

/**
 * Responses API の function_call を実行し、tool output 配列を作成する。
 * ローカルツールが一致すればそれを優先し、なければ MCP ツールを呼び出す。
 * 返却値は Responses API に渡す `function_call_output` 形式。
 *
 * @param functionCalls - モデルが要求した function_call の配列
 * @param toolNameToClient - MCP ツール名とクライアントの対応表
 * @param localToolHandlers - ローカルツール名とハンドラの対応表
 * @returns tool output の配列
 */
async function callFunctionTools(
  functionCalls: OpenAIFunctionCall[],
  toolNameToClient: Map<string, Client>,
  localToolHandlers?: Map<string, LocalToolHandler>,
  options?: { logger?: Logger; clock?: Clock },
): Promise<OpenAIFunctionCallOutput[]> {
  const logger = options?.logger ?? NOOP_LOGGER;
  const clock = options?.clock ?? createDefaultClock();

  const outputTasks: Promise<OpenAIFunctionCallOutput>[] = functionCalls.map(
    async (fc): Promise<OpenAIFunctionCallOutput> => {
    if (!fc.call_id) {
      throw new Error(`Missing call_id for function call: ${fc.name}`);
    }

    try {
      const args =
        typeof fc.arguments === "string"
          ? safeJsonParse<Record<string, unknown>>(fc.arguments, {})
          : fc.arguments ?? {};
  
      const localHandler = localToolHandlers?.get(fc.name);
      if (localHandler) {
        logger.info("tool.call.request", {
          tool: fc.name,
          call_id: fc.call_id,
          kind: "local",
          args: JSON.stringify(args),
        });
        const result = await logTimed(
          logger,
          clock,
          "tool.call.completed",
          {
            tool: fc.name,
            call_id: fc.call_id,
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
          tool: fc.name,
          call_id: fc.call_id,
          kind: "local",
          result: outputText,
        });
        return {
          type: "function_call_output",
          call_id: fc.call_id,
          output: outputText,
        };
      }
  
      const mcpClient = toolNameToClient.get(fc.name);
      if (!mcpClient) {
        throw new Error(`No MCP client registered for tool: ${fc.name}`);
      }
  
      logger.info("tool.call.request", {
        tool: fc.name,
        call_id: fc.call_id,
        kind: "mcp",
        args: JSON.stringify(args),
      });
      const result = await logTimed(
        logger,
        clock,
        "tool.call.completed",
        {
          tool: fc.name,
          call_id: fc.call_id,
          kind: "mcp",
          args_keys_count: Object.keys(args).length,
        },
        async () => mcpClient.callTool({ name: fc.name, arguments: args }),
        "info",
      );
  
      const { sanitizedResult } = sanitizeToolCallResult(result);
      logger.info("tool.call.result", {
        tool: fc.name,
        call_id: fc.call_id,
        kind: "mcp",
        result: JSON.stringify(sanitizedResult),
      });
  
      return {
        call_id: fc.call_id,
        type: "function_call_output",
        output: JSON.stringify(sanitizedResult),
      }; 
    } catch (err) {
      logger.error("tool.call.failed", {
        tool: fc.name,
        call_id: fc.call_id,
        error: toModelSafeError(err),
      });

      return {
        type: "function_call_output",
        call_id: fc.call_id,
        output: JSON.stringify({ ok: false, error: toModelSafeError(err) }),
      };
    }
    },
  );

  return Promise.all(outputTasks);
}

type StructuredOutput = {
  format: {
    type: "json_schema";
    name: string;
    schema: unknown;
    strict?: boolean;
  };
};

type TruncationOption = string;
type TemperatureOption = number;

/**
 * Responses API の tool calling loop を実行する。
 * MCP ツール/ローカルツールの呼び出しを処理し、
 * `previous_response_id` で連続呼び出しを継続する。
 * ループ回数は環境変数 `RESPONSES_MAX_LOOPS` で指定し、未設定時は 10 回。
 *
 * @param options - 入力、ツール定義、使用量の集計先、Structured Output 等の設定
 * @returns Responses API の最終レスポンス
 */
async function runToolCallingLoop(options: {
  baseInput: any[];
  openAiTools: OpenAiTool[];
  toolNameToClient: Map<string, Client>;
  localToolHandlers?: Map<string, LocalToolHandler>;
  usageTotals: UsageTotals;
  model: ModelPricingKey;
  apiKey: string;
  thread?: Thread;
  structuredOutput?: StructuredOutput;
  temperature?: TemperatureOption;
  truncation?: TruncationOption;
  onProgress?: (event: any) => void;
  signal?: AbortSignal;
  logger: Logger;
  clock: Clock;
}): Promise<any> {
  const {
    baseInput,
    openAiTools,
    toolNameToClient,
    localToolHandlers,
    usageTotals,
    model,
    apiKey,
    thread,
    structuredOutput,
    temperature,
    truncation,
    onProgress,
    signal,
    logger,
    clock,
  } = options;
  const maxLoops = Number(process.env.RESPONSES_MAX_LOOPS) || 10;

  const buildRequestBody = (
    input: any[],
    previousResponseId?: string,
  ) => ({
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
        { apiKey, onProgress, signal },
      ),
    "info",
  );

  logger.debug("responses.api.result", {
    responseJson: JSON.stringify(response, null, 2),
  });

  accumulateUsage(usageTotals, response?.usage);

  thread?.updatePreviousResponseId(response?.id);
  if (thread && Array.isArray(response?.output)) {
    thread.appendToHistory(response.output);
  }

  let lastResponse: any = response;

  for (let loop = 0; loop < maxLoops; loop++) {
    const functionCalls = getFunctionCallsFromResponse(response);

    if (functionCalls.length === 0) {
      break;
    }


    const functionOutputs = await callFunctionTools(
      functionCalls,
      toolNameToClient,
      localToolHandlers,
      { logger, clock },
    );
    thread?.appendToHistory(functionOutputs);


    response = await logTimed(
      logger,
      clock,
      "llm.step.completed",
      {
        model,
        previous_response_id: response.id,
      },
      async () =>
        callResponsesAPI(
          buildRequestBody(functionOutputs, response.id),
          { apiKey, onProgress, signal },
        ),
      "info",
    );

    logger.debug("responses.api.result", {
      responseJson: JSON.stringify(response, null, 2),
    });

    accumulateUsage(usageTotals, response?.usage);

    thread?.updatePreviousResponseId(response?.id);
    if (thread && Array.isArray(response?.output)) {
      thread.appendToHistory(response.output);
    }

    lastResponse = response;
  }

  return lastResponse;
}

/**
 * Responses API を用いて、MCP ツールとローカルツールの呼び出しを含む
 * 反復処理（tool calling loop）を実行する。
 * `previous_response_id` を使って会話履歴を連結し、最終出力を取得する。
 * ループ回数は環境変数 `RESPONSES_MAX_LOOPS` で指定し、未設定時は 10 回。
 *
 * @param options - モデル設定、入力、MCP/ローカルツール、Structured Output 等の実行オプション
 * @returns Responses API の最終レスポンス
 */
export async function callResponsesApiAgent(options: {
  mcpServers: MCPServerConfig[];
  model: ModelPricingKey;
  apiKey?: string;
  baseInput: any[];
  thread?: Thread;
  structuredOutput?: StructuredOutput;
  localTools?: {
    tools: OpenAiTool[];
    handlers: Map<string, LocalToolHandler>;
  };
  config?: {
    temperature?: number;
    truncation?: TruncationOption;
  };
  onProgress?: (event: any) => void;
  signal?: AbortSignal;
  logger?: Logger;
  clock?: Clock;
}): Promise<{
  result: unknown;
  usageTotals: UsageTotals;
  estimatedCostJpy: number;
}> {
  const {
    mcpServers,
    model,
    apiKey,
    baseInput,
    thread,
    structuredOutput,
    config,
    localTools,
    onProgress,
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

  // --------------------------------------------------
  // 1. MCP クライアントの準備（Streamable HTTP 接続）
  // --------------------------------------------------
  let mcpClients: Client[] = [];
  let openAiTools: OpenAiTool[] = [];
  let toolNameToClient = new Map<string, Client>();

  // ---------------------------------------------------------
  // 2. Responses API へのループ呼び出し（previous_response_id 使用）
  // ---------------------------------------------------------
  const usageTotals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
  };

  let lastResponse: any;

  try {
    ({ mcpClients, openAiTools, toolNameToClient } =
      await setupMcpClientsAndTools({
        mcpServers,
      }));
    if (localTools) {
      const seenLocalToolNames = new Set<string>();
      for (const tool of localTools.tools) {
        if (toolNameToClient.has(tool.name)) {
          throw new Error(
            `Tool name collision between MCP and local tools: ${tool.name}`,
          );
        }
        if (seenLocalToolNames.has(tool.name)) {
          throw new Error(`Duplicate local tool name: ${tool.name}`);
        }
        if (!localTools.handlers.has(tool.name)) {
          throw new Error(`Missing local tool handler: ${tool.name}`);
        }
        seenLocalToolNames.add(tool.name);
      }
      openAiTools.push(...localTools.tools);
    }

    lastResponse = await runToolCallingLoop({
      baseInput,
      openAiTools,
      toolNameToClient,
      localToolHandlers: localTools?.handlers,
      usageTotals,
      model,
      apiKey: resolvedApiKey,
      thread,
      structuredOutput,
      truncation,
      temperature,
      onProgress,
      signal,
      logger,
      clock,
    });

    if (!lastResponse) {
      throw new Error("No response from OpenAI Responses API.");
    }

    // ---------------------------------------------------------
    // 3. 最終的な JSON を取得して表示
    // ---------------------------------------------------------
    const outputText = getOutputText(lastResponse);
    logger.info("responses.output_text", { outputText });

    const result = structuredOutput ? JSON.parse(outputText) : outputText;

    const estimatedCostJpy = calculateUsageCost(usageTotals, model, {
      currencyMultiplier: 160,
    });

    return { result, usageTotals, estimatedCostJpy };
  } finally {
    await Promise.allSettled(
      mcpClients.map(async (client) => {
        try {
          if (typeof client.close === "function") {
            await client.close();
          }
        } catch {
          // ignore
        }
      }),
    );
  }
}
