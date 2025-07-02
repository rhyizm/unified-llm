import {
  eq,
  desc,
  and,
  asc,
  isNull,
  sql,
} from 'drizzle-orm';
import { getDatabase } from './connection';
import {
  threads,
  threadParticipants,
  messages as messagesTable,
  llmClients,
  type Thread,
  type NewThread,
  type ThreadParticipant,
  type NewThreadParticipant,
  type Message,
  type NewMessage,
  type StoredLLMClient,
} from './schema';
import type {
  Message as UnifiedMessage,
  ConversationThread,
} from '../types/unified-api';
import { v4 as uuidv4 } from 'uuid';

export interface ThreadConfig {
  dbPath?: string;
  autoSave?: boolean;
  threadId?: string;
  title?: string;
  description?: string;
  createdBy?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface JoinThreadOptions {
  role?: 'moderator' | 'participant' | 'observer';
  nickname?: string;
  metadata?: Record<string, any>;
}

export interface ThreadSummary {
  id: string;
  title?: string;
  description?: string;
  messageCount: number;
  participantCount: number;
  lastActivity: Date;
  activeParticipants: string[];
  tags?: string[];
}

export class ThreadRepository {
  /** 非同期 DB 取得プロミス */
  private dbPromise;
  constructor(dbPath?: string) {
    this.dbPromise = getDatabase(dbPath); // Promise<LibSQLDatabase | null>
  }

  /* ────────────── ヘルパ ────────────── */
  private async getDb() {
    return await this.dbPromise;
  }
  private async isDisabled() {
    return (await this.getDb()) === null;
  }

  /* ========== スレッド管理 ========== */

  /** 新規作成 */
  async createThread(config: ThreadConfig = {}): Promise<Thread> {
    const now = new Date();
    const newThread: NewThread = {
      id: config.threadId ?? `thread_${uuidv4()}`,
      title: config.title,
      description: config.description,
      createdAt: now,
      updatedAt: now,
      createdBy: config.createdBy,
      isActive: true,
      tags: config.tags ? JSON.stringify(config.tags) : null,
      metadata: config.metadata ? JSON.stringify(config.metadata) : null,
    };

    if (await this.isDisabled()) {
      return {
        ...newThread,
        title: newThread.title ?? null,
        description: newThread.description ?? null,
        createdBy: newThread.createdBy ?? null,
        tags: newThread.tags ?? null,
        metadata: newThread.metadata ?? null,
        isActive: newThread.isActive ?? null,
      };
    }

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const [thread] = await db.insert(threads).values(newThread).returning();
    return thread;
  }

