import { desc, eq, like } from 'drizzle-orm';
import { getDatabase } from './connection';
import {
  llmClients,
  threadParticipants,
  messages,
  StoredLLMClient,
  NewStoredLLMClient,
  LLMClientConfig,
} from './schema';
import { randomUUID } from 'crypto';

export class ClientRepository {
  private async getDb() {
    return await getDatabase();
  }

  private async isDisabled() {
    return (await this.getDb()) === null;
  }

  /* ────────────────────────────────
       CRUD
  ──────────────────────────────── */
  /** Save or update LLM client configuration. */
  async save(config: LLMClientConfig): Promise<StoredLLMClient> {
    if (await this.isDisabled()) {
      // 永続化オフ時はメモリ上で完結
      const now = new Date();
      return {
        id: config.id || `asst_${randomUUID()}`,
        createdAt: now,
        updatedAt: now,
        isActive: config.isActive ?? true,
        name: config.name,
        provider: config.provider,
        description: config.description ?? null,
        model: config.model ?? null,
        systemPrompt: config.systemPrompt ?? null,
        instructions: config.instructions ?? null,
        apiKey: config.apiKey ?? null,
        generationConfig: config.generationConfig
          ? JSON.stringify(config.generationConfig)
          : null,
        tools: config.tools ? JSON.stringify(config.tools) : null,
        argumentMap: config.argumentMap
          ? JSON.stringify(config.argumentMap)
          : null,
        tags: config.tags ? JSON.stringify(config.tags) : null,
        metadata: config.metadata ? JSON.stringify(config.metadata) : null,
      };
    }

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const now = new Date();
    const id = config.id || `asst_${randomUUID()}`;

    const newClient: NewStoredLLMClient = {
      id,
      name: config.name,
      description: config.description,
      provider: config.provider,
      model: config.model,
      systemPrompt: config.systemPrompt,
      instructions: config.instructions,
      apiKey: config.apiKey,
      generationConfig: config.generationConfig
        ? JSON.stringify(config.generationConfig)
        : null,
      tools: config.tools ? JSON.stringify(config.tools) : null,
      argumentMap: config.argumentMap
        ? JSON.stringify(config.argumentMap)
        : null,
      tags: config.tags ? JSON.stringify(config.tags) : null,
      isActive: config.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      metadata: config.metadata ? JSON.stringify(config.metadata) : null,
    };

    const existing = await this.findById(id);

    if (existing) {
      await db
        .update(llmClients)
        .set({ ...newClient, createdAt: existing.createdAt })
        .where(eq(llmClients.id, id))
        .run();
    } else {
      await db.insert(llmClients).values(newClient).run();
    }

    return (await this.findById(id)) as StoredLLMClient;
  }

  /** Retrieve by ID */
  async findById(id: string): Promise<StoredLLMClient | null> {
    if (await this.isDisabled()) return null;

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const result = await db
      .select()
      .from(llmClients)
      .where(eq(llmClients.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /** 名前検索 */
  async findByName(name: string): Promise<StoredLLMClient[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    return await db
      .select()
      .from(llmClients)
      .where(like(llmClients.name, `%${name}%`))
      .orderBy(desc(llmClients.updatedAt));
  }

  /** プロバイダー検索 */
  async findByProvider(
    provider: 'openai' | 'anthropic' | 'google' | 'deepseek',
  ): Promise<StoredLLMClient[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    return await db
      .select()
      .from(llmClients)
      .where(eq(llmClients.provider, provider))
      .orderBy(desc(llmClients.updatedAt));
  }

  /** タグ検索 */
  async findByTags(tags: string[]): Promise<StoredLLMClient[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const all = await db.select().from(llmClients);

    return all
      .filter((c) => {
        if (!c.tags) return false;
        const arr = JSON.parse(c.tags as string) as string[];
        return tags.some((t) => arr.includes(t));
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /** 一覧取得（非アクティブ含むか） */
  async findAll(includeInactive = false): Promise<StoredLLMClient[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const q = db.select().from(llmClients);
    if (!includeInactive) q.where(eq(llmClients.isActive, true));
    return await q.orderBy(desc(llmClients.updatedAt));
  }

  /** 論理削除 */
  async delete(id: string): Promise<boolean> {
    if (await this.isDisabled()) return false;

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const res = await db
      .update(llmClients)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(llmClients.id, id))
      .run();

    const affected =
      typeof res.rowsAffected === 'bigint'
        ? Number(res.rowsAffected)
        : res.rowsAffected ?? 0;

    return affected > 0;
  }

  /** 物理削除 */
  async hardDelete(id: string): Promise<boolean> {
    if (await this.isDisabled()) return false;

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    // 参照削除 → messages の client_id を null → 本体削除
    await db.delete(threadParticipants).where(eq(threadParticipants.clientId, id)).run();

    await db
      .update(messages)
      .set({ clientId: null })
      .where(eq(messages.clientId, id))
      .run();

    const res = await db.delete(llmClients).where(eq(llmClients.id, id)).run();

    const affected =
      typeof res.rowsAffected === 'bigint'
        ? Number(res.rowsAffected)
        : res.rowsAffected ?? 0;

    return affected > 0;
  }

  /* ────────────────────────────────
       Utility
  ──────────────────────────────── */
  static toConfig(stored: StoredLLMClient): LLMClientConfig {
    return {
      id: stored.id,
      name: stored.name,
      description: stored.description ?? undefined,
      provider: stored.provider as 'openai' | 'anthropic' | 'google' | 'deepseek',
      model: stored.model ?? undefined,
      systemPrompt: stored.systemPrompt ?? undefined,
      instructions: stored.instructions ?? undefined,
      apiKey: stored.apiKey ?? undefined,
      generationConfig: stored.generationConfig
        ? JSON.parse(stored.generationConfig as string)
        : undefined,
      tools: stored.tools ? JSON.parse(stored.tools as string) : undefined,
      argumentMap: stored.argumentMap
        ? JSON.parse(stored.argumentMap as string)
        : undefined,
      tags: stored.tags ? JSON.parse(stored.tags as string) : undefined,
      isActive: stored.isActive ?? undefined,
      metadata: stored.metadata ? JSON.parse(stored.metadata as string) : undefined,
    };
  }

  static validateConfig(
    config: LLMClientConfig,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.name?.trim()) errors.push('Name is required');

    if (!config.provider) {
      errors.push('Provider is required');
    } else if (!['openai', 'anthropic', 'google', 'deepseek'].includes(config.provider)) {
      errors.push('Provider must be one of: openai, anthropic, google, deepseek');
    }

    const gen = config.generationConfig;
    if (gen) {
      if (gen.temperature !== undefined && (gen.temperature < 0 || gen.temperature > 2))
        errors.push('Temperature must be between 0 and 2');

      if (gen.max_tokens !== undefined && gen.max_tokens <= 0)
        errors.push('Max tokens must be greater than 0');

      if (gen.top_p !== undefined && (gen.top_p < 0 || gen.top_p > 1))
        errors.push('Top P must be between 0 and 1');
    }

    return { valid: errors.length === 0, errors };
  }
}

/* シングルトン */
export const clientRepository = new ClientRepository();
