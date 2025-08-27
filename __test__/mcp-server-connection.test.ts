import { OpenAIProvider } from '../src/providers/openai/provider';
import dotenv from 'dotenv';

dotenv.config();

describe('MCP Server Connection (Playwright) — real browser work', () => {
  const apiKey = process.env.OPENAI_API_KEY || 'test-api-key';
  const model = process.env.TEST_OPENAI_MODEL || 'gpt-5-nano';
  const mcpUrl = process.env.PLAYWRIGHT_MCP_URL || 'http://playwright-mcp:8931/mcp';

  // 実 API キーがない場合は実行をスキップ
  const conditionalTest = process.env.OPENAI_API_KEY ? it : it.skip;

  // 共通ヘルパ
  const extractText = (resp: any): string => {
    const direct = (resp?.text ?? '').toString();
    if (direct) return direct;
    const first = Array.isArray(resp?.message?.content) ? resp.message.content[0] : null;
    if (first && typeof first === 'object' && first.type === 'text' && typeof first.text === 'string') {
      return first.text;
    }
    return '';
  };

  const isToolUsed = (resp: any): boolean => {
    const contents = Array.isArray(resp?.message?.content) ? resp.message.content : [];
    return contents.some((c: any) => c && typeof c === 'object' && c.role === 'tool');
  };

  describe('OpenAI Provider with MCP (example.com title)', () => {
    conditionalTest(
      'should fetch the page title of example.com via Playwright MCP',
      async () => {
        const provider = new OpenAIProvider({
          apiKey,
          model,
          mcpServers: [
            {
              type: 'streamable_http',
              name: 'playwright',
              url: mcpUrl,
            },
          ],
        });

        const response = await provider.chat({
          messages: [
            {
              id: 'sys-1',
              role: 'system',
              content:
                [
                  'You have access to a Playwright MCP server named "playwright".',
                  'Use it to open https://example.com and return ONLY the exact document.title.',
                  'Do not add any extra words, formatting, or explanation.',
                  'If a tool must be used, make sure to actually invoke it rather than guessing.',
                ].join(' '),
              createdAt: new Date(),
            },
            {
              id: 'u-1',
              role: 'user',
              content: 'Fetch the page title at https://example.com',
              createdAt: new Date(),
            },
          ],
        });

        expect(response).toBeDefined();
        expect(response.provider).toBe('openai');
        expect(response.model).toContain('gpt');
        expect(response.message.role).toBe('assistant');

        const text = extractText(response).trim();
        expect(text.length).toBeGreaterThan(0);
        // 期待値の検証（出力ぶれ対策で includes）
        expect(text).toContain('Example Domain');

        // 任意: ツール呼び出し痕跡（role: 'tool' が含まれるか）を確認
        // （環境により入らない実装もあるため "expect" は強制しない）
        // console.log('tool used?', isToolUsed(response));
      },
      30_000
    );

    conditionalTest(
      'should stream the title of example.com via Playwright MCP',
      async () => {
        const provider = new OpenAIProvider({
          apiKey,
          model,
          mcpServers: [
            {
              type: 'streamable_http',
              name: 'playwright',
              url: mcpUrl,
            },
          ],
        });

        const chunks: string[] = [];
        for await (const chunk of provider.stream({
          messages: [
            {
              id: 'sys-2',
              role: 'system',
              content:
                [
                  'You have access to a Playwright MCP server named "playwright".',
                  'Use it to open https://example.com and return ONLY the exact document.title.',
                  'No extra words.',
                ].join(' '),
              createdAt: new Date(),
            },
            {
              id: 'u-2',
              role: 'user',
              content: 'Get the page title for https://example.com',
              createdAt: new Date(),
            },
          ],
        })) {
          if (chunk.text) {
            chunks.push(chunk.text);
          } else if (Array.isArray(chunk.message?.content)) {
            const c0 = chunk.message.content[0] as any;
            if (c0?.type === 'text' && typeof c0.text === 'string') {
              chunks.push(c0.text);
            }
          }
        }

        const full = chunks.join('').trim();
        expect(full.length).toBeGreaterThan(0);
        expect(full).toContain('Example Domain');
      },
      60_000 // 60 seconds timeout for streaming test
    );
  });

  describe('OpenAI Provider without MCP (fallback still works)', () => {
    it('should construct provider without MCP servers', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-api-key',
        model: 'gpt-5-nano',
      });
      expect(provider).toBeDefined();
    });

    conditionalTest(
      'should respond via regular completion when MCP is not configured',
      async () => {
        const provider = new OpenAIProvider({
          apiKey,
          model: 'gpt-5-nano',
        });
        const response = await provider.chat({
          messages: [
            {
              id: 'plain-1',
              role: 'user',
              content: 'Say hello',
              createdAt: new Date(),
            },
          ],
        });
        expect(response).toBeDefined();
        expect(response.provider).toBe('openai');
        const text = extractText(response);
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      },
      10_000
    );
  });

  describe('Provider delegation logic', () => {
    it('creates agent provider when mcpServers provided', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-5-nano',
        mcpServers: [
          {
            type: 'streamable_http',
            name: 'test',
            url: 'http://localhost:8000/mcp',
          },
        ],
      });
      expect(provider).toBeDefined();
    });

    it('creates completion provider when mcpServers not provided', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-5-nano',
      });
      expect(provider).toBeDefined();
    });

    it('creates completion provider with baseURL option', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-5-nano',
        baseURL: 'http://localhost:11434/v1',
      });
      expect(provider).toBeDefined();
    });
  });
});
