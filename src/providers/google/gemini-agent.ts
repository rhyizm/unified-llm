// src/providers/google/gemini-agent.ts
import { accumulateUsage } from "../../utils/token-utils.js";
import { Thread } from "../../thread.js";
import type { MCPServerConfig, Logger } from "../../types/index.js";
import type { Usage } from "../../types/usage.js";
import { logTimed, NOOP_LOGGER } from "../../utils/logging.js";
import { Clock, createDefaultClock } from "../../utils/timing.js";

import { setupMcpClientsAndTools } from "../../utils/mcp/setup-mcp-tools.js";
import {
  McpToolCatalog,
  type OpenAiTool,
  type GeminiTool,
} from "../../utils/mcp/mcp-tool-catalog.js";

import {
  executeToolCalls,
  type LocalToolHandler,
  type NormalizedToolCall,
} from "../../utils/tools/execute-tool-calls.js";

import { sanitizeJsonSchema } from "./sanitizeJsonSchema.js";

/**
 * Gemini API (Generative Language API) 向けの agent 実装。
 *
 * 目的:
 * - OpenAI Responses API 互換の呼び出しスタイル（baseInput / tools / tool loop）を維持しつつ、
 *   Gemini の tool calling と streaming (SSE) を正しく扱う。
 * - SSE 時の落とし穴（最後のイベントが完成レスポンスでない、途中で functionCall が出る等）を吸収し、
 *   tool call を取りこぼさない。
 *
 * 重要な設計制約:
 * - Gemini 3 系は tool calling に thoughtSignature 等の内部情報が絡む場合があり、
 *   content.parts をクライアント側で merge/再構築すると tool calling が崩れる可能性がある。
 *   → したがって content.parts は “API が返した raw のまま” 会話履歴へ積み、改変しない。
 * - streaming 時の “最終テキスト” は parts に詰め直さず __accumulatedText に保持する。
 */

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------

type GeminiContentRole = "user" | "model";
type GeminiContent = { role?: GeminiContentRole; parts: GeminiPart[] };

type GeminiFunctionCall = {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
};

type GeminiFunctionResponse = {
  id?: string;
  name: string;
  response: Record<string, unknown>;
};

type GeminiPart = {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;

  // thoughtSignature 等、Gemini が返す追加フィールドを破壊しないため any で保持できるようにする
  [k: string]: any;
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: string;
    [k: string]: any;
  }>;
  usageMetadata?: GeminiUsageMetadata;
  [k: string]: any;
};

/**
 * ローカルな一意 ID を生成する（Gemini 側が tool call id を返さない場合の補助）。
 */
function createLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Gemini API のエンドポイント URL を組み立てる。
 *
 * 注意:
 * - この実装は「model 文字列に :generateContent / :streamGenerateContent 等を含める」設計を前提とする。
 * - endpoint は `https://generativelanguage.googleapis.com/v1beta/models/` のようなベースを想定。
 */
function resolveGeminiEndpoint(args: { model: string; endpoint?: string }): string {
  const { model, endpoint } = args;

  const defaultBase = "https://generativelanguage.googleapis.com/v1beta/models";
  const base =
    typeof endpoint === "string" && endpoint.trim().length > 0
      ? endpoint.trim()
      : defaultBase;

  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const url = new URL(`${baseWithSlash}${model}`);
  return url.toString();
}

/**
 * OpenAI 互換の tool 定義（function）を Gemini の tool 形式へ変換する。
 *
 * - parameters は Gemini 側で受理される JSON Schema サブセットへ sanitize する。
 * - tool 名衝突等は呼び出し側（callGeminiAgent）で検査している前提。
 */
function openAiToolsToGeminiTools(openAiTools: OpenAiTool[]): GeminiTool[] {
  if (openAiTools.length === 0) return [];

  return [
    {
      functionDeclarations: openAiTools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: sanitizeJsonSchema(t.parameters),
      })),
    },
  ];
}

/**
 * candidates[0].content.parts を安全に取得するユーティリティ。
 * - Gemini のレスポンスは候補が無い/parts が無いケースがあるため防御的に扱う。
 */
function getCandidate0Parts(resp: GeminiGenerateContentResponse): GeminiPart[] {
  const parts = resp?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? (parts as GeminiPart[]) : [];
}

/**
 * Gemini レスポンスから text を抽出する（candidates[0].content.parts[].text を連結）。
 *
 * 目的:
 * - tool loop とは独立に「人間に返す文字列」を復元する。
 * 注意:
 * - streaming (SSE) 時は最後のイベントに text が無い場合があるため、
 *   本ファイルでは __accumulatedText も併用する（getOutputText 参照）。
 */
