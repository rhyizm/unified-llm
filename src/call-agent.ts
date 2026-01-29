import { callResponsesApiAgent } from './providers/openai/responses-api-agent.js';
import { callGeminiAgent } from './providers/google/gemini-agent.js';
import type { AgentCallOptions } from './types/index.js';
import type { ProviderType } from './types/unified-api.js';

export type AgentProviderType = Extract<ProviderType, 'openai' | 'google'>;

export type CallAgentOptions = AgentCallOptions & {
  provider: AgentProviderType;
};

export async function callAgent(options: CallAgentOptions) {
  const { provider, ...rest } = options;

  switch (provider) {
    case 'openai':
      return callResponsesApiAgent(rest);
    case 'google':
      return callGeminiAgent(rest);
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unsupported provider for callAgent: ${exhaustiveCheck}`);
    }
  }
}
