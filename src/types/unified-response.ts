// src/types/unified-output-item.ts

import type { Usage } from './usage.js';

export type Provider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure'
  | 'deepseek'
  | 'ollama'
  | 'openai-compatible';

export type UnifiedOutputItemType =
  | "text"
  | "function_call"
  | "mcp_call";

export interface UnifiedOutputItemBase {
  /**
   * Discriminant.
   */
  type: UnifiedOutputItemType;

  /**
   * Stable item identifier in the unified layer.
   *
   * Sources:
   * - OpenAI: output[i].id (if present) / message.id / tool call id
   * - Anthropic: content block id / tool_use id (if present)
   * - Google: part index-based (often no id)
   *
   * Fallback:
   * - `${response.id}:${index}` in adapter
   */
  id: string;

  /**
   * Item timestamp (Unix ms).
   *
   * Sources:
   * - Often not available per-item upstream.
   *
   * Fallback:
   * - Use response.createdAt
   */
  createdAt: number;
}

export type UnifiedOutputItem =
  | UnifiedTextItem
  | UnifiedFunctionCallItem
  | UnifiedMcpCallItem;

export interface UnifiedTextItem {
  type: "text";
  text: string;
  meta?: Record<string, unknown>;
}

export interface UnifiedFunctionCallItem {
  type: "function_call_output";
  callId: string;
  output: string;
}

export interface UnifiedMcpCallItem {
  type: "mcp_call";
  /** MCP tool名（= “remote tool” の識別子） */
  name: string;
  /** MCPサーバ（Anthropicだと server名/label、OpenAIだと server_label 等になりがち） */
  server: string;

  arguments: unknown;
  callId?: string;

  /** たとえば “人間承認が必要” を統一表現したい時用 */
  requiresApproval?: boolean;
}

export interface UnifiedResponse {
  /**
   * Stable response identifier in the unified layer.
   *
   * Sources:
   * - OpenAI: response.id (e.g. "resp_...")
   * - Anthropic: message.id
   * - Google (Gemini API): response / candidate id (if exposed; may be absent)
   * - OpenAI-compatible: response.id or choices[0].message id (varies)
   *
   * Fallback (if upstream has no stable id):
   * - Create in adapter: `${provider}-${createdAt}-${random/uuid}`
   */
  id: string;

  /**
   * Provider of the upstream model/API.
   */
  provider: Provider;

  /**
   * Model identifier / deployment name as provided by upstream.
   *
   * Sources:
   * - OpenAI: model
   * - Anthropic: model
   * - Google: model (or modelVersion / model name depending on SDK)
   */
  model: string;

  output: UnifiedOutputItem[];

  // Last output text (if any) for convenience
  lastOutputText?: string;

  error?: Error;

  /**
   * Token usage normalized (best-effort).
   *
   * Sources:
   * - OpenAI: usage.{input_tokens, output_tokens, total_tokens}
   * - Anthropic: usage.{input_tokens, output_tokens} (shape may differ)
   * - Google: usageMetadata (shape differs)
   *
   * Notes:
   * - Some providers don't return usage unless requested / enabled.
   */
  usage?: Usage;

  /**
   * Unified creation timestamp (Unix epoch **milliseconds**).
   *
   * Normalized meaning:
   * - Prefer "model-side creation time" if provided by upstream.
   * - Otherwise use "adapter receive time" (Date.now()).
   *
   * Sources (typical):
   * - OpenAI: created_at (seconds) -> ms
   * - Google (Gemini API / Vertex): createTime (RFC3339 string) -> ms
   * - Anthropic: (often no direct created time on the message object)
   *
   * Fallback:
   * - Date.now() at adapter boundary.
   */
  createdAt: number;

  /**
   * Extra diagnostics / metadata for tracing and debugging.
   * - Recommended: include raw provider response behind a feature flag.
   */
  meta?: Record<string, unknown>;

  rawResponse?: unknown;
}