function extractGeminiText(resp: GeminiGenerateContentResponse): string {
  const parts = getCandidate0Parts(resp);
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter((t) => t.length > 0)
    .join("");
}

/**
 * Gemini レスポンスから functionCall を抽出する。
 *
 * 目的:
 * - tool calling ループ（runToolCallingLoop）で「次に実行すべき tool call」を判定する。
 *
 * 注意:
 * - Gemini の streaming では functionCall が “途中イベント” に出て、最後イベントが空のことがある。
 *   → SSE 解析側で functionCall を見つけたイベントを返す仕掛けが必要（readGeminiSseResponse 参照）。
 */
function extractGeminiFunctionCalls(resp: GeminiGenerateContentResponse): GeminiFunctionCall[] {
  const parts = getCandidate0Parts(resp);
  const calls: GeminiFunctionCall[] = [];

  for (const p of parts) {
    const fc = p?.functionCall;
    if (fc && typeof fc.name === "string") {
      calls.push({
        id: typeof fc.id === "string" ? fc.id : undefined,
        name: fc.name,
        args:
          fc.args && typeof fc.args === "object" && !Array.isArray(fc.args)
            ? (fc.args as Record<string, unknown>)
            : undefined,
      });
    }
  }

  return calls;
}

/**
 * レスポンスが functionCall を含むかを判定する。
 * - SSE 側の「途中イベント検出」で使用。
 */
function responseHasFunctionCall(resp: GeminiGenerateContentResponse): boolean {
  const parts = getCandidate0Parts(resp);
  return parts.some(
    (p) => p?.functionCall && typeof p.functionCall?.name === "string",
  );
}

/**
 * レスポンスが content.parts を含むかを判定する。
 * - SSE 側で「parts を含む最後のイベント」を保持するために使用。
 */
function responseHasAnyParts(resp: GeminiGenerateContentResponse): boolean {
  const parts = getCandidate0Parts(resp);
  return Array.isArray(parts) && parts.length > 0;
}

/**
 * Gemini の usageMetadata を OpenAI 互換っぽい usage 形へ変換する。
 *
 * 目的:
 * - 既存の token-utils.accumulateUsage が OpenAI 形を想定しているため、変換して渡す。
 */
function toOpenAiLikeUsageFromGemini(meta: GeminiUsageMetadata | undefined) {
  const prompt = Number(meta?.promptTokenCount ?? 0);
  const cand = Number(meta?.candidatesTokenCount ?? 0);
  const total = Number(meta?.totalTokenCount ?? (prompt + cand));
  const cached = Number(meta?.cachedContentTokenCount ?? 0);

  return {
    input_tokens: prompt,
    output_tokens: cand,
    total_tokens: total,
    input_tokens_details: {
      cached_tokens: cached,
    },
  };
}

/**
 * tool 実行結果（string）を JSON object として解釈できるか試す。
 *
 * 目的:
 * - Gemini の functionResponse は object を期待するため、
 *   tool の output が JSON なら parse して渡す（非 JSON は {result: "..."} に wrap）。
 */
function tryParseJsonObject(input: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(input);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    return { result: v as any };
  } catch {
    return null;
  }
}

/**
 * OpenAI 風の baseInput（role/content）を Gemini の systemInstruction と contents に変換する。
 *
 * 目的:
 * - 呼び出し側の互換性（developer/system/user/assistant）を維持しつつ Gemini API 形式へマッピングする。
 *
 * ポリシー:
 * - developer/system は systemInstruction に集約
 * - user/assistant は contents に積む（assistant は role:"model"）
 */
function toGeminiSystemAndContentsFromBaseInput(baseInput: any[]): {
  systemInstruction?: GeminiContent;
  contents: GeminiContent[];
} {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];

  const pushTextContent = (role: GeminiContentRole, text: string) => {
    const trimmed = text ?? "";
    if (trimmed.length === 0) return;
    contents.push({
      role,
      parts: [{ text: trimmed }],
    });
  };

  const coerceTextFromOpenAiContent = (content: any): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const texts = content
        .map((c) => {
          if (!c || typeof c !== "object") return "";
          if (typeof (c as any).text === "string") return (c as any).text;
          return "";
        })
        .filter((t) => t.length > 0);
      return texts.join("");
    }
    return "";
  };

  for (const item of baseInput) {
    // 文字列は user として扱う
    if (typeof item === "string") {
      pushTextContent("user", item);
      continue;
    }
    if (!item || typeof item !== "object") continue;

    const roleRaw = (item as any).role;
    const typeRaw = (item as any).type;

    // developer/system は systemInstruction 側へ集約
    if (roleRaw === "system" || roleRaw === "developer") {
      const text = coerceTextFromOpenAiContent((item as any).content);
      if (text) systemTexts.push(text);
      continue;
    }

    // thread/history 由来の message 形式（OpenAI 互換）を吸収
    if (typeRaw === "message") {
      const role =
        (item as any).role === "assistant"
          ? "model"
          : (item as any).role === "user"
            ? "user"
            : undefined;

      const contentArr = Array.isArray((item as any).content) ? (item as any).content : [];
      const text = contentArr
        .filter((c: any) => c?.type === "output_text" && typeof c.text === "string")
        .map((c: any) => c.text)
        .join("");

      if (role && text) pushTextContent(role, text);
      continue;
    }

    // role:user/assistant の通常形
    if (roleRaw === "user" || roleRaw === "assistant") {
      const role: GeminiContentRole = roleRaw === "assistant" ? "model" : "user";
      const text = coerceTextFromOpenAiContent((item as any).content);
      if (text) pushTextContent(role, text);
      continue;
    }

    // function_call_output 等は tool loop 側で Gemini 形式に積むのでここでは無視
  }

  const systemInstruction =
    systemTexts.length > 0
      ? {
          parts: [{ text: systemTexts.join("\n") }],
        }
      : undefined;

  return { systemInstruction, contents };
}

