import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// スレッドテーブル - 会話の永続化単位
export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  title: text('title'),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  createdBy: text('created_by'), // 作成者（ユーザーID）
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  tags: text('tags', { mode: 'json' }), // スレッドのタグ
  metadata: text('metadata', { mode: 'json' }),
});

// スレッド参加者テーブル - どのアシスタントがいつスレッドに参加したか
export const threadParticipants = sqliteTable('thread_participants', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => llmClients.id, { onDelete: 'cascade' }),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull(),
  leftAt: integer('left_at', { mode: 'timestamp' }), // null = まだ参加中
  role: text('role').default('participant'), // 'moderator', 'participant', 'observer'
  nickname: text('nickname'), // スレッド内でのニックネーム
  metadata: text('metadata', { mode: 'json' }),
});

export const llmClients = sqliteTable('llm_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  provider: text('provider').notNull(), // 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure'
  model: text('model'),
  systemPrompt: text('system_prompt'),
  instructions: text('instructions'), // カスタムインストラクション
  apiKey: text('api_key'), // 暗号化されたAPIキー（オプション）
  generationConfig: text('generation_config', { mode: 'json' }), // temperature, max_tokens, etc.
  tools: text('tools', { mode: 'json' }), // 利用可能な関数のリスト
  argumentMap: text('argument_map', { mode: 'json' }), // 固定引数の設定
  tags: text('tags', { mode: 'json' }), // タグでのカテゴリ分け
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  metadata: text('metadata', { mode: 'json' }),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  // スレッドベースのメッセージ管理
  threadId: text('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => llmClients.id),
  role: text('role').notNull(), // 'user', 'assistant', 'system', 'tool'
  content: text('content', { mode: 'json' }).notNull(),
  toolCalls: text('tool_calls', { mode: 'json' }),
  toolResults: text('tool_results', { mode: 'json' }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  sequence: integer('sequence'), // スレッド内でのメッセージ順序
  parentMessageId: text('parent_message_id'), // 返信元メッセージ（自己参照は後で追加）
  isEdited: integer('is_edited', { mode: 'boolean' }).default(false),
  editedAt: integer('edited_at', { mode: 'timestamp' }),
  tokens: integer('tokens'),
  cost: real('cost'),
  metadata: text('metadata', { mode: 'json' }),
});

// Relations
export const threadsRelations = relations(threads, ({ many }) => ({
  messages: many(messages),
  participants: many(threadParticipants),
}));

export const threadParticipantsRelations = relations(threadParticipants, ({ one }) => ({
  thread: one(threads, {
    fields: [threadParticipants.threadId],
    references: [threads.id],
  }),
  client: one(llmClients, {
    fields: [threadParticipants.clientId],
    references: [llmClients.id],
  }),
}));

export const llmClientsRelations = relations(llmClients, ({ many }) => ({
  messages: many(messages),
  threadParticipants: many(threadParticipants),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
  client: one(llmClients, {
    fields: [messages.clientId],
    references: [llmClients.id],
  }),
  parentMessage: one(messages, {
    fields: [messages.parentMessageId],
    references: [messages.id],
  }),
  replies: many(messages),
}));

// 型定義
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type ThreadParticipant = typeof threadParticipants.$inferSelect;
export type NewThreadParticipant = typeof threadParticipants.$inferInsert;
export type StoredLLMClient = typeof llmClients.$inferSelect;
export type NewStoredLLMClient = typeof llmClients.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

// アシスタント設定用の型定義
export interface LLMClientConfig {
  id?: string;
  name: string;
  description?: string;
  provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure';
  model?: string;
  systemPrompt?: string;
  instructions?: string;
  apiKey?: string;
  generationConfig?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop_sequences?: string[];
    response_format?: any;
  };
  tools?: string[]; // 関数名のリスト
  argumentMap?: Record<string, any>; // 固定引数
  tags?: string[];
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: Record<string, any>;
}