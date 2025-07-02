import { LLMClient, LLMClientConfig } from './llm-client';
import { clientRepository, ClientRepository } from './database/client-repository';

/**
 * ClientManager provides methods to manage LLMClient configurations,
 */
export class ClientManager {
  /**
   * Create a new LLMClient configuration
   */
  static async create(config: Omit<LLMClientConfig, 'id'>): Promise<string> {
    return await LLMClient.save(config as LLMClientConfig);
  }

  /**
   * Create a new LLMClient configuration preset
   */
  static async createPreset(preset: PresetName, customConfig?: Partial<LLMClientConfig>): Promise<string> {
    const presetConfig = CLIENT_PRESETS[preset];
    if (!presetConfig) {
      throw new Error(`Unknown preset: ${preset}`);
    }

    const config: LLMClientConfig = {
      ...presetConfig,
      ...customConfig,
      name: customConfig?.name || presetConfig.name,
    };

    return await LLMClient.save(config);
  }

  /**
   * Clone an existing LLMClient configuration
   */
  static async clone(sourceId: string, newName: string, updates?: Partial<LLMClientConfig>): Promise<string> {
    const sourceConfig = await LLMClient.getConfig(sourceId);
    if (!sourceConfig) {
      throw new Error(`LLMClient ${sourceId} not found`);
    }

    const clonedConfig: LLMClientConfig = {
      ...sourceConfig,
      ...updates,
      id: undefined, // Generate new ID
      name: newName,
    };

    return await LLMClient.save(clonedConfig);
  }

  /**
   * Import an LLMClient configuration from JSON
   */
  static async import(configJson: string): Promise<string> {
    try {
      const config = JSON.parse(configJson) as LLMClientConfig;
      
      // IDがある場合は削除（新しいIDを生成）
      if (config.id) {
        delete config.id;
      }

      return await LLMClient.save(config);
    } catch (error) {
      throw new Error(`Failed to import agent configuration: ${error}`);
    }
  }

  /**
   * Export an LLMClient configuration to JSON
   */
  static async export(id: string): Promise<string> {
    const config = await LLMClient.getConfig(id);
    if (!config) {
      throw new Error(`LLMClient ${id} not found`);
    }

    // APIキーは除外してエクスポート
    const exportConfig = { ...config };
    delete exportConfig.apiKey;

    return JSON.stringify(exportConfig, null, 2);
  }

  /**
   * Search for LLMClients based on various criteria
   */
  static async search(query: {
    name?: string;
    provider?: 'openai' | 'anthropic' | 'google' | 'deepseek';
    tags?: string[];
    model?: string;
  }): Promise<LLMClientConfig[]> {
    let results = await LLMClient.list();

    if (query.name) {
      const stored = await clientRepository.findByName(query.name);
      results = stored.map(s => ClientRepository.toConfig(s));
    }

    if (query.provider) {
      results = results.filter(a => a.provider === query.provider);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(a => 
        a.tags && query.tags && query.tags.some(tag => a.tags ? a.tags.includes(tag) : false)
      );
    }

    if (query.model) {
      results = results.filter(a => a.model === query.model);
    }

    return results;
  }

  /**
   * Batch operations for creating, updating, deleting, activating, or deactivating LLMClients
   */
  static async batch(operations: BatchOperation[]): Promise<BatchResult[]> {
    const results: BatchResult[] = [];

    for (const op of operations) {
      try {
        let result: any;
        
        switch (op.type) {
          case 'create':
            if (!op.config) throw new Error('Config required for create operation');
            result = await LLMClient.save(op.config);
            break;
          case 'update':
            if (!op.id || !op.updates) throw new Error('ID and updates required for update operation');
            result = await LLMClient.update(op.id, op.updates);
            break;
          case 'delete':
            if (!op.id) throw new Error('ID required for delete operation');
            result = await LLMClient.delete(op.id);
            break;
          case 'activate':
            if (!op.id) throw new Error('ID required for activate operation');
            result = await LLMClient.update(op.id, { isActive: true });
            break;
          case 'deactivate':
            if (!op.id) throw new Error('ID required for deactivate operation');
            result = await LLMClient.update(op.id, { isActive: false });
            break;
          default:
            throw new Error(`Unknown operation type: ${(op as any).type}`);
        }

        results.push({
          operation: op,
          success: true,
          result
        });
      } catch (error) {
        results.push({
          operation: op,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  /**
   * Get statistics about LLMClients
   */
  static async getStats(): Promise<ClientStats> {
    const all = await LLMClient.list({ includeInactive: true });
    const active = all.filter(a => a.isActive !== false);

    const byProvider = all.reduce((acc, a) => {
      acc[a.provider] = (acc[a.provider] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const allTags = all
      .flatMap(a => a.tags || [])
      .reduce((acc, tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return {
      total: all.length,
      active: active.length,
      inactive: all.length - active.length,
      byProvider,
      popularTags: Object.entries(allTags)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count })),
      recentlyUpdated: all
        .filter(a => a.updatedAt)
        .sort((a, b) => {
          const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, 5)
        .map(a => ({ id: a.id || '', name: a.name, updatedAt: a.updatedAt }))
    };
  }
}

export type PresetName = 
  | 'coding-agent'
  | 'creative-writer'
  | 'data-analyst'
  | 'translator'
  | 'customer-support'
  | 'research-agent';

export const CLIENT_PRESETS: Record<PresetName, Omit<LLMClientConfig, 'id'>> = {
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

export interface BatchOperation {
  type: 'create' | 'update' | 'delete' | 'activate' | 'deactivate';
  id?: string;
  config?: LLMClientConfig;
  updates?: Partial<LLMClientConfig>;
}

export interface BatchResult {
  operation: BatchOperation;
  success: boolean;
  result?: any;
  error?: string;
}

export interface ClientStats {
  total: number;
  active: number;
  inactive: number;
  byProvider: Record<string, number>;
  popularTags: { tag: string; count: number }[];
  recentlyUpdated: { id: string; name: string; updatedAt?: Date }[];
}