// ---------------------------------------------------------
// SSE helpers (可読性重視)
// ---------------------------------------------------------

/**
 * Content-Type が SSE (text/event-stream) かどうかを判定する。
 *
 * 目的:
 * - 「sseCallback の有無」ではなく「レスポンスが SSE のときのみ」ストリーム処理を行う要件を満たす。
 */
function isTextEventStream(contentType: string): boolean {
  return contentType.toLowerCase().includes("text/event-stream");
}

/**
 * SSE の「イベント境界（空行）」単位で raw event を切り出すデコーダ。
 *
 * 入力:
 * - fetch の ReadableStream から得た文字列チャンク
 *
 * 出力:
 * - raw SSE event（複数行のテキスト）。各 event 内には data: 行が含まれる可能性がある。
 *
 * 対応:
 * - LF / CRLF 両対応
 */
class SseEventDecoder {
  private buffer = "";

  /**
   * チャンクを追加し、確定した SSE event を返す。
   */
  push(textChunk: string): string[] {
    this.buffer += textChunk;
    return this.drain(false);
  }

  /**
   * ストリーム終端処理。
   * - decoder の flush テキストを与え、残りバッファも含めて event を吐き出す。
   */
  flush(tailText = ""): string[] {
    this.buffer += tailText;
    return this.drain(true);
  }

  /**
   * buffer 内から「空行区切り」を探し、event を取り出す。
   *
   * flush=false の場合:
   * - 区切りが無い末尾は次チャンクに持ち越す。
   *
   * flush=true の場合:
   * - 残りが空でなければ最後の event として返す。
   */
  private drain(flush: boolean): string[] {
    const events: string[] = [];

    const findDelimiter = (s: string): { idx: number; len: number } | null => {
      const lf = s.indexOf("\n\n");
      const crlf = s.indexOf("\r\n\r\n");
      if (lf === -1 && crlf === -1) return null;
      if (lf === -1) return { idx: crlf, len: 4 };
      if (crlf === -1) return { idx: lf, len: 2 };
      return lf < crlf ? { idx: lf, len: 2 } : { idx: crlf, len: 4 };
    };

    while (true) {
      const delim = findDelimiter(this.buffer);
      if (!delim) break;

      const raw = this.buffer.slice(0, delim.idx);
      this.buffer = this.buffer.slice(delim.idx + delim.len);
      events.push(raw);
    }

    if (flush) {
      const remaining = this.buffer;
      this.buffer = "";
      if (remaining.trim().length > 0) events.push(remaining);
    }

    return events;
  }
}

/**
 * raw SSE event から data: 行を連結して JSON として parse する。
 *
 * Gemini streaming (alt=sse) の event は通常 `data: { ...json... }` を含む。
 * - ただし keep-alive 的な空 event や [DONE] が混ざる場合があるため除外する。
 *
 * 戻り値:
 * - parsed: JSON parse できた GeminiGenerateContentResponse（できなければ null）
 * - sample: デバッグ用に event の先頭を切り出したもの
 */
function parseGeminiSseEvent(rawEvent: string): {
  parsed: GeminiGenerateContentResponse | null;
  sample: string;
} {
  const trimmed = rawEvent.trim();
  const sample = trimmed.slice(0, 2000);

  if (!trimmed) return { parsed: null, sample };

  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, ""));

  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return { parsed: null, sample };

  try {
    return { parsed: JSON.parse(data) as GeminiGenerateContentResponse, sample };
  } catch {
    return { parsed: null, sample };
  }
}

