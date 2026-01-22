import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { callGeminiAgent } from '../../src/providers/google/gemini-agent.js';
import type { OpenAiTool } from '../../src/utils/mcp/mcp-tool-catalog.js';
import type { LocalToolHandler } from '../../src/utils/tools/execute-tool-calls.js';

const apiKey = process.env.GOOGLE_API_KEY;
const playwrightMcpServerUrl = process.env.PLAYWRIGHT_MCP_SERVER_URL;

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';

const streamModes = [
  {
    label: 'json',
    model: 'gemini-3-flash-preview:generateContent',
    isStream: false,
  },
  {
    label: 'sse',
    model: 'gemini-3-flash-preview:streamGenerateContent?alt=sse',
    isStream: true,
  },
] as const;

const saveRecordTool: OpenAiTool = {
  type: 'function',
  name: 'save_record',
  description: 'Store a record in a mock database.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
};

const createDbHandler = (store: Array<{ key: string; value: string }>) => {
  const handler: LocalToolHandler = async (args) => {
    const key = String(args.key ?? '');
    const value = String(args.value ?? '');
    store.push({ key, value });
    return { ok: true, stored: { key, value } };
  };
  return handler;
};

const startTokenServer = async () => {
  const token = randomUUID();
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      [
        '<!doctype html>',
        '<html><head><title>MCP Token</title></head>',
        '<body>',
        `<p id=\"token\">${token}</p>`,
        '</body></html>',
      ].join(''),
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind local token server.');
  }

  return {
    token,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
};

const runIfApiKey = apiKey ? describe : describe.skip;

runIfApiKey('Gemini Agent (real API)', () => {
  streamModes.forEach(({ label, model, isStream }) => {
    describe(label, () => {
      it('handles a normal call', async () => {
        const response = await callGeminiAgent({
          endpoint,
          model,
          apiKey,
          baseInput: [
            {
              role: 'user',
              content: 'Say hello in one short sentence.',
            },
          ],
          isStream,
        });

        expect(typeof response.output).toBe('string');
        expect(String(response.output).length).toBeGreaterThan(0);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      }, 60000);

      it('handles a local tool call (mock DB save)', async () => {
        const db: Array<{ key: string; value: string }> = [];
        const handler = createDbHandler(db);

        const response = await callGeminiAgent({
          endpoint,
          model,
          apiKey,
          baseInput: [
            {
              role: 'user',
              content:
                'Use the save_record tool to store key="alpha" and value="bravo". After calling the tool, reply with "saved".',
            },
          ],
          localTools: {
            tools: [saveRecordTool],
            handlers: new Map<string, LocalToolHandler>([
              ['save_record', handler],
            ]),
          },
          isStream,
        });

        expect(db).toEqual([{ key: 'alpha', value: 'bravo' }]);
        expect(String(response.output).toLowerCase()).toContain('saved');
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      }, 60000);

      const runIfMcp = playwrightMcpServerUrl ? it : it.skip;

      runIfMcp('handles an MCP tool call', async () => {
        const server = await startTokenServer();
        try {
          const response = await callGeminiAgent({
            endpoint,
            model,
            apiKey,
            baseInput: [
              {
                role: 'user',
                content: [
                  'Use the MCP browser tools to open the page at this URL:',
                  server.url,
                  'Read the token text from the page and reply with the token only.',
                ].join(' '),
              },
            ],
            mcpServers: [
              {
                name: 'Playwright MCP',
                type: 'streamable_http',
                url: playwrightMcpServerUrl,
                allowedTools: [
                  'browser_install',
                  'browser_navigate',
                  'browser_snapshot',
                ],
              },
            ],
            isStream,
          });

          expect(String(response.output)).toBe(server.token);
          expect(response.usage.totalTokens).toBeGreaterThan(0);
        } finally {
          await server.close();
        }
      }, 60000);

      runIfMcp('handles local tools + MCP tools together', async () => {
        const db: Array<{ key: string; value: string }> = [];
        const handler = createDbHandler(db);
        const server = await startTokenServer();

        try {
          const response = await callGeminiAgent({
            endpoint,
            model,
            apiKey,
            baseInput: [
              {
                role: 'user',
                content: [
                  'Use MCP browser tools to open the page at this URL:',
                  server.url,
                  'Extract the token text from the page.',
                  'Then call save_record with key="mcp_uuid" and value set to that token.',
                  'Finally, reply with the token only.',
                ].join(' '),
              },
            ],
            localTools: {
              tools: [saveRecordTool],
              handlers: new Map<string, LocalToolHandler>([
                ['save_record', handler],
              ]),
            },
            mcpServers: [
              {
                name: 'Playwright MCP',
                type: 'streamable_http',
                url: playwrightMcpServerUrl,
                allowedTools: [
                  'browser_install',
                  'browser_navigate',
                  'browser_snapshot',
                ],
              },
            ],
            isStream,
          });

          expect(db.length).toBe(1);
          expect(db[0]?.key).toBe('mcp_uuid');
          expect(db[0]?.value).toBe(server.token);
          expect(String(response.output)).toBe(server.token);
          expect(response.usage.totalTokens).toBeGreaterThan(0);
        } finally {
          await server.close();
        }
      }, 60000);
    });
  });
});
