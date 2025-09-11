import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/llm-client';
import { ResponseFormat } from '../../src/response-format';
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

describe('Structured Output E2E Tests', () => {
  const getTextFromContent = (content: Message['content']): string => {
    if (typeof content === 'string') return content;
    const firstText = content.find((c): c is TextContent => c.type === 'text');
    return firstText?.text ?? '';
  };

  providers.forEach(({ name, config }) => {
    const shouldSkip = !config.apiKey || (config.provider === 'azure' && (!config.endpoint || !config.deploymentName));
    
    describe.skipIf(shouldSkip)(`${name} Provider`, () => {
      let client: LLMClient;

      beforeAll(() => {
        client = new LLMClient(config);
      });

      it('should generate structured user profile', async () => {
        const userProfileSchema = {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const },
            age: { type: 'number' as const },
            email: { type: 'string' as const },
            interests: {
              type: 'array' as const,
              items: { type: 'string' as const }
            }
          },
          required: ['name', 'age', 'email', 'interests'],
          additionalProperties: false
        };

        const responseFormat = new ResponseFormat({
          name: 'user_profile',
          description: 'User profile information',
          schema: userProfileSchema
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Generate a user profile for a 25-year-old software developer named Alice who likes coding and reading'
            }
          ],
          generationConfig: {
            responseFormat: responseFormat
          }
        });

        const content = getTextFromContent(response.message.content);

        // Extract JSON from content (some providers may include extra text)
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          // Try to extract JSON from the content
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error(`Could not parse JSON from response: ${content.substring(0, 100)}`);
          }
        }
        
        expect(parsed).toHaveProperty('name');
        expect(parsed).toHaveProperty('age');
        expect(parsed).toHaveProperty('email');
        expect(parsed).toHaveProperty('interests');
        
        expect(typeof parsed.name).toBe('string');
        expect(typeof parsed.age).toBe('number');
        expect(typeof parsed.email).toBe('string');
        expect(Array.isArray(parsed.interests)).toBe(true);
        
        expect(parsed.name.toLowerCase()).toContain('alice');
        expect(parsed.age).toBe(25);
      }, 30000);

      it('should generate structured product listing', async () => {
        const productSchema = {
          type: 'object' as const,
          properties: {
            products: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  id: { type: 'number' as const },
                  name: { type: 'string' as const },
                  price: { type: 'number' as const },
                  inStock: { type: 'boolean' as const }
                },
                required: ['id', 'name', 'price', 'inStock']
              }
            },
            totalCount: { type: 'number' as const }
          },
          required: ['products', 'totalCount'],
          additionalProperties: false
        };

        const responseFormat = new ResponseFormat({
          name: 'product_listing',
          description: 'Product listing with inventory',
          schema: productSchema
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Generate a list of 3 electronic products with prices between $100 and $500'
            }
          ],
          generationConfig: {
            responseFormat: responseFormat
          }
        });

        const content = getTextFromContent(response.message.content);

        // Extract JSON from content (some providers may include extra text)
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          // Try to extract JSON from the content
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error(`Could not parse JSON from response: ${content.substring(0, 100)}`);
          }
        }
        
        expect(parsed).toHaveProperty('products');
        expect(parsed).toHaveProperty('totalCount');
        expect(Array.isArray(parsed.products)).toBe(true);
        expect(parsed.products.length).toBe(3);
        expect(parsed.totalCount).toBe(3);
        
        parsed.products.forEach((product: any) => {
          expect(product).toHaveProperty('id');
          expect(product).toHaveProperty('name');
          expect(product).toHaveProperty('price');
          expect(product).toHaveProperty('inStock');
          
          expect(typeof product.id).toBe('number');
          expect(typeof product.name).toBe('string');
          expect(typeof product.price).toBe('number');
          expect(typeof product.inStock).toBe('boolean');
          
          expect(product.price).toBeGreaterThanOrEqual(100);
          expect(product.price).toBeLessThanOrEqual(500);
        });
      }, 30000);

      it('should handle nested structured output', async () => {
        const companySchema = {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const },
            founded: { type: 'number' as const },
            headquarters: {
              type: 'object' as const,
              properties: {
                city: { type: 'string' as const },
                country: { type: 'string' as const }
              },
              required: ['city', 'country']
            },
            departments: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  name: { type: 'string' as const },
                  employeeCount: { type: 'number' as const }
                },
                required: ['name', 'employeeCount']
              }
            }
          },
          required: ['name', 'founded', 'headquarters', 'departments'],
          additionalProperties: false
        };

        const responseFormat = new ResponseFormat({
          name: 'company_info',
          description: 'Company organizational structure',
          schema: companySchema
        });

        const response = await client.chat({
          messages: [
            {
              role: 'user',
              content: 'Generate information for a tech company founded in 2010 with 3 departments'
            }
          ],
          generationConfig: {
            responseFormat: responseFormat
          }
        });

        const content = getTextFromContent(response.message.content);

        // Extract JSON from content (some providers may include extra text)
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          // Try to extract JSON from the content
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error(`Could not parse JSON from response: ${content.substring(0, 100)}`);
          }
        }
        
        expect(parsed).toHaveProperty('name');
        expect(parsed).toHaveProperty('founded');
        expect(parsed).toHaveProperty('headquarters');
        expect(parsed).toHaveProperty('departments');
        
        expect(parsed.founded).toBe(2010);
        expect(parsed.headquarters).toHaveProperty('city');
        expect(parsed.headquarters).toHaveProperty('country');
        expect(Array.isArray(parsed.departments)).toBe(true);
        expect(parsed.departments.length).toBe(3);
        
        parsed.departments.forEach((dept: any) => {
          expect(dept).toHaveProperty('name');
          expect(dept).toHaveProperty('employeeCount');
          expect(typeof dept.name).toBe('string');
          expect(typeof dept.employeeCount).toBe('number');
        });
      }, 30000);
    });
  });
});