/**
 * Gemini の streaming テキストを assemble する accumulator。
 *
 * 背景:
 * - Gemini の SSE は「差分」か「累積」かが実装差/モデル差で揺れることがある。
 * - 本 accumulator は以下のヒューリスティックで両方を吸収する:
 *   1) chunk が累積なら accumulated を置き換え、delta は差分部分
 *   2) chunk が短くなった場合（再送/順序ズレ）は無視
 *   3) それ以外は差分として末尾に append
 *
 * 注意:
 * - これは “表示用テキスト” の復元であり、tool calling の判定は parts.functionCall を優先する。
 */
class GeminiTextAccumulator {
  private text = "";

  /**
   * chunkText を取り込み、delta と full を返す。
   */
  ingest(chunkText: string): { delta: string; full: string } {
    if (!chunkText) return { delta: "", full: this.text };

    if (chunkText.startsWith(this.text)) {
      const delta = chunkText.slice(this.text.length);
      this.text = chunkText;
      return { delta, full: this.text };
    }

    if (this.text.startsWith(chunkText)) {
      return { delta: "", full: this.text };
    }

    this.text += chunkText;
    return { delta: chunkText, full: this.text };
  }

  /**
   * 現在の全文を返す。
   */
  get(): string {
    return this.text;
  }
}

type GeminiStreamDecoratedResponse = GeminiGenerateContentResponse & {
  /**
   * streaming 中に assemble した全文。
   * - parts を改変せず “表示用” として保持する。
   */
  __accumulatedText?: string;

  /**
   * ストリームの最後に parse できたイベント（デバッグ用途）。
   */
  __streamLast?: GeminiGenerateContentResponse | null;

  /**
   * ストリーム中に functionCall を観測したか（デバッグ/検証用途）。
   */
  __streamHadFunctionCall?: boolean;
};

type ReadGeminiSseOptions = {
  /**
   * SSE の delta を流すための progress callback。
   * - 要件により “SSE のときのみ” 呼ばれる。
   */
  sseCallback?: (event: any) => void;

  /**
   * 任意の logger（現状は最小限の利用）。
   */
  logger?: Logger;

  /**
   * tool calling を取りこぼさないために、functionCall を見つけたらそのイベントを返す。
   *
   * 背景:
   * - Gemini streaming は「最後のイベントが完成レスポンス」と限らず、
   *   functionCall が途中に出て、最後は finishReason/usage のみで parts が空のことがある。
   */
  returnOnFirstFunctionCall?: boolean;
};

/**
 * Gemini の SSE レスポンスを読み取り、tool calling と表示テキストを両立する形でレスポンスを組み立てる。
 *
 * 返却方針（重要）:
 * - tool calling を正しく行うため、functionCall を含むイベントを優先して返す
 *   （returnOnFirstFunctionCall=true の場合）。
 * - ただし functionCall の args が “直後に補完される” 実装差に備えて、
 *   少数イベントだけ待ってから返す（best-effort）。
 *
 * thoughtSignature 保護:
 * - content.parts は “API が返した raw のまま” 返す。
 * - parts を merge/再構築して text を詰め直さない（壊すと tool calling が崩れる恐れ）。
 */
