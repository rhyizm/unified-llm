import { DeepSeekProvider } from '../src/providers/deepseek';
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';
import { ResponseFormat } from '../src/response-format';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('DeepSeek Tools Debug', () => {
  it('should debug if tools are being sent to DeepSeek API', async () => {
    
    // Use the base DeepSeek assistant directly
    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat',
      tools: [getAuthor],
    });

    const messages = [
      {
        id: 'test-1',
        role: 'user' as const,
        content: 'Who is the author of this project?',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat',
        generationConfig: {
          temperature: 0.7
        }
      });

      const contentString = JSON.stringify(response.message.content);

      expect(contentString).toContain('rhyizm');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }

  }, 30000);

  it('should use default args when not provided', async () => {
    
    // カスタム関数：デフォルト引数付き
    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      args: {
        city: 'Tokyo' // デフォルト値
      },
      handler: async (args: Record<string, any>) => {
        return `The author lives in ${args.city}`;
      }
    };

    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-2',
        role: 'user' as const,
        content: 'Where does the author live?',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat',
        generationConfig: {
          temperature: 0.7
        }
      });

      const contentString = JSON.stringify(response.message.content);

      expect(JSON.stringify(contentString)).toContain('Tokyo');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);

  it('should override default args when provided', async () => {
    
    // 同じ関数でデフォルト引数を上書き
    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name'
            }
          },
          required: []
        }
      },
      args: {
        city: 'Tokyo' // デフォルト値
      },
      handler: async (args: Record<string, any>) => {
        return `The author lives in ${args.city}`;
      }
    };

    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat',
      tools: [getAuthorResidence],
    });

    const messages = [
      {
        id: 'test-3',
        role: 'user' as const,
        content: 'Call getAuthorResidence with city "Osaka"',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat',
        generationConfig: {
          temperature: 0.7
        }
      });

      const contentString = JSON.stringify(response.message.content);

      expect(contentString).toContain('Osaka');

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 30000);

  it.skip('should generate structured output with defined schema', async () => {
    
    // Define schema for task planning
    const taskPlanningSchema = {
      type: 'object' as const,
      properties: {
        taskTitle: { type: 'string' as const },
        priority: { 
          type: 'string' as const,
          enum: ['high', 'medium', 'low']
        },
        estimatedHours: { type: 'number' as const },
        steps: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              stepNumber: { type: 'number' as const },
              description: { type: 'string' as const },
              duration: { type: 'number' as const }
            },
            required: ['stepNumber', 'description', 'duration'],
            additionalProperties: false
          }
        },
        requiredSkills: {
          type: 'array' as const,
          items: { type: 'string' as const }
        }
      },
      required: ['taskTitle', 'priority', 'estimatedHours', 'steps', 'requiredSkills'],
      additionalProperties: false
    };

    const responseFormat = new ResponseFormat({
      name: 'task_planning',
      description: 'Task planning breakdown',
      schema: taskPlanningSchema
    });

    const deepseek = new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-chat'
    });

    const messages = [
      {
        id: 'test-4',
        role: 'user' as const,
        content: 'Create a task plan for building a simple REST API with Node.js. It should be a medium priority task.',
        createdAt: new Date(),
      }
    ];

    try {
      const response = await deepseek.chat({
        messages,
        model: 'deepseek-chat',
        generationConfig: {
          temperature: 0.7,
          responseFormat: responseFormat
        }
      });

      // Parse the response content
      const content = response.message.content;
      let parsedContent: any;
      
      if (typeof content === 'string') {
        parsedContent = JSON.parse(content);
      } else if (Array.isArray(content) && content[0]?.type === 'text') {
        parsedContent = JSON.parse(content[0].text);
      }

      // Verify the response matches the schema
      expect(parsedContent).toHaveProperty('taskTitle');
      expect(parsedContent).toHaveProperty('priority');
      expect(parsedContent).toHaveProperty('estimatedHours');
      expect(parsedContent).toHaveProperty('steps');
      expect(parsedContent).toHaveProperty('requiredSkills');
      
      expect(typeof parsedContent.taskTitle).toBe('string');
      expect(['high', 'medium', 'low']).toContain(parsedContent.priority);
      expect(typeof parsedContent.estimatedHours).toBe('number');
      expect(Array.isArray(parsedContent.steps)).toBe(true);
      expect(Array.isArray(parsedContent.requiredSkills)).toBe(true);
      
      // Verify content includes expected information
      expect(parsedContent.taskTitle.toLowerCase()).toContain('api');
      expect(parsedContent.priority).toBe('medium');
      expect(parsedContent.estimatedHours).toBeGreaterThan(0);
      expect(parsedContent.steps.length).toBeGreaterThan(0);
      
      // Verify steps structure
      parsedContent.steps.forEach((step: any) => {
        expect(typeof step.stepNumber).toBe('number');
        expect(typeof step.description).toBe('string');
        expect(typeof step.duration).toBe('number');
      });
      
      // Verify required skills include relevant technologies
      expect(parsedContent.requiredSkills.some((skill: string) => 
        skill.toLowerCase().includes('node') || 
        skill.toLowerCase().includes('javascript') ||
        skill.toLowerCase().includes('api')
      )).toBe(true);

    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }, 60000);
});