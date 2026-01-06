// src/utils/mcp-utils.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig } from "../types";

type McpTransport = Parameters<Client["connect"]>[0];

export function createMcpTransport(server: MCPServerConfig): McpTransport {
  switch (server.type) {
    case "stdio": {
      if (!server.command) {
        throw new Error(`[mcp:${server.name}] stdio transport requires command`);
      }
      const env = server.env
        ? { ...getDefaultEnvironment(), ...server.env }
        : undefined;

      return new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env,
      });
    }

    case "streamable_http": {
      if (!server.url) {
        throw new Error(`[mcp:${server.name}] streamable_http transport requires url`);
      }
      const requestInit: RequestInit | undefined = server.headers
        ? { headers: server.headers }
        : undefined;

      return new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit,
      });
    }

    // deprecated
    case "sse": {
      if (!server.url) {
        throw new Error(`[mcp:${server.name}] sse transport requires url`);
      }
      const requestInit: RequestInit | undefined = server.headers
        ? { headers: server.headers }
        : undefined;

      const eventSourceInit = server.headers
        ? ({ headers: server.headers } as any)
        : undefined;

      return new SSEClientTransport(new URL(server.url), {
        requestInit,
        eventSourceInit,
      });
    }

    default: {
      const _exhaustive: never = server.type;
      throw new Error(`Unsupported MCP transport type: ${String(_exhaustive)}`);
    }
  }
}

export type SanitizedToolCallResultBundle<T = unknown> = {
  /**
   * MCP の callTool() が返した生の結果（参照を保持します）。
   * ここには巨大 base64 が含まれ得るため、LLM 履歴に混ぜないこと。
   */
  rawResult: T;

  /**
   * LLM 履歴に載せても破綻しにくいようにサニタイズした結果。
   * MCP の ToolResult（CallToolResult）形状を維持し、必須フィールドの型を壊しません。
   */
  sanitizedResult: T;

  /**
   * rawResult と sanitizedResult に差分があるか（= サニタイズが実際に適用されたか）。
   * - true: 何らかの短縮/置換が発生している
   * - false: raw と同一（参照も同一）を返している
   */
  isSanitized: boolean;
};

export type SanitizeToolCallResultOptions = {
  /**
   * type:"text" の text を短縮する上限（文字数）。
   * Playwright の snapshot 等で極端に長くなるのを抑制します。
   */
  maxTextChars?: number;

  /**
   * resource_link などの汎用文字列（title/description/name/uri）の上限（文字数）。
   */
  maxStringChars?: number;

  /**
   * image/audio の data、resource の blob がこの長さ以上の場合に「危険」と見做して省略します。
   * （LLM 履歴に混ざるとトークン爆発の主要因）
   */
  binaryOmitThresholdChars?: number;

  /**
   * 省略したバイナリ文字列を置換する文字列。
   * MCP 的に data/blob は string 必須なので、必ず string を返します。
   *
   * デフォルトは空文字（base64 としてもデコード可能＝空バイナリ）。
   */
  binaryReplacement?: string;

  /**
   * 指紋計算に使うサンプル長（先頭N文字）。
   * 巨大 base64 全量を走査しないようにするための上限。
   */
  fingerprintSampleChars?: number;

  /**
   * 指紋（非暗号学的）を付けるか。
   * Edge 互換の軽量指紋（FNV-1a 32bit）です。監査用ハッシュ用途ではありません。
   */
  enableFingerprint?: boolean;

  /**
   * CallToolResult.structuredContent を短縮するか。
   * structuredContent を後段が厳密に期待している場合は false 推奨。
   */
  sanitizeStructuredContent?: boolean;

  /**
   * structuredContent の文字列短縮上限（sanitizeStructuredContent=true の場合のみ）。
   */
  structuredContentMaxStringChars?: number;
};

type AnyRecord = Record<string, unknown>;

const DEFAULTS: Required<SanitizeToolCallResultOptions> = {
  maxTextChars: 12_000,
  maxStringChars: 4_000,
  binaryOmitThresholdChars: 2_000,
  binaryReplacement: "",
  fingerprintSampleChars: 64_000,
  enableFingerprint: true,
  sanitizeStructuredContent: false,
  structuredContentMaxStringChars: 8_000,
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…[[TRUNCATED]]";
}