async function readGeminiSseResponse(
  res: Response,
  opts: ReadGeminiSseOptions,
): Promise<GeminiStreamDecoratedResponse> {
  const { sseCallback, returnOnFirstFunctionCall } = opts;

  if (!res.body) {
    throw new Error("Gemini API streaming error: missing response body.");
  }

  const canProgress = typeof sseCallback === "function";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseEventDecoder();
  const textAcc = new GeminiTextAccumulator();

  let lastParsed: GeminiGenerateContentResponse | null = null;
  let lastWithParts: GeminiGenerateContentResponse | null = null;
  let lastWithFunctionCall: GeminiGenerateContentResponse | null = null;

  let latestUsage: GeminiUsageMetadata | undefined;
  let latestFinishReason: string | undefined;

  // デバッグ用: 直近 event の先頭を保持（エラー時に出す）
  let lastSample = "";

  // functionCall を観測した後、args が後続で補完される可能性に備えて少し待つ
  let functionCallSeen = false;
  let functionCallAfterSeenEvents = 0;
  const MAX_EXTRA_EVENTS_AFTER_FC = 3;

  // 早期 return 対象（functionCall を含むイベント）
  let earlyReturn: GeminiGenerateContentResponse | null = null;

  /**
   * SSE の delta を progress callback に流す。
   * - “SSE の場合のみ” 呼ぶ（非 SSE ではそもそもここに来ない）。
   */
  const emitDelta = (delta: string) => {
    if (!canProgress) return;
    if (!delta) return;
    sseCallback!({ type: "response.output_text.delta", delta });
  };

  /**
   * SSE 完了イベントを progress callback に流す。
   */
  const emitCompleted = (responseObj: any) => {
    if (!canProgress) return;
    sseCallback!({ type: "response.completed", response: responseObj });
  };

  /**
   * functionCall の args が “概ね揃っている” とみなせるかの best-effort 判定。
   *
   * 背景:
   * - 実装差で args が後続イベントに分割される可能性がある。
   * - ただしここで厳密に待ち続けると永遠に返せない恐れがあるため、
   *   「少なくとも1つの call で args が object になっている」ことを complete の目安にする。
   */
  const isFunctionCallArgsComplete = (resp: GeminiGenerateContentResponse): boolean => {
    const parts = getCandidate0Parts(resp);
    const calls = parts
      .map((p) => p?.functionCall)
      .filter((fc) => fc && typeof fc.name === "string");

    if (calls.length === 0) return false;

    return calls.some(
      (fc: any) =>
        fc?.args &&
        typeof fc.args === "object" &&
        fc.args !== null &&
        !Array.isArray(fc.args),
    );
  };

  /**
   * 返却レスポンスに “表示用テキスト” とデバッグ情報を付与する。
   *
   * 注意:
   * - content.parts の改変はしない（thoughtSignature を壊さない）。
   * - usage/finishReason は “観測できた最新” を補完する（最終イベント側に出やすいため）。
   */
  const decorate = (base: GeminiGenerateContentResponse): GeminiStreamDecoratedResponse => {
    const out: GeminiStreamDecoratedResponse = {
      ...base,
      __accumulatedText: textAcc.get(),
      __streamLast: lastParsed,
      __streamHadFunctionCall: Boolean(lastWithFunctionCall),
    };

    if (latestUsage) out.usageMetadata = latestUsage;

    if (latestFinishReason && Array.isArray(out.candidates) && out.candidates.length > 0) {
      out.candidates = [
        { ...out.candidates[0], finishReason: latestFinishReason },
        ...out.candidates.slice(1),
      ];
    }

    return out;
  };

  /**
   * パース済みイベントを取り込み、状態更新と earlyReturn 判定を行う。
   *
   * ここが最重要:
   * - functionCall を見つけたら “そのイベント” を返す（returnOnFirstFunctionCall=true）
   * - ただし args が未完かもしれないので、少数イベントだけ待つ
   */
  const consumeParsed = (parsed: GeminiGenerateContentResponse) => {
    lastParsed = parsed;

    if (parsed.usageMetadata) latestUsage = parsed.usageMetadata;

    const fr = parsed?.candidates?.[0]?.finishReason;
    if (typeof fr === "string") latestFinishReason = fr;

    if (responseHasAnyParts(parsed)) lastWithParts = parsed;

    // 表示用テキストを assemble（parts は改変しない）
    const chunkText = extractGeminiText(parsed);
    const { delta } = textAcc.ingest(chunkText);
    emitDelta(delta);

    // tool call の取りこぼしを防ぐため、functionCall を優先して保持
    if (responseHasFunctionCall(parsed)) {
      lastWithFunctionCall = parsed;

      if (!functionCallSeen) {
        functionCallSeen = true;
        functionCallAfterSeenEvents = 0;
      }

      if (returnOnFirstFunctionCall) {
        // args が揃っているなら即返す
        if (isFunctionCallArgsComplete(parsed)) {
          earlyReturn = parsed;
        }
        // args が未完なら “少しだけ” 続きを読んで補完されるのを待つ（下の else 側でカウント）
      }
      return;
    }

    // functionCall を見た後に “functionCall なしイベント” が続く場合:
    // - args 補完イベントが来ないまま終わるケースに備えて、一定回数で best-effort return する
    if (functionCallSeen && returnOnFirstFunctionCall) {
      functionCallAfterSeenEvents += 1;

      if (!earlyReturn && functionCallAfterSeenEvents >= MAX_EXTRA_EVENTS_AFTER_FC) {
        // best-effort: 最後に観測した functionCall イベントを返す
        earlyReturn = lastWithFunctionCall;
      }

      // finishReason が来たら、この時点でも best-effort で返して良い
      if (!earlyReturn && typeof fr === "string" && lastWithFunctionCall) {
        earlyReturn = lastWithFunctionCall;
      }
    }
  };

  /**
   * SSE 解析の main loop。
   *
   * 注意（わかりづらい点）:
   * - earlyReturn を検出した時点で “ストリーム読みを中断” する必要がある。
   * - ただし while(true) + for(...) の二重ループなので、ラベル付き break で抜ける。
   */
  readLoop: try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunkText = decoder.decode(value, { stream: true });
      const rawEvents = sse.push(chunkText);

      for (const rawEvent of rawEvents) {
        const { parsed, sample } = parseGeminiSseEvent(rawEvent);
        lastSample = sample || lastSample;

        if (!parsed) continue;

        consumeParsed(parsed);

        // functionCall を “そのイベントで返す” 方針の場合、ここで中断して返却に移る
        if (earlyReturn) break readLoop;
      }
    }

    // ストリーム終端: TextDecoder / SSE buffer の残りを flush して最後の event を処理
    const tail = decoder.decode();
    const remainingEvents = sse.flush(tail);

    for (const rawEvent of remainingEvents) {
      const { parsed, sample } = parseGeminiSseEvent(rawEvent);
      lastSample = sample || lastSample;

      if (!parsed) continue;

      consumeParsed(parsed);

      if (earlyReturn) break readLoop;
    }
  } finally {
    // 早期 return / 正常終了 いずれでも reader を止める
    await reader.cancel().catch(() => {});
  }

  // 早期 return（functionCall を含むイベントを返す）:
  // - tool calling を確実に起動するための最優先パス
  if (earlyReturn) {
    const decorated = decorate(earlyReturn);
    emitCompleted(decorated);
    return decorated;
  }

  // 通常 return（最後まで読んだ場合）:
  // - functionCall が出ていればそれを、そうでなければ parts がある最後を、最後に parse できたものを返す
  const base = lastWithFunctionCall ?? lastWithParts ?? lastParsed;
  if (!base) {
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    throw new Error(
      [
        "Gemini API streaming error: no parsable SSE events received.",
        `content-type=${contentType}`,
        `sample=${lastSample || "(empty)"}`,
      ].join("\n"),
    );
  }

  const decorated = decorate(base);
  emitCompleted(decorated);
  return decorated;
}

