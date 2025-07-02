import { LLMClient } from './llm-client';
import { ConversationThread, Message as UnifiedMessage, UnifiedChatResponse } from './types/unified-api';
import { ThreadRepository } from './database/thread-repository';
import { clientRepository } from './database/client-repository';
import type { ThreadConfig, JoinThreadOptions } from './database/thread-repository';
import { v4 as uuidv4 } from 'uuid';

/**
 * スレッドベースのチャットセッション
 * 複数のLLMクライアントが途中から参加可能な永続化された会話スレッド
 */
export class Thread {
  public id: string;
  public title?: string;
  public description?: string;
  public clients: Map<string, LLMClient> = new Map();
  public messages: UnifiedMessage[] = [];
  public autoSave: boolean;
  private repository: ThreadRepository;
  private _isLoaded: boolean = false;
  private _createdBy?: string;
  private _tags?: string[];
  private _runtimeClientIds: Set<string> = new Set(); // 実行時クライアントIDの追跡
  
  constructor(config: ThreadConfig = {}) {
    this.id = config.threadId || `thread_${uuidv4()}`;
    this.title = config.title;
    this.description = config.description;
    this._createdBy = config.createdBy;
    this._tags = config.tags;
    this.autoSave = config.autoSave ?? true;
    this.repository = new ThreadRepository(config.dbPath);
  }

