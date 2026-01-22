// src/utils/mcp/mcp-tool-catalog.ts
import type { McpTool } from "../../types/index.js";

/**
 * OpenAI Responses API 向け tool schema
 */
export type OpenAiTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: unknown;
};

/**
 * Gemini (Google Generative Language API) 向け tool schema
 * - tools: [{ functionDeclarations: [...] }]
 * - functionDeclarations[].parametersJsonSchema に JSON Schema を入れる
 */
export type GeminiTool = {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
};

/**
 * MCP tool 定義（McpTool[]）を OpenAI tool schema に変換するための小さなカタログ。
 * 目的は「変換処理に名前を与えて読みやすくする」こと。
 */
export class McpToolCatalog {
  readonly tools: ReadonlyArray<McpTool>;

  constructor(tools: McpTool[]) {
    this.tools = tools;
  }

  /**
   * MCP tools -> OpenAI tools
   */
  toOpenAiTools(): OpenAiTool[] {
    return this.tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }

  /**
   * MCP tools -> Gemini tools
   *
   * IMPORTANT:
   * - Gemini の functionDeclarations は `parameters` ではなく `parametersJsonSchema` を使う。
   *   （parameters に JSON Schema を入れると "Unknown name additionalProperties/$schema" 等で落ちる）
   */
  toGeminiTools(): GeminiTool[] {
    if (this.tools.length === 0) return [];

    return [
      {
        functionDeclarations: this.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.inputSchema,
        })),
      },
    ];
  }
}