// ---------------------------------------------------------
// Gemini API request
// ---------------------------------------------------------

/**
 * Gemini API を呼び出し、レスポンスを GeminiGenerateContentResponse として返す。
 *
 * 処理概要:
 * - fetch 実行
 * - Content-Type を見て SSE なら streaming として解析（readGeminiSseResponse）
 * - SSE でなければ通常 JSON として res.json()
 *
 * 目的:
 * - “sseCallback の有無” ではなく “レスポンスが SSE の場合のみ” progress を流す要件を満たす。
 * - SSE 時に functionCall を取りこぼさない（途中イベントを返す）。
 */
async function callGeminiGenerateContent(
  body: unknown,
  opts: {
    apiKey: string;
    model: string;
    endpoint?: string;
    isStream?: boolean;
    sseCallback?: (event: any) => void;
    signal?: AbortSignal;
    logger?: Logger;
  },
): Promise<GeminiGenerateContentResponse> {
  const { apiKey, model, endpoint, sseCallback, signal } = opts;

  const url = resolveGeminiEndpoint({ model, endpoint });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API error: ${res.status} ${res.statusText}\n${text}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const isEventStream = isTextEventStream(contentType);

  // 非 SSE は通常 JSON（sseCallback は要件上 “呼ばない”）
  if (!isEventStream) {
    return (await res.json()) as GeminiGenerateContentResponse;
  }

  // SSE の場合のみ streaming 解析（途中の functionCall イベントで early return し得る）
  return await readGeminiSseResponse(res, {
    sseCallback,
    returnOnFirstFunctionCall: true,
  });
}

// ---------------------------------------------------------
// Output text extraction
// ---------------------------------------------------------

/**
 * “最終アウトプット文字列” を取り出すユーティリティ。
 *
 * 目的:
 * - 呼び出し側が欲しいのは最終テキストであることが多いため、各形式を吸収して統一的に返す。
 *
 * 実装方針:
 * - OpenAI Responses 互換の output_text / output[] をまず見る
 * - Gemini の streaming では __accumulatedText を最優先（最後イベントが空でも全文が取れる）
 * - 最後に candidates[0].content.parts[].text の連結にフォールバック
 */
function getOutputText(response: any): string {
  // OpenAI Responses API 互換
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  if (Array.isArray(response?.output)) {
    const messageTexts: string[] = [];
    for (const item of response.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        const parts = item.content
          .filter((c: any) => c?.type === "output_text" && typeof c.text === "string")
          .map((c: any) => c.text);
        if (parts.length > 0) messageTexts.push(parts.join(""));
      }
    }
    if (messageTexts.length > 0) return messageTexts.join("\n");
  }

  // Gemini: SSE assemble（parts を改変しないため別フィールド）
  if (typeof response?.__accumulatedText === "string") {
    return response.__accumulatedText;
  }

  // Gemini GenerateContentResponse 互換
  if (Array.isArray(response?.candidates)) {
    return extractGeminiText(response as GeminiGenerateContentResponse);
  }

  throw new Error("No text output found in model result.");
}

