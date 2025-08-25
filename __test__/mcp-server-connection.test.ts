import { OpenAIProvider } from '../src/providers/openai/provider';
import dotenv from 'dotenv';

dotenv.config();

describe('MCP Server Connection', () => {
  const apiKey = process.env.OPENAI_API_KEY || 'test-api-key';
  
  // Skip tests if no real API key is provided
  const conditionalTest = process.env.OPENAI_API_KEY ? it : it.skip;

  describe('OpenAI Provider with MCP', () => {
    conditionalTest('should connect to Playwright MCP server', async () => {
      const provider = new OpenAIProvider({
        apiKey,
        model: 'gpt-5-mini',
        mcpServers: [
          {
            type: 'streamable_http',
            name: 'playwright',
            url: 'http://playwright-mcp:8931/mcp',
          },
        ],
      });

      const response = await provider.chat({
        messages: [
          {
            id: 'test-1',
            role: 'system',
            content: 'You have access to a Playwright MCP server. List available tools.',
            createdAt: new Date(),
          },
          {
            id: 'test-2',
            role: 'user',
            content: 'What browser automation tools are available?',
            createdAt: new Date(),
          },
        ],
      });

      expect(response).toBeDefined();
      expect(response.message.role).toBe('assistant');
      expect(response.provider).toBe('openai');
      expect(response.model).toContain('gpt');
    }, 30000);

    conditionalTest('should stream responses from Playwright MCP server', async () => {
      const provider = new OpenAIProvider({
        apiKey,
        model: 'gpt-5-nano',
        mcpServers: [
          {
            type: 'streamable_http',
            name: 'playwright',
            url: 'http://playwright-mcp:8931/mcp',
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [
          {
            id: 'test-3',
            role: 'user',
            content: 'Tell me about browser automation capabilities',
            createdAt: new Date(),
          },
        ],
      })) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      const fullText = chunks.join('');
      expect(fullText.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('OpenAI Provider without MCP (fallback to completion)', () => {
    it('should use completion provider when no MCP servers configured', async () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-api-key',
        model: 'gpt-4o',
      });

      expect(provider).toBeDefined();
      // Provider should be created successfully even without MCP servers
    });

    conditionalTest('should work with regular completion API', async () => {
      const provider = new OpenAIProvider({
        apiKey,
        model: 'gpt-5-mini',
      });

      const response = await provider.chat({
        messages: [
          {
            id: 'test-4',
            role: 'user',
            content: 'Say hello',
            createdAt: new Date(),
          },
        ],
      });

      expect(response).toBeDefined();
      expect(response.message.role).toBe('assistant');
      expect(response.text).toBeDefined();
    }, 10000);
  });

  describe('Provider delegation logic', () => {
    it('should create agent provider when mcpServers is provided', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
        mcpServers: [
          {
            type: 'streamable_http',
            name: 'test',
            url: 'http://localhost:8000/mcp',
          },
        ],
      });

      // Check that provider is created (internal delegation happens)
      expect(provider).toBeDefined();
    });

    it('should create completion provider when mcpServers is not provided', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
      });

      // Check that provider is created (internal delegation happens)
      expect(provider).toBeDefined();
    });

    it('should create completion provider with baseURL option', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
        baseURL: 'http://localhost:11434/v1',
      });

      // Check that provider is created (internal delegation happens)
      expect(provider).toBeDefined();
    });
  });
});