  /** 取得 */
  async getThread(threadId: string): Promise<Thread | null> {
    if (await this.isDisabled()) return null;
    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const [thread] = await db
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.isActive, true)));
    return thread ?? null;
  }

  /** 更新 */
  async updateThread(
    threadId: string,
    updates: Partial<
      Pick<Thread, 'title' | 'description' | 'tags' | 'metadata'>
    >,
  ): Promise<Thread | null> {
    if (await this.isDisabled()) return null;

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const updateData: any = { ...updates, updatedAt: new Date() };
    if (updates.tags) updateData.tags = JSON.stringify(updates.tags);
    if (updates.metadata) updateData.metadata = JSON.stringify(updates.metadata);

    const [updated] = await db
      .update(threads)
      .set(updateData)
      .where(eq(threads.id, threadId))
      .returning();
    return updated ?? null;
  }

  /** 論理削除 */
  async deleteThread(threadId: string): Promise<boolean> {
    if (await this.isDisabled()) return false;

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const res = await db
      .update(threads)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(threads.id, threadId))
      .run();

    const affected =
      typeof res.rowsAffected === 'bigint'
        ? Number(res.rowsAffected)
        : res.rowsAffected ?? 0;
    return affected > 0;
  }

  /** スレッド一覧 */
  async listThreads(options?: {
    limit?: number;
    offset?: number;
    tags?: string[];
    createdBy?: string;
  }): Promise<ThreadSummary[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [eq(threads.isActive, true)];
    if (options?.createdBy) conditions.push(eq(threads.createdBy, options.createdBy));

    const base = await db
      .select({
        id: threads.id,
        title: threads.title,
        description: threads.description,
        updatedAt: threads.updatedAt,
        tags: threads.tags,
        messageCount: sql<number>`count(distinct ${messagesTable.id})`,
      })
      .from(threads)
      .leftJoin(messagesTable, eq(messagesTable.threadId, threads.id))
      .where(and(...conditions))
      .groupBy(threads.id)
      .orderBy(desc(threads.updatedAt))
      .limit(limit)
      .offset(offset);

    const summaries: ThreadSummary[] = [];
    for (const row of base) {
      const participants = await this.getActiveParticipants(row.id);
      summaries.push({
        id: row.id,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        messageCount: row.messageCount ?? 0,
        participantCount: participants.length,
        lastActivity: row.updatedAt,
        activeParticipants: participants.map((p) => p.clientId),
        tags: row.tags ? JSON.parse(row.tags as string) : undefined,
      });
    }

    if (options?.tags?.length) {
      return summaries.filter((s) =>
        s.tags?.some((t) => options.tags?.includes(t) ?? false),
      );
    }
    return summaries;
  }

  /* ========== 参加者管理 ========== */

  /** 参加 */
  async joinThread(
    threadId: string,
    clientId: string,
    options: JoinThreadOptions = {},
  ): Promise<ThreadParticipant> {
    const now = new Date();
    const newP: NewThreadParticipant = {
      id: `participant_${uuidv4()}`,
      threadId,
      clientId,
      joinedAt: now,
      leftAt: null,
      role: options.role ?? 'participant',
      nickname: options.nickname,
      metadata: options.metadata ? JSON.stringify(options.metadata) : null,
    };

    if (await this.isDisabled()) {
      return {
        ...newP,
        nickname: newP.nickname ?? null,
        metadata: newP.metadata ?? null,
        role: newP.role ?? null,
        leftAt: newP.leftAt ?? null,
      };
    }

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const existing = await db
      .select()
      .from(threadParticipants)
      .where(
        and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.clientId, clientId),
          isNull(threadParticipants.leftAt),
        ),
      );
    if (existing.length) {
      throw new Error(
        `LLMClient ${clientId} is already participating in thread ${threadId}`,
      );
    }

    const [participant] = await db
      .insert(threadParticipants)
      .values(newP)
      .returning();

    await db
      .update(threads)
      .set({ updatedAt: now })
      .where(eq(threads.id, threadId))
      .run();

    return participant;
  }

  /** 離脱 */
  async leaveThread(threadId: string, clientId: string): Promise<boolean> {
    if (await this.isDisabled()) return false;

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const now = new Date();
    const res = await db
      .update(threadParticipants)
      .set({ leftAt: now })
      .where(
        and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.clientId, clientId),
          isNull(threadParticipants.leftAt),
        ),
      )
      .run();

    const affected =
      typeof res.rowsAffected === 'bigint'
        ? Number(res.rowsAffected)
        : res.rowsAffected ?? 0;

    if (affected > 0) {
      await db
        .update(threads)
        .set({ updatedAt: now })
        .where(eq(threads.id, threadId))
        .run();
    }
    return affected > 0;
  }

  /** アクティブ参加者 */
  async getActiveParticipants(
    threadId: string,
  ): Promise<Array<ThreadParticipant & { client: StoredLLMClient }>> {
    if (await this.isDisabled()) return [];
    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const rows = await db
      .select({
        participant: threadParticipants,
        client: llmClients,
      })
      .from(threadParticipants)
      .innerJoin(llmClients, eq(threadParticipants.clientId, llmClients.id))
      .where(
        and(eq(threadParticipants.threadId, threadId), isNull(threadParticipants.leftAt)),
      )
      .orderBy(asc(threadParticipants.joinedAt));

    return rows.map((r) => ({ ...r.participant, client: r.client }));
  }

  /** ある時点以降の参加者 */
  async getParticipantsSince(
    threadId: string,
    since: Date,
  ): Promise<Array<ThreadParticipant & { client: StoredLLMClient }>> {
    if (await this.isDisabled()) return [];
    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const rows = await db
      .select({
        participant: threadParticipants,
        client: llmClients,
      })
      .from(threadParticipants)
      .innerJoin(llmClients, eq(threadParticipants.clientId, llmClients.id))
      .where(
        and(
          eq(threadParticipants.threadId, threadId),
          sql`${threadParticipants.joinedAt} >= ${since.getTime()}`,
          isNull(threadParticipants.leftAt),
        ),
      )
      .orderBy(asc(threadParticipants.joinedAt));

    return rows.map((r) => ({ ...r.participant, client: r.client }));
  }

  /* ========== メッセージ管理 ========== */

  /** 追加 */
  async addMessage(data: {
    threadId: string;
    clientId?: string;
    role: string;
    content: any;
    toolCalls?: any;
    toolResults?: any;
    parentMessageId?: string;
    metadata?: Record<string, any>;
    tokens?: number;
    cost?: number;
  }): Promise<Message> {
    const newMsg: NewMessage = {
      id: `msg_${uuidv4()}`,
      threadId: data.threadId,
      clientId: data.clientId,
      role: data.role,
      content: data.content,
      toolCalls: data.toolCalls,
      toolResults: data.toolResults,
      timestamp: new Date(),
      sequence: 1 as number | null,
      parentMessageId: data.parentMessageId,
      isEdited: false,
      editedAt: null,
      tokens: data.tokens,
      cost: data.cost,
      metadata: data.metadata,
    };

    if (await this.isDisabled()) {
      return {
        ...newMsg,
        parentMessageId: newMsg.parentMessageId ?? null,
        metadata: newMsg.metadata ?? null,
        toolCalls: newMsg.toolCalls ?? null,
        toolResults: newMsg.toolResults ?? null,
        tokens: newMsg.tokens ?? null,
        cost: newMsg.cost ?? null,
        sequence: newMsg.sequence ?? null,
        threadId: newMsg.threadId ?? null,
        clientId: newMsg.clientId ?? null,
        editedAt: newMsg.editedAt ?? null,
        isEdited: newMsg.isEdited ?? null,
      };
    }

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const [cnt] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messagesTable)
      .where(eq(messagesTable.threadId, data.threadId));

    newMsg.sequence = (cnt.count ?? 0) + 1;

    const [msg] = await db.insert(messagesTable).values(newMsg).returning();

    await db
      .update(threads)
      .set({ updatedAt: new Date() })
      .where(eq(threads.id, data.threadId))
      .run();

    return msg;
  }

  /** スレッドのメッセージ取得 */
  async getThreadMessages(
    threadId: string,
    options?: {
      limit?: number;
      offset?: number;
      since?: Date;
    },
  ): Promise<Message[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const cond = [eq(messagesTable.threadId, threadId)];
    if (options?.since) {
      cond.push(
        sql`${messagesTable.timestamp} >= ${options.since.getTime()}`,
      );
    }

    return await db
      .select()
      .from(messagesTable)
      .where(and(...cond))
      .orderBy(asc(messagesTable.sequence))
      .limit(options?.limit ?? 1000)
      .offset(options?.offset ?? 0);
  }

  /** 参加以降に見えるメッセージ */
  async getVisibleMessages(
    threadId: string,
    clientId: string,
    options?: { includeContext?: boolean; contextLimit?: number },
  ): Promise<Message[]> {
    if (await this.isDisabled()) return [];

    const db = await this.getDb();
    if (!db) throw new Error('Database connection is not available');

    const [participant] = await db
      .select()
      .from(threadParticipants)
      .where(
        and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.clientId, clientId),
        ),
      )
      .orderBy(asc(threadParticipants.joinedAt))
      .limit(1);

    if (!participant) {
      throw new Error(
        `LLMClient ${clientId} is not a participant in thread ${threadId}`,
      );
    }

    const sinceTs = participant.joinedAt.getTime();
    let msgs: Message[];

    if (options?.includeContext) {
      const after = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.threadId, threadId),
            sql`${messagesTable.timestamp} >= ${sinceTs}`,
          ),
        )
        .orderBy(asc(messagesTable.sequence));

      const before = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.threadId, threadId),
            sql`${messagesTable.timestamp} < ${sinceTs}`,
          ),
        )
        .orderBy(desc(messagesTable.sequence))
        .limit(options.contextLimit ?? 20);

      msgs = [...before.reverse(), ...after];
    } else {
      msgs = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.threadId, threadId),
            sql`${messagesTable.timestamp} >= ${sinceTs}`,
          ),
        )
        .orderBy(asc(messagesTable.sequence));
    }
    return msgs;
  }

  /* ========== 統一変換 / 統計 ========== */

  async getConversationThread(
    threadId: string,
  ): Promise<ConversationThread | null> {
    if (await this.isDisabled()) return null;

    const thread = await this.getThread(threadId);
    if (!thread) return null;

    const msgs = await this.getThreadMessages(threadId);
    return {
      id: thread.id,
      title: thread.title ?? undefined,
      messages: msgs.map(this.convertToUnifiedMessage),
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
      metadata: {
        description: thread.description,
        created_by: thread.createdBy,
        tags: thread.tags ? JSON.parse(thread.tags as string) : undefined,
        ...(thread.metadata ? JSON.parse(thread.metadata as string) : {}),
      },
    };
  }

  private convertToUnifiedMessage(db: Message): UnifiedMessage {
    return {
      id: db.id,
      role: db.role as any,
      content: db.content as any,
      created_at: db.timestamp,
      metadata: {
        client_id: db.clientId,
        tokens: db.tokens,
        cost: db.cost,
        tool_calls: db.toolCalls,
        tool_results: db.toolResults,
        sequence: db.sequence,
        parent_message_id: db.parentMessageId,
        is_edited: db.isEdited,
        edited_at: db.editedAt,
        ...(db.metadata ?? {}),
      },
    };
  }

  /** 統計 */
  async getThreadStats(threadId: string): Promise<{
    messageCount: number;
    participantCount: number;
    totalTokens: number;
    totalCost: number;
    participants: Array<{
      clientId: string;
      messageCount: number;
      joinedAt: Date;
    }>;
  }> {
    if (await this.isDisabled()) {
      return {
        messageCount: 0,
        participantCount: 0,
        totalTokens: 0,
        totalCost: 0,
        participants: [],
      };
    }

    const msgs = await this.getThreadMessages(threadId);
    const parts = await this.getActiveParticipants(threadId);

    const base = msgs.reduce(
      (acc, m) => {
        acc.messageCount++;
        acc.totalTokens += m.tokens ?? 0;
        acc.totalCost += m.cost ?? 0;
        return acc;
      },
      { messageCount: 0, totalTokens: 0, totalCost: 0 },
    );

    const perParticipant = parts.map((p) => ({
      clientId: p.clientId,
      messageCount: msgs.filter((m) => m.clientId === p.clientId).length,
      joinedAt: p.joinedAt,
    }));

    return {
      ...base,
      participantCount: parts.length,
      participants: perParticipant,
    };
  }
}

/* シングルトン */
export const threadRepository = new ThreadRepository();