// ---------------------------------------------------------
// Gemini tool calling loop
// ---------------------------------------------------------

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
 * Gemini に対して tool calling ループを実行する。
 *
 * 処理概要:
 * 1) baseInput を Gemini の systemInstruction / contents に変換
 * 2) tools を functionDeclarations として設定
 * 3) 生成 → functionCall 抽出 → tool 実行 → functionResponse を contents に積む、を最大 maxLoops まで繰り返す
 *
 * 目的:
 * - MCP tools / local tools を Gemini で呼び出し可能にし、ブラウジング等の agent 動作を実現する。
 *
 * 注意:
 * - Gemini 3 系では thoughtSignature 等が tool calling に影響し得るため、
 *   model の content.parts は raw のまま geminiContents に push し、改変しない。
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
}): Promise<GeminiGenerateContentResponse> {
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
    sseCallback,
    signal,
    logger,
    clock,
  } = options;

  const maxLoops = Number(process.env.RESPONSES_MAX_LOOPS) || 10;

  const geminiTools = openAiToolsToGeminiTools(openAiTools);

  // thread が OpenAI の previous_response_id 前提の可能性があるため、
  // Gemini では server-side continuation を使わず、必要なら thread が組み立てた input を利用する。
  let initialInput = baseInput;
  try {
    if (
      thread &&
      typeof (thread as any).buildRequestContextForResponsesAPI === "function"
    ) {
      try {
        // Gemini では previous_response_id は無意味なので無効化（存在する場合のみ）
        if (typeof (thread as any).updatePreviousResponseId === "function") {
          (thread as any).updatePreviousResponseId(undefined);
        }
      } catch {
        // ignore
      }

      const ctx = (thread as any).buildRequestContextForResponsesAPI(baseInput);
      if (ctx && Array.isArray(ctx.input)) initialInput = ctx.input;
    }
  } catch {
    // ignore
  }

  const { systemInstruction, contents: initialContents } =
    toGeminiSystemAndContentsFromBaseInput(initialInput);

  // Gemini は contents が空だとエラーになり得るため最低 1 件確保
  const geminiContents: GeminiContent[] =
    initialContents.length > 0
      ? [...initialContents]
      : [{ role: "user", parts: [{ text: "" }] }];

  /**
   * Gemini の generate/streamGenerate リクエスト body を組み立てる。
   * - tools/toolConfig は tool がある場合のみ付与
   * - structured output は responseJsonSchema を設定
   */
  const buildRequestBody = (): Record<string, unknown> => {
    const generationConfig: Record<string, unknown> = {
      ...(temperature !== undefined ? { temperature } : {}),
    };

    if (structuredOutput?.format?.type === "json_schema") {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = sanitizeJsonSchema(
        structuredOutput.format.schema,
      );
    }

    const body: Record<string, unknown> = {
      contents: geminiContents,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(geminiTools.length > 0 ? { tools: geminiTools } : {}),
      ...(geminiTools.length > 0
        ? {
            toolConfig: {
              functionCallingConfig: {
                mode: "AUTO",
              },
            },
          }
        : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    };

    return body;
  };

  let lastResponse: GeminiGenerateContentResponse | null = null;

  for (let loop = 0; loop < maxLoops; loop++) {
    const response: GeminiGenerateContentResponse = await logTimed(
      logger,
      clock,
      "llm.step.completed",
      { model, loop },
      async () =>
        callGeminiGenerateContent(buildRequestBody(), {
          apiKey,
          model: String(model),
          endpoint,
          isStream,
          sseCallback,
          signal,
          logger,
        }),
      "info",
    );

    logger.debug("gemini.api.result", {
      responseJson: JSON.stringify(response, null, 2),
    });

    // usage 集計（OpenAI 互換形へ変換して accumulate）
    accumulateUsage(usage, toOpenAiLikeUsageFromGemini(response?.usageMetadata));
    lastResponse = response;

    // モデル出力を会話履歴へ積む（parts は raw のまま）
    // ※ここで parts を編集すると thoughtSignature 等が壊れて tool calling が不安定になり得る
    const modelContent = response?.candidates?.[0]?.content;
    if (modelContent && Array.isArray(modelContent.parts)) {
      geminiContents.push({
        role: "model",
        parts: modelContent.parts,
      });
    }

    // function calls 抽出
    const functionCalls = extractGeminiFunctionCalls(response);

    // 分岐がわかりづらいポイント:
    // - functionCalls が無い場合、このターンで tool 呼び出しは発生していないのでループ終了
    // - streaming では “最後のイベントが空” のケースがあるが、
    //   SSE 側で functionCall イベントを early return するため、ここで取りこぼしにくい
    if (functionCalls.length === 0) break;

    // tool 実行のため callId を正規化（Gemini id が無い場合はローカル生成）
    const callMetaByInternalId = new Map<string, { geminiId?: string; name: string }>();

    const normalizedCalls: NormalizedToolCall[] = functionCalls.map((fc, idx) => {
      const internalId = fc.id ?? createLocalId(`gemini_call_${loop}_${idx}`);
      callMetaByInternalId.set(internalId, { geminiId: fc.id, name: fc.name });
      return {
        name: fc.name,
        callId: internalId,
        arguments: fc.args ?? {},
      };
    });

    // ツール実行（local優先→MCP）
    const normalizedResults = await executeToolCalls(
      normalizedCalls,
      toolNameToClient,
      localToolHandlers,
      { logger, clock },
    );

    // tool 実行結果を functionResponse として Gemini の “user parts” に積む
    const functionResponseParts: GeminiPart[] = normalizedResults.map((r) => {
      const meta = callMetaByInternalId.get(r.callId);
      if (!meta) throw new Error(`Missing call meta for tool result callId=${r.callId}`);

      const parsed = tryParseJsonObject(r.output);
      const responseObj = parsed ?? { result: r.output };

      return {
        functionResponse: {
          name: meta.name,
          ...(meta.geminiId ? { id: meta.geminiId } : {}),
          response: responseObj,
        },
      };
    });

    geminiContents.push({
      role: "user",
      parts: functionResponseParts,
    });

    // thread への履歴追記（互換維持のためベストエフォート）
    try {
      thread?.appendToHistory?.([
        ...functionCalls.map((fc) => ({
          type: "function_call",
          name: fc.name,
          arguments: fc.args ?? {},
          call_id: fc.id ?? undefined,
          id: fc.id ?? undefined,
        })),
        ...normalizedResults.map((r) => ({
          type: "function_call_output",
          call_id: r.callId,
          output: r.output,
        })),
      ]);
    } catch {
      // ignore
    }
  }

  if (!lastResponse) throw new Error("No response from Gemini API.");
  return lastResponse;
}