/**
 * Edge/Node 両対応の軽量指紋（非暗号学的）。
 * 同一データっぽさの判別・デバッグ用途向け。
 */
function fnv1a32Hex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function mergeMeta(existing: unknown, patch: AnyRecord): AnyRecord {
  const base: AnyRecord =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as AnyRecord)
      : {};
  return { ...base, ...patch };
}

function summarizeOmittedBinary(
  data: string,
  opts: Required<SanitizeToolCallResultOptions>,
): AnyRecord {
  const sample = data.slice(0, opts.fingerprintSampleChars);
  const summary: AnyRecord = {
    omitted: true,
    originalLength: data.length,
    sampledChars: sample.length,
    isSampled: data.length > sample.length,
  };
  if (opts.enableFingerprint) {
    summary.fingerprint = fnv1a32Hex(sample);
    summary.fingerprintAlg = "fnv1a32(sample)";
  }
  return summary;
}

function sanitizeStructuredContent(
  value: unknown,
  maxStringChars: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return truncate(value, maxStringChars);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeStructuredContent(v, maxStringChars, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[[CIRCULAR]]";
    seen.add(value as object);

    const obj = value as AnyRecord;
    const out: AnyRecord = {};
    for (const k of Object.keys(obj)) {
      out[k] = sanitizeStructuredContent(obj[k], maxStringChars, seen);
    }
    return out;
  }

  return String(value);
}

/**
 * MCP の `client.callTool()` が返す結果を、
 * **(1) rawResult と (2) sanitizedResult に分離**して返します。
 *
 * ## なぜ分離するのか
 * - image/audio/resource.blob が base64 を含む場合、そのまま LLM 履歴に入れると
 *   トークン爆発・履歴欠落・API失敗の原因になります。
 * - しかし後段でバイナリが必要なケース（保存/解析/復元）があるため、
 *   **raw を捨てずに保持**できる形が必要です。
 *
 * ## MCPプロトコル互換性（重要）
 * - `content[]` は維持します。
 * - `type:"image"` / `type:"audio"` の `data` は **string のまま維持**します（必須フィールド）。
 *   省略する場合でも `data` を削除せず、`binaryReplacement`（デフォルトは空文字）に置換します。
 * - `type:"resource"` の `resource.blob` も同様に **string のまま維持**します（必須フィールド）。
 * - 省略・短縮した事実や指紋は `_meta.__sanitizer` に格納します（`_meta` は MCP が許容する拡張領域）。
 *
 * ## 戻り値の使い方（推奨）
 * - LLM へ渡す/履歴に積む：`sanitizedResult` だけ
 * - デバッグ保存/後段処理：`rawResult`（必要に応じて別ストレージへ）
 *
 * @param result MCP の callTool() 戻り値（そのまま渡してOK）
 * @param options サニタイズ閾値・置換文字列等
 */
