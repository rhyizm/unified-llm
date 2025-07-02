import { DeepSeekProvider } from '../src/providers/deepseek';
import { UnifiedChatRequest, UnifiedChatResponse } from '../src/types/unified-api';

// Mock fetch globally
global.fetch = jest.fn();

describe('DeepSeekProvider', () => {
  let assistant: DeepSeekProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    assistant = new DeepSeekProvider({ 
      apiKey: mockApiKey, 
      model: 'deepseek-chat' 
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default model', () => {
      const defaultAssistant = new DeepSeekProvider({ apiKey: 'test-key' });
      expect(defaultAssistant).toBeInstanceOf(DeepSeekProvider);
      expect(defaultAssistant.modelName).toBe('deepseek-chat');
    });

    it('should initialize with custom model', () => {
      const customAssistant = new DeepSeekProvider({ 
        apiKey: 'test-key', 
        model: 'deepseek-coder' 
      });
      expect(customAssistant).toBeInstanceOf(DeepSeekProvider);
      expect(customAssistant.modelName).toBe('deepseek-coder');
    });
  });

  describe('chat', () => {
    it('should handle simple text message', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you today?'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 12,
          total_tokens: 21
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: '1',
            role: 'user',
            content: [{ type: 'text', text: 'Hello, world!' }],
            created_at: new Date()
          }
        ],
        model: 'deepseek-chat'
      };

      const response = await assistant.chat(request);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mockApiKey}`
          }
        })
      );

      expect(response).toMatchObject({
        id: 'chatcmpl-123',
        model: 'deepseek-chat',
        provider: 'deepseek',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help you today?' }]
        },
        usage: {
          input_tokens: 9,
          output_tokens: 12,
          total_tokens: 21
        },
        finish_reason: 'stop'
      });
    });

    it('should handle error responses', async () => {
      const mockError = {
        error: {
          message: 'Invalid API key',
          code: 'invalid_api_key'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => mockError
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: '1',
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
            created_at: new Date()
          }
        ],
        model: 'deepseek-chat'
      };

      await expect(assistant.chat(request)).rejects.toMatchObject({
        code: 'deepseek_error',
        message: 'Invalid API key',
        type: 'api_error',
        provider: 'deepseek'
      });
    });

    it('should handle multimodal content', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'I can see the image you shared.'
            },
            finish_reason: 'stop'
          }
        ]
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: '1',
            role: 'user',
            content: [
              { type: 'text', text: 'What do you see in this image?' },
              { 
                type: 'image', 
                source: { 
                  type: 'base64', 
                  media_type: 'image/jpeg',
                  data: 'base64encodedimage' 
                } 
              }
            ],
            created_at: new Date()
          }
        ],
        model: 'deepseek-chat'
      };

      const response = await assistant.chat(request);

      expect(response.message.content).toContainEqual({
        type: 'text',
        text: 'I can see the image you shared.'
      });
    });
  });

  describe('stream', () => {
    it('should handle streaming responses', async () => {
      const mockStreamData = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: [DONE]

`;

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(mockStreamData));
          controller.close();
        }
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        body: mockStream
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: '1',
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
            created_at: new Date()
          }
        ],
        model: 'deepseek-chat'
      };

      const chunks: UnifiedChatResponse[] = [];
      for await (const chunk of assistant.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        provider: 'deepseek',
        message: {
          content: [{ type: 'text', text: 'Hello' }]
        }
      });
    });

    it('should handle streaming errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'API Error' } })
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            id: '1',
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
            created_at: new Date()
          }
        ],
        model: 'deepseek-chat'
      };

      await expect(async () => {
        const streamGenerator = assistant.stream(request);
        await streamGenerator.next();
      }).rejects.toMatchObject({
        message: 'API Error',
        provider: 'deepseek'
      });
    });
  });
});
