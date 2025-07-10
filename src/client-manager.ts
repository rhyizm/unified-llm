import { LLMClient, LLMClientConfig } from './llm-client';
import { Tool } from './types/unified-api';
import tools from './tools';

/**
 * ClientManager provides preset configurations for LLMClients.
 * Note: v0.4.0 removed persistence support - this is now in-memory only.
 */
export class ClientManager {
  /**
   * Create a new LLMClient from a preset configuration
   */
  static createFromPreset(preset: PresetName, apiKey: string, customConfig?: Partial<LLMClientConfig>): LLMClient {
    const presetConfig = CLIENT_PRESETS[preset];
    if (!presetConfig) {
      throw new Error(`Unknown preset: ${preset}`);
    }

    // Convert tool names to actual Tool objects
    const resolvedTools: Tool[] | undefined = presetConfig.tools?.map(toolName => {
      const tool = tools.find(t => t.function.name === toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }
      return tool;
    });

    // Remove preset-specific fields when creating LLMClientConfig
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name, description, instructions, tags, tools: _, ...baseConfig } = presetConfig;

    const config: LLMClientConfig = {
      ...baseConfig,
      ...customConfig,
      apiKey: customConfig?.apiKey || apiKey,
      tools: customConfig?.tools || resolvedTools,
    };

    return new LLMClient(config);
  }

  /**
   * Get available preset names
   */
  static getPresetNames(): PresetName[] {
    return Object.keys(CLIENT_PRESETS) as PresetName[];
  }

  /**
   * Get preset configuration
   */
  static getPreset(preset: PresetName): PresetConfig | undefined {
    return CLIENT_PRESETS[preset];
  }
}

export type PresetName = 
  | 'coding-agent'
  | 'creative-writer'
  | 'data-analyst'
  | 'translator'
  | 'customer-support'
  | 'research-agent';

// Preset configuration with extra metadata
export interface PresetConfig extends Omit<LLMClientConfig, 'id' | 'apiKey' | 'tools'> {
  name: string;
  description: string;
  instructions?: string;
  tags?: string[];
  tools?: string[];
}

export const CLIENT_PRESETS: Record<PresetName, PresetConfig> = {
  'coding-agent': {
    name: 'Coding Assistant',
    description: 'Helps with programming tasks, code review, and debugging',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    systemPrompt: 'You are a helpful coding agent. Provide clear, well-commented code examples and explain your reasoning.',
    instructions: 'Focus on code quality, best practices, and security. Always explain your solutions.',
    generationConfig: {
      temperature: 0.1,
      max_tokens: 2000,
    },
    tools: ['cat', 'tree', 'getProjectInfo'],
    tags: ['coding', 'development', 'programming'],
  },
  'creative-writer': {
    name: 'Creative Writer',
    description: 'Assists with creative writing, storytelling, and content creation',
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    systemPrompt: 'You are a creative writing agent. Help users craft engaging stories, poems, and creative content.',
    instructions: 'Be imaginative, encourage creativity, and provide constructive feedback on writing.',
    generationConfig: {
      temperature: 0.8,
      max_tokens: 4000,
    },
    tags: ['writing', 'creative', 'content'],
  },
  'data-analyst': {
    name: 'Data Analyst',
    description: 'Helps with data analysis, statistics, and insights',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a data analyst. Help users understand data, create visualizations, and derive insights.',
    instructions: 'Focus on accuracy, provide step-by-step analysis, and suggest actionable insights.',
    generationConfig: {
      temperature: 0.2,
      max_tokens: 3000,
    },
    tools: ['getCurrentTime', 'getProjectInfo'],
    tags: ['data', 'analysis', 'statistics'],
  },
  'translator': {
    name: 'Translator',
    description: 'Provides accurate translations between languages',
    provider: 'google',
    model: 'gemini-1.5-pro',
    systemPrompt: 'You are a professional translator. Provide accurate, natural translations while preserving meaning and context.',
    instructions: 'Consider cultural nuances, provide alternative translations when appropriate.',
    generationConfig: {
      temperature: 0.3,
      max_tokens: 2000,
    },
    tags: ['translation', 'language', 'localization'],
  },
  'customer-support': {
    name: 'Customer Support',
    description: 'Provides helpful customer service responses',
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    systemPrompt: 'You are a friendly customer support representative. Be helpful, empathetic, and solution-focused.',
    instructions: 'Always be polite, acknowledge concerns, and provide clear next steps.',
    generationConfig: {
      temperature: 0.4,
      max_tokens: 1000,
    },
    tags: ['support', 'customer-service', 'help'],
  },
  'research-agent': {
    name: 'Research Assistant',
    description: 'Helps with research, fact-checking, and information gathering',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a research agent. Help users find accurate information, cite sources, and organize research.',
    instructions: 'Be thorough, fact-check information, and provide credible sources when possible.',
    generationConfig: {
      temperature: 0.2,
      max_tokens: 3000,
    },
    tools: ['getCurrentTime'],
    tags: ['research', 'information', 'analysis'],
  },
};

// Removed interfaces: BatchOperation, BatchResult, ClientStats
// These were part of the persistence layer that has been removed in v0.4.0