  /**
   * 既存のスレッドをロード
   */
  async load(): Promise<boolean> {
    try {
      const thread = await this.repository.getConversationThread(this.id);
      if (thread) {
        this.title = thread.title;
        this.description = thread.metadata?.description as string | undefined;
        this._createdBy = thread.metadata?.created_by as string | undefined;
        this._tags = thread.metadata?.tags as string[] | undefined;
        this.messages = thread.messages;
        this._isLoaded = true;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to load thread session:', error);
      return false;
    }
  }

  /**
   * スレッドを保存
   */
  async save(): Promise<boolean> {
    try {
      // Skip saving if persistence is disabled
      if ((this.repository as any).isDisabled) {
        return true;
      }

      // スレッドが存在しない場合は作成
      let thread = await this.repository.getThread(this.id);
      if (!thread) {
        const ThreadConfig: ThreadConfig = {
          title: this.title,
          description: this.description,
          createdBy: this._createdBy,
          tags: this._tags,
        };
        thread = await this.repository.createThread(ThreadConfig);
        this.id = thread.id;
      } else if (this.title !== thread.title || this.description !== thread.description) {
        await this.repository.updateThread(this.id, { 
          title: this.title,
          description: this.description,
          tags: this._tags,
        });
      }

      // 新しいメッセージを保存
      const existingMessages = await this.repository.getThreadMessages(this.id);
      const existingMessageIds = new Set(existingMessages.map(m => m.id));
      
      for (const message of this.messages) {
        if (!existingMessageIds.has(message.id)) {
          // clientIdが存在する場合のみ設定、存在しない場合はundefinedにする
          let clientId = message.metadata?.client_id as string | undefined;
          if (clientId) {
            try {
              const { ClientRepository } = await import('./database/client-repository');
              const assistantRepo = new ClientRepository();
              const assistant = await assistantRepo.findById(clientId as string);
              if (!assistant) {
                clientId = undefined; // 存在しないアシスタントIDの場合はundefinedに
              }
            } catch (_error) {
              clientId = undefined; // エラーの場合もundefinedに
            }
          }

          await this.repository.addMessage({
            threadId: this.id,
            clientId: clientId as string | undefined,
            role: message.role,
            content: message.content,
            toolCalls: message.metadata?.tool_calls,
            toolResults: message.metadata?.tool_results,
            parentMessageId: message.metadata?.parent_message_id as string | undefined,
            tokens: message.metadata?.tokens as number | undefined,
            cost: message.metadata?.cost as number | undefined,
            metadata: message.metadata,
          });
        }
      }

      this._isLoaded = true;
      return true;
    } catch (error) {
      console.error('Failed to save thread session:', error);
      return false;
    }
  }

  /**
   * 保存されたLLMクライアントをスレッドに参加させる
   */
  async addAssistantById(
    clientId: string, 
    nickname?: string, 
    options: JoinThreadOptions & {
      includeContext?: boolean;  // 参加前の文脈を含めるか
      contextLimit?: number;     // 含める文脈の最大メッセージ数
    } = {}
  ): Promise<void> {
    // 保存されたLLMクライアント設定を取得
    const storedAssistant = await clientRepository.findById(clientId);
    if (!storedAssistant) {
      throw new Error(`LLM client with ID ${clientId} not found`);
    }

    // APIキーを環境変数から取得
    const apiKey = storedAssistant.apiKey || process.env[`${storedAssistant.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      throw new Error(`API key not found for provider ${storedAssistant.provider}`);
    }

    // LLMClientインスタンスを作成
    const assistant = await LLMClient.fromSaved(clientId, apiKey);
    
    // スレッドに参加
    await this.repository.joinThread(this.id, clientId, {
      role: options.role || 'participant',
      nickname: nickname || storedAssistant.name,
      metadata: {
        ...options.metadata,
        includeContext: options.includeContext,
        contextLimit: options.contextLimit,
      }
    });

    // メモリに追加
    const displayName = nickname || storedAssistant.name;
    this.clients.set(displayName, assistant);

    // 自動保存
    if (this.autoSave) {
      await this.save();
    }
  }

  /**
   * 実行時LLMクライアントをスレッドに参加させる（実行時作成対応）
   */
  async addAssistant(
    assistant: LLMClient, 
    name: string,
    options: JoinThreadOptions & { 
      clientId?: string;
      provider?: 'openai' | 'anthropic' | 'google';
      model?: string;
      includeContext?: boolean;  // 参加前の文脈を含めるか
      contextLimit?: number;     // 含める文脈の最大メッセージ数
    } = {}
  ): Promise<void> {
    let clientId = options.clientId;
    
    // clientIdが指定されていない場合、一時的なIDを生成
    if (!clientId) {
      clientId = `runtime_${uuidv4()}`;
      this._runtimeClientIds.add(clientId);
    }
    
    // カスタムIDも含めて、すべての実行時アシスタントをDBに保存
    if (!clientId.startsWith('runtime_') || options.clientId) {
      this._runtimeClientIds.add(clientId);
    }
    
    // 実行時LLMクライアントの情報を一時的にDBに保存
    const runtimeAssistantConfig = {
      id: clientId,
      name: name,
      description: `Runtime LLM client: ${name}`,
      provider: options.provider || 'openai', // デフォルトプロバイダー
      model: options.model,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { 
        isRuntime: true, // 実行時LLMクライアントマーク
        sessionId: this.id 
      }
    };
    
    try {
      await clientRepository.save(runtimeAssistantConfig);
    } catch (error) {
      console.warn('Failed to save runtime LLM client to DB, proceeding with memory-only mode:', error);
    }

    // スレッドに参加
    await this.repository.joinThread(this.id, clientId, {
      role: options.role || 'participant',
      nickname: name,
      metadata: {
        ...options.metadata,
        isRuntime: !options.clientId, // 実行時LLMクライアントかどうか
        includeContext: options.includeContext,
        contextLimit: options.contextLimit,
      },
    });

    // メモリに追加
    this.clients.set(name, assistant);

    // 自動保存
    if (this.autoSave) {
      await this.save();
    }
  }

  /**
   * LLMクライアントをスレッドから離脱させる
   */
  async removeAssistant(nameOrId: string): Promise<boolean> {
    // メモリから削除
    let removed = false;
    if (this.clients.has(nameOrId)) {
      this.clients.delete(nameOrId);
      removed = true;
    }

    // データベースから離脱
    // nameOrIdがニックネームの場合、対応するLLMクライアントIDを見つける必要がある
    const participants = await this.repository.getActiveParticipants(this.id);
    const participant = participants.find(p => 
      p.clientId === nameOrId || p.nickname === nameOrId
    );

    if (participant) {
      await this.repository.leaveThread(this.id, participant.clientId);
      
      // 実行時LLMクライアントの場合はDBからも削除
      if (this._runtimeClientIds.has(participant.clientId)) {
        try {
          await clientRepository.hardDelete(participant.clientId);
          this._runtimeClientIds.delete(participant.clientId);
        } catch (error) {
          console.warn(`Failed to cleanup runtime LLM client ${participant.clientId}:`, error);
        }
      }
      
      removed = true;
    }

    // 自動保存
    if (this.autoSave && removed) {
      await this.save();
    }

    return removed;
  }

  /**
   * スレッドに参加しているLLMクライアントの一覧を取得
   */
  async getParticipants() {
    return await this.repository.getActiveParticipants(this.id);
  }

  /**
   * 特定の時点以降に参加したLLMクライアントを取得
   */
  async getNewParticipantsSince(since: Date) {
    return await this.repository.getParticipantsSince(this.id, since);
  }

  /**
   * メッセージを送信（指定したLLMクライアントまたは全LLMクライアントが応答）
   */
  async sendMessage(
    content: string | UnifiedMessage['content'], 
    targetAssistant?: string
  ): Promise<UnifiedChatResponse[]> {
    // ユーザーメッセージを追加
    const userMessage: UnifiedMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      created_at: new Date(),
    };
    
    this.messages.push(userMessage);

    const responses: UnifiedChatResponse[] = [];

    // 対象LLMクライアントを決定
    const targetAssistants = targetAssistant 
      ? [this.clients.get(targetAssistant)].filter(Boolean) as LLMClient[]
      : Array.from(this.clients.values());

    // 各LLMクライアントから応答を取得
    for (const assistant of targetAssistants) {
      try {
        const assistantName = this.getAssistantName(assistant);
        const participant = await this.getParticipantByName(assistantName);
        
        if (!participant) {
          console.warn(`LLM client ${assistantName} is not a participant in this thread`);
          continue;
        }

        // LLMクライアントが見ることができるメッセージを取得
        // participantのメタデータから文脈設定を取得
        const participantMetadata = participant.metadata ? JSON.parse(participant.metadata as string) : {};
        const includeContext = participantMetadata.includeContext ?? false;
        const contextLimit = participantMetadata.contextLimit;
        
        const visibleMessages = await this.repository.getVisibleMessages(
          this.id, 
          participant.clientId,
          { includeContext, contextLimit }
        );
        
        const contextMessages = visibleMessages.map(msg => ({
          id: msg.id,
          role: msg.role as any,
          content: msg.content as any,
          created_at: msg.timestamp,
          metadata: msg.metadata,
        }));

        // 現在のメッセージを含む完全なコンテキストを構築
        const fullContext = [...contextMessages, userMessage];

        const response = await assistant.chat({
          messages: fullContext,
          model: participant.client.model || 'gpt-4-turbo-preview',
        });
        responses.push(response);

        // LLMクライアントの応答をメッセージに追加
        const assistantMessage: UnifiedMessage = {
          id: response.id,
          role: 'assistant',
          content: response.message.content,
          created_at: response.created_at,
          metadata: {
            client_id: participant.clientId,
            client_name: assistantName,
            provider: response.provider,
            model: response.model,
            usage: response.usage,
            finish_reason: response.finish_reason,
          },
        };

        this.messages.push(assistantMessage);
      } catch (error) {
        console.error('Failed to get response from LLM client:', error);
      }
    }

    // 自動保存
    if (this.autoSave) {
      await this.save();
    }

    return responses;
  }

  /**
   * LLMクライアントのニックネームから参加者情報を取得
   */
  private async getParticipantByName(name: string) {
    const participants = await this.repository.getActiveParticipants(this.id);
    return participants.find(p => p.nickname === name || p.clientId === name);
  }

  /**
   * LLMクライアントインスタンスからニックネームを取得
   */
  private getAssistantName(assistant: LLMClient): string {
    for (const [name, ass] of this.clients.entries()) {
      if (ass === assistant) return name;
    }
    return 'unknown';
  }

  /**
   * 統一形式のスレッドとして取得
   */
  toConversationThread(): ConversationThread {
    return {
      id: this.id,
      title: this.title,
      messages: this.messages,
      created_at: new Date(), // これはDBから取得すべき
      updated_at: new Date(),
      metadata: {
        description: this.description,
        created_by: this._createdBy,
        tags: this._tags,
      },
    };
  }

  /**
   * メッセージをクリア
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * スレッドの統計情報を取得
   */
  async getStats() {
    if (this._isLoaded || this.autoSave) {
      return await this.repository.getThreadStats(this.id);
    }
    
    // メモリ内のメッセージから統計を計算
    const clientIds = new Set<string>();
    let totalTokens = 0;
    
    this.messages.forEach(msg => {
      if (msg.metadata?.client_id) {
        clientIds.add(msg.metadata.client_id as string);
      }
      totalTokens += (msg.metadata?.tokens as number) || 0;
    });

    return {
      messageCount: this.messages.length,
      participantCount: this.clients.size,
      totalTokens,
      totalCost: 0, // 正確な計算にはDBアクセスが必要
      participants: Array.from(clientIds).map(id => ({
        clientId: id,
        messageCount: this.messages.filter(m => m.metadata?.client_id === id).length,
        joinedAt: new Date(), // 正確な情報にはDBアクセスが必要
      })),
    };
  }

  /**
   * セッション終了時のクリーンアップ（実行時LLMクライアントをDBから削除）
   */
  async cleanup(): Promise<void> {
    for (const runtimeId of this._runtimeClientIds) {
      try {
        await clientRepository.hardDelete(runtimeId);
      } catch (error) {
        console.warn(`Failed to cleanup runtime LLM client ${runtimeId}:`, error);
      }
    }
    this._runtimeClientIds.clear();
  }

  // ========== 静的メソッド ==========

  /**
   * 新しいスレッドを作成
   */
  static async createThread(config: ThreadConfig = {}): Promise<Thread> {
    const session = new Thread(config);
    
    if (config.autoSave !== false) {
      await session.save();
    }
    
    return session;
  }

  /**
   * 既存のスレッドをロード
   */
  static async loadThread(threadId: string, config: Omit<ThreadConfig, 'threadId'> = {}): Promise<Thread | null> {
    const session = new Thread({ ...config, threadId });
    const loaded = await session.load();
    return loaded ? session : null;
  }

  /**
   * アクティブなスレッドの一覧を取得
   */
  static async listThreads(options?: {
    limit?: number;
    offset?: number;
    tags?: string[];
    createdBy?: string;
    dbPath?: string;
  }) {
    const repository = new ThreadRepository(options?.dbPath);
    return await repository.listThreads(options);
  }

  /**
   * スレッドを削除
   */
  static async deleteThread(threadId: string, dbPath?: string): Promise<boolean> {
    const repository = new ThreadRepository(dbPath);
    return await repository.deleteThread(threadId);
  }

  /**
   * 既存のチャットをロード（loadThreadのエイリアス）
   * テストの互換性のために追加
   */
  static async loadChat(threadId: string, config: Omit<ThreadConfig, 'threadId'> = {}): Promise<Thread | null> {
    return Thread.loadThread(threadId, config);
  }
}

export default Thread;