/**
 * Gemini API を用いた Agent 実行（MCP/ローカルツール対応）。
 *
 * 処理概要:
 * 1) MCP サーバーへ接続して tool catalog を構築
 * 2) local tools を合成し、名前衝突等を検査
 * 3) runToolCallingLoop で LLM→tool→LLM を回す
 * 4) 最終レスポンスからテキストのみを抽出して返す
 */
export async function callGeminiAgent(options: {
  model: string;
  apiKey?: string;
  endpoint?: string;
  isStream?: boolean;
  baseInput: any[];
  thread?: Thread;
  structuredOutput?: StructuredOutput;
  mcpServers?: MCPServerConfig[];
  localTools?: {
    tools: OpenAiTool[];
    handlers: Map<string, LocalToolHandler>;
  };
  config?: {
    temperature?: number;
    truncation?: TruncationOption;
  };
  sseCallback?: (event: any) => void;
  signal?: AbortSignal;
  logger?: Logger;
  clock?: Clock;
}): Promise<{
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

  const resolvedApiKey =
    apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;

  if (!resolvedApiKey) {
    throw new Error("GOOGLE_API_KEY is missing.");
  }

  const temperature = config?.temperature ?? undefined;
  const truncation = config?.truncation ?? undefined;

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
    // 1) MCP 接続＆ツール収集
    const setup = await setupMcpClientsAndTools({
      mcpServers,
      clientName: "local-mcp-gemini-client",
      clientVersion: "1.0.0",
    });

    mcpClients = setup.mcpClients;
    toolNameToClient = setup.toolNameToClient;

    // MCP tools -> OpenAiTool（中立形）
    openAiTools = new McpToolCatalog(setup.mcpTools).toOpenAiTools();

    // 追加の local tools を検査して合成
    if (localTools) {
      const seenLocalToolNames = new Set<string>();

      for (const tool of localTools.tools) {
        if (toolNameToClient.has(tool.name)) {
          throw new Error(`Tool name collision between MCP and local tools: ${tool.name}`);
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

    // 2) LLM + tool calling loop
    lastResponse = await runToolCallingLoop({
      baseInput,
      openAiTools,
      toolNameToClient,
      localToolHandlers: localTools?.handlers,
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

    if (!lastResponse) throw new Error("No response from Gemini API.");

    // 3) 最終アウトプット（テキストのみ）
    const outputText = getOutputText(lastResponse);
    logger.info("responses.output_text", { outputText });

    return { output: outputText, usage, rawResponse: lastResponse };
  } finally {
    // MCP クライアントは必ず close（ベストエフォート）
    await Promise.allSettled(
      mcpClients.map(async (client) => {
        try {
          if (typeof client?.close === "function") await client.close();
        } catch {
          // ignore
        }
      }),
    );
  }
}
