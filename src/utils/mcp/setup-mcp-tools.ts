// src/utils/mcp/setup-mcp-tools.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { MCPServerConfig, McpTool } from "../../types/index.js";
import { createMcpTransport } from "../mcp-utils.js";

export type SetupMcpClientsAndToolsOptions = {
  mcpServers?: MCPServerConfig[];
  clientName?: string;
  clientVersion?: string;
};

export type SetupMcpClientsAndToolsResult = {
  /**
   * 接続済みMCPクライアント。呼び出し側で必ずcloseしてください（finally推奨）。
   * Connected MCP clients; callers must close them (finally recommended).
   */
  mcpClients: Client[];
  /**
   * MCPから取得した tool 定義（中立形）。provider側でOpenAI/Anthropic/Google形式に変換する。
   * Tool definitions fetched from MCP (neutral shape), converted by providers to OpenAI/Anthropic/Google formats.
   */
  mcpTools: McpTool[];
  /**
   * tool名 -> そのtoolを提供するMCPクライアント
   * tool name -> MCP client that provides the tool
   */
  toolNameToClient: Map<string, Client>;
  /**
   * tool名 -> そのtoolを許可したサーバー設定（デバッグ用途）
   * tool name -> server config that allowed the tool (debugging)
   */
  toolNameToServer: Map<string, MCPServerConfig>;
};

async function closeClientsQuietly(clients: Client[]) {
  await Promise.allSettled(
    clients.map(async (client) => {
      try {
        if (typeof (client as any).close === "function") {
          await (client as any).close();
        }
      } catch {
        // ignore
      }
    }),
  );
}

/**
 * MCP クライアントを接続し、MCPの tools を収集する（プロバイダー非依存）。
 * Connect MCP clients and collect MCP tools (provider-agnostic).
 *
 * - allowedTools によるフィルタ
 * - Filter by allowedTools
 * - tool名の衝突検出（複数サーバー間）
 * - Detect tool name collisions across servers
 * - 失敗時のクリーンアップ
 * - Cleanup on failure
 */
export async function setupMcpClientsAndTools(
  options: SetupMcpClientsAndToolsOptions,
): Promise<SetupMcpClientsAndToolsResult> {
  const mcpServers = options.mcpServers ?? [];
  const clientName = options.clientName ?? "local-mcp-client";
  const clientVersion = options.clientVersion ?? "1.0.0";

  const mcpClients: Client[] = [];
  const mcpTools: McpTool[] = [];
  const toolNameToClient = new Map<string, Client>();
  const toolNameToServer = new Map<string, MCPServerConfig>();

  try {
    for (const server of mcpServers) {
      const transport = createMcpTransport(server);

      const mcpClient = new Client(
        { name: clientName, version: clientVersion },
        { capabilities: {} },
      );

      await mcpClient.connect(transport, {});
      mcpClients.push(mcpClient);

      const toolsList = (await mcpClient.listTools()) as { tools: McpTool[] };
      const allTools = Array.isArray(toolsList?.tools) ? toolsList.tools : [];

      const allowedTools = allTools.filter((tool) => {
        // allowedTools 未指定なら全許可
        // Allow all when allowedTools is not specified
        if (!server.allowedTools) return true;
        return server.allowedTools.includes(tool.name);
      });

      for (const tool of allowedTools) {
        if (toolNameToClient.has(tool.name)) {
          throw new Error(`Tool name collision across MCP servers: ${tool.name}`);
        }
        toolNameToClient.set(tool.name, mcpClient);
        toolNameToServer.set(tool.name, server);
        mcpTools.push(tool);
      }
    }

    return { mcpClients, mcpTools, toolNameToClient, toolNameToServer };
  } catch (error) {
    await closeClientsQuietly(mcpClients);
    throw error;
  }
}