export function sanitizeToolCallResult<T = unknown>(
  result: T,
  options?: SanitizeToolCallResultOptions,
): SanitizedToolCallResultBundle<T> {
  const opts = { ...DEFAULTS, ...(options ?? {}) };

  // 仕様外の形は触らず、そのまま返す（「壊さない」優先）
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { rawResult: result, sanitizedResult: result, isSanitized: false };
  }

  const r = result as unknown as AnyRecord;
  const content = Array.isArray(r.content) ? (r.content as unknown[]) : null;

  // CallToolResult でない（content が無い）場合も、そのまま返す
  if (!content) {
    return { rawResult: result, sanitizedResult: result, isSanitized: false };
  }

  let changed = false;

  const sanitizedContent = content.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return block;

    const b = block as AnyRecord;
    const type = typeof b.type === "string" ? (b.type as string) : "unknown";

    if (type === "text") {
      const text = typeof b.text === "string" ? b.text : "";
      if (text.length > opts.maxTextChars) {
        changed = true;
        return {
          ...b,
          text: truncate(text, opts.maxTextChars),
          _meta: mergeMeta(b._meta, {
            __sanitizer: mergeMeta((b._meta as any)?.__sanitizer, {
              text: { truncated: true, originalLength: text.length, maxChars: opts.maxTextChars },
            }),
          }),
        };
      }
      return b;
    }

    if (type === "image" || type === "audio") {
      const data = typeof b.data === "string" ? b.data : "";
      if (data.length >= opts.binaryOmitThresholdChars) {
        changed = true;
        const summary = summarizeOmittedBinary(data, opts);
        return {
          ...b,
          // MCP互換: data は string を維持（削除しない）
          data: opts.binaryReplacement,
          _meta: mergeMeta(b._meta, {
            __sanitizer: mergeMeta((b._meta as any)?.__sanitizer, {
              data: summary,
            }),
          }),
        };
      }
      return b;
    }

    if (type === "resource") {
      const resource = b.resource;
      if (resource && typeof resource === "object" && !Array.isArray(resource)) {
        const rsrc = resource as AnyRecord;

        // text resource
        if (typeof rsrc.text === "string" && rsrc.text.length > opts.maxTextChars) {
          changed = true;
          const originalLength = rsrc.text.length;
          return {
            ...b,
            resource: {
              ...rsrc,
              text: truncate(rsrc.text, opts.maxTextChars),
              _meta: mergeMeta(rsrc._meta, {
                __sanitizer: mergeMeta((rsrc._meta as any)?.__sanitizer, {
                  text: { truncated: true, originalLength, maxChars: opts.maxTextChars },
                }),
              }),
            },
          };
        }

        // blob resource
        if (typeof rsrc.blob === "string" && rsrc.blob.length >= opts.binaryOmitThresholdChars) {
          changed = true;
          const blob = rsrc.blob;
          const summary = summarizeOmittedBinary(blob, opts);
          return {
            ...b,
            resource: {
              ...rsrc,
              // MCP互換: blob は string を維持（削除しない）
              blob: opts.binaryReplacement,
              _meta: mergeMeta(rsrc._meta, {
                __sanitizer: mergeMeta((rsrc._meta as any)?.__sanitizer, {
                  blob: summary,
                }),
              }),
            },
          };
        }
      }
      return b;
    }

    if (type === "resource_link") {
      // 文字列を短縮（型は維持）
      let localChanged = false;
      const next: AnyRecord = { ...b };

      for (const key of ["title", "description", "name", "uri"] as const) {
        const v = next[key];
        if (typeof v === "string" && v.length > opts.maxStringChars) {
          localChanged = true;
          next[key] = truncate(v, opts.maxStringChars);
        }
      }

      if (localChanged) {
        changed = true;
        next._meta = mergeMeta(b._meta, {
          __sanitizer: mergeMeta((b._meta as any)?.__sanitizer, {
            strings: { truncated: true, maxChars: opts.maxStringChars },
          }),
        });
        return next;
      }

      return b;
    }

    // unknown type は壊さない（サーバ独自拡張を尊重）
    return b;
  });

  if (!changed) {
    // 変更が無いなら参照も同一にして「合致」を厳密に表現できるようにする
    return { rawResult: result, sanitizedResult: result, isSanitized: false };
  }

  const nextStructuredContent =
    opts.sanitizeStructuredContent && (r as any).structuredContent !== undefined
      ? sanitizeStructuredContent(
          (r as any).structuredContent,
          opts.structuredContentMaxStringChars,
          new WeakSet<object>(),
        )
      : (r as any).structuredContent;

  const sanitizedTop: AnyRecord = {
    ...r,
    content: sanitizedContent,
    structuredContent: nextStructuredContent,
    _meta: mergeMeta(r._meta, {
      __sanitizer: mergeMeta((r._meta as any)?.__sanitizer, {
        applied: true,
        binaryOmitThresholdChars: opts.binaryOmitThresholdChars,
        maxTextChars: opts.maxTextChars,
      }),
    }),
  };

  return {
    rawResult: result,
    sanitizedResult: sanitizedTop as unknown as T,
    isSanitized: true,
  };
}
