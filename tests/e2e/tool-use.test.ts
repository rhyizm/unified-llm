import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/llm-client';
import { Tool } from '../../src/types/unified-api';
import type { Message, TextContent } from '../../src/types/unified-api';
import dotenv from 'dotenv';

dotenv.config();

const providers = [
  { 
    name: 'OpenAI',
    config: {
      provider: 'openai' as const,
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-5-nano'
    }
  },
  {
    name: 'Anthropic',
    config: {
      provider: 'anthropic' as const,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-haiku-latest'
    }
  },
  {
    name: 'Google Gemini',
    config: {
      provider: 'google' as const,
      apiKey: process.env.GOOGLE_API_KEY,
      model: 'gemini-2.5-flash'
    }
  },
  {
    name: 'DeepSeek',
    config: {
      provider: 'deepseek' as const,
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat'
    }
  },
  {
    name: 'Azure OpenAI',
    config: {
      provider: 'azure' as const,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      model: 'gpt-4o-mini'
    }
  }
];

describe('Tool Use E2E Tests', () => {
  const getTextFromContent = (content: Message['content']): string => {
    if (typeof content === 'string') return content;
    const firstText = content.find((c): c is TextContent => c.type === 'text');
    return firstText?.text ?? '';
  };

  providers.forEach(({ name, config }) => {
    const shouldSkip = !config.apiKey || (config.provider === 'azure' && (!config.endpoint || !config.deploymentName));
    
    describe.skipIf(shouldSkip)(`${name} Provider`, () => {
      it('should call a simple tool', async () => {
        const getWeatherTool: Tool = {
          type: 'function',
          function: {
            name: 'getWeather',
            description: 'Get the weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The city name'
                }
              },
              required: ['location']
            }
          },
          handler: async (args: Record<string, any>) => {
            return `The weather in ${args.location} is sunny and 72°F`;
          }
        };

        const client = new LLMClient({
          ...config,
          tools: [getWeatherTool]
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'What is the weather in Tokyo?'
            }
          ]
        });

        const content = getTextFromContent(response.message.content);

        expect(content.toLowerCase()).toContain('tokyo');
        expect(content.toLowerCase()).toContain('sunny');
        expect(content).toContain('72');
      }, 30000);

      it('should handle multiple tool calls', async () => {
        const tools: Tool[] = [
          {
            type: 'function',
            function: {
              name: 'add',
              description: 'Add two numbers',
              parameters: {
                type: 'object',
                properties: {
                  a: { type: 'number' },
                  b: { type: 'number' }
                },
                required: ['a', 'b']
              }
            },
            handler: async (args: Record<string, any>) => {
              return (args.a + args.b).toString();
            }
          },
          {
            type: 'function',
            function: {
              name: 'multiply',
              description: 'Multiply two numbers',
              parameters: {
                type: 'object',
                properties: {
                  a: { type: 'number' },
                  b: { type: 'number' }
                },
                required: ['a', 'b']
              }
            },
            handler: async (args: Record<string, any>) => {
              return (args.a * args.b).toString();
            }
          }
        ];

        const client = new LLMClient({
          ...config,
          tools
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Calculate: (5 + 3) and (4 * 7). Tell me both results.'
            }
          ]
        });

        const content = getTextFromContent(response.message.content);

        expect(content).toContain('8');
        expect(content).toContain('28');
      }, 30000);

      it('should handle tools with default arguments', async () => {
        const greetingTool: Tool = {
          type: 'function',
          function: {
            name: 'greet',
            description: 'Generate a greeting',
            parameters: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name to greet'
                }
              },
              required: ['name']
            }
          },
          args: {
            language: 'English'
          },
          handler: async (args: Record<string, any>) => {
            const greetings: Record<string, string> = {
              'English': 'Hello',
              'Japanese': 'こんにちは',
              'Spanish': 'Hola'
            };
            return `${greetings[args.language] || 'Hello'}, ${args.name}!`;
          }
        };

        const client = new LLMClient({
          ...config,
          tools: [greetingTool]
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Greet Alice'
            }
          ]
        });

        const content = getTextFromContent(response.message.content);

        expect(content).toContain('Hello');
        expect(content).toContain('Alice');
      }, 30000);

      it('should stream tool calls', async () => {
        const calculateTool: Tool = {
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Perform a calculation',
            parameters: {
              type: 'object',
              properties: {
                expression: {
                  type: 'string',
                  description: 'Math expression to evaluate'
                }
              },
              required: ['expression']
            }
          },
          handler: async (args: Record<string, any>) => {
            const result = eval(args.expression);
            return `The result of ${args.expression} is ${result}`;
          }
        };

        const client = new LLMClient({
          ...config,
          tools: [calculateTool]
        });

        const chunks: any[] = [];
        
        for await (const chunk of client.stream({
          messages: [
            {
              role: 'user',
              content: 'Calculate 15 + 25'
            }
          ]
        })) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(0);
        
        let fullContent = '';
        for (const chunk of chunks) {
          if (chunk.message?.content) {
            fullContent += getTextFromContent(chunk.message.content);
          }
        }

        expect(fullContent).toContain('40');
      }, 30000);

      it('should handle tool errors gracefully', async () => {
        const errorTool: Tool = {
          type: 'function',
          function: {
            name: 'errorTool',
            description: 'A tool that throws an error',
            parameters: {
              type: 'object',
              properties: {
                message: { type: 'string' }
              },
              required: ['message']
            }
          },
          handler: async (args: Record<string, any>) => {
            throw new Error(`Tool error: ${args.message}`);
          }
        };

        const client = new LLMClient({
          ...config,
          tools: [errorTool]
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Use the errorTool with message "test error"'
            }
          ]
        });

        const content = getTextFromContent(response.message.content);

        expect(content.toLowerCase()).toContain('error');
      }, 30000);
    });
  });
});
