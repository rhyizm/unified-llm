/* tests/azureTools.spec.ts */
import dotenv from 'dotenv';
dotenv.config();

import { AzureOpenAIProvider } from '../src/providers/azure/provider';   // ← 変更①
import { getAuthor } from '../src/tools/getAuthor';
import { Tool } from '../src/types/unified-api';

/** 共通：Azure 接続情報（環境変数から） */
const azureAuth = {
  endpoint:     process.env.AZURE_OPENAI_ENDPOINT!,     // 例: https://my-rsc.openai.azure.com
  deployment:   process.env.AZURE_OPENAI_DEPLOYMENT!,   // 例: gpt4o-chat
  apiVersion:   process.env.AZURE_OPENAI_API_VERSION,   // 未設定ならクラス側で preview
  useV1:        true,                                   // /openai/v1 を使う
};

describe('Azure OpenAI Tools Debug', () => {

  it('should debug if tools are being sent to Azure OpenAI API', async () => {
    console.log('🔍 Debugging Azure tool sending...');

    const openai = new AzureOpenAIProvider(
      azureAuth,
      {
        apiKey: process.env.AZURE_OPENAI_KEY!,
        tools: [getAuthor]
      }
    );

    const messages = [{
      id: 'test-1',
      role: 'user' as const,
      content: 'Who is the author of this project?',
      created_at: new Date(),
    }];

    const resp = await openai.chat({ messages });

    const json = JSON.stringify(resp.message.content);
    console.log('📥 Response:\n', json);
    expect(json).toContain('rhyizm');
  }, 30000);

  it('should use default args when not provided', async () => {
    console.log('🔍 Testing default args...');

    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: [],
        },
      },
      args: { city: 'Tokyo' },
      handler: async ({ city }) => `The author lives in ${city}`,
    };

    const openai = new AzureOpenAIProvider(
      azureAuth,
      {
        apiKey: process.env.AZURE_OPENAI_KEY!,
        tools: [getAuthorResidence]
      }
    );

    const messages = [{
      id: 'test-2',
      role: 'user' as const,
      content: 'Call the getAuthorResidence function without any arguments to tell me where the author lives',
      created_at: new Date(),
    }];

    const resp = await openai.chat({ messages });
    const json = JSON.stringify(resp.message.content);
    console.log('📥 Response:\n', json);
    expect(json).toContain('Tokyo');
  }, 30000);

  it('should override default args when provided', async () => {
    console.log('🔍 Testing args override...');

    const getAuthorResidence: Tool = {
      type: 'function',
      function: {
        name: 'getAuthorResidence',
        description: 'Get the author residence',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: [],
        },
      },
      args: { city: 'Tokyo' },   // default
      handler: async ({ city }) => `The author lives in ${city}`,
    };

    const openai = new AzureOpenAIProvider(
      azureAuth,
      {
        apiKey: process.env.AZURE_OPENAI_KEY!,
        tools: [getAuthorResidence]
      }
    );

    const messages = [{
      id: 'test-3',
      role: 'user' as const,
      content: 'Call getAuthorResidence with city "Osaka"',
      created_at: new Date(),
    }];

    const resp = await openai.chat({ messages });
    const json = JSON.stringify(resp.message.content);
    console.log('📥 Response:\n', json);
    expect(json).toContain('Osaka');
  }, 30000);
});
