import { createClient, Client } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

import * as schema from './schema';
import fs from 'fs';
import path from 'path';

export class DatabaseManager {
  static instances = new Map<string, DatabaseManager>();

  /** libsql client (pure JS) */
  private client: Client;
  /** drizzle DB */
  private db: ReturnType<typeof drizzle>;

  // --- コンストラクタは async にする ------------------------------
  private constructor(client: Client) {
    this.client = client;
    this.db = drizzle(client, { schema });
  }

  /** Factory: インスタンス取得 & 1 回だけ migrate */
  public static async getInstance(dbFile?: string) {
    let finalPath: string;
    
    if (dbFile) {
      // 明示的にパスが指定された場合は常に作成
      finalPath = dbFile;
    } else if (process.env.UNIFIED_LLM_DB_PATH) {
      // 環境変数が設定されている場合は使用
      finalPath = process.env.UNIFIED_LLM_DB_PATH;
    } else {
      // どちらもない場合はnullを返す（persistence disabled）
      return null;
    }
    if (DatabaseManager.instances.has(finalPath)) {
      const existingInstance = DatabaseManager.instances.get(finalPath);
      if (existingInstance) {
        return existingInstance;
      }
    }

    // ファイル用 URL。ディレクトリは手動で作る
    const url = finalPath.startsWith('file:') ? finalPath : `file:${finalPath}`;
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });

    const client = createClient({ url });         // ← ネイティブ依存なし
    const mgr = new DatabaseManager(client);

    // マイグレーション（非同期）
    const migrationsFolder = path.join(__dirname, '../../drizzle');
    if (fs.existsSync(migrationsFolder)) {
      await migrate(mgr.db, { migrationsFolder });
    } else {
      await mgr.createTables();                  // fallback
    }

    DatabaseManager.instances.set(finalPath, mgr);
    return mgr;
  }

  /** drizzle インスタンスを返す */
  public getDb() {
    return this.db;
  }

  /** libsql の close は Promise */
  public async close() {
    this.client.close();
  }

  // --- Fallback: raw SQL 実行は execute ----------------------------
  private async createTables() {
    // Execute each table creation separately to avoid issues with multiple statements
    const statements = [
      `CREATE TABLE IF NOT EXISTS threads (
        id            TEXT PRIMARY KEY,
        title         TEXT,
        description   TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        created_by    TEXT,
        is_active     INTEGER DEFAULT 1,
        tags          TEXT,
        metadata      TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS llm_clients (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        description       TEXT,
        provider          TEXT NOT NULL,
        model             TEXT,
        system_prompt     TEXT,
        instructions      TEXT,
        api_key           TEXT,
        generation_config TEXT,
        tools             TEXT,
        argument_map      TEXT,
        tags              TEXT,
        is_active         INTEGER DEFAULT 1,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        metadata          TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS thread_participants (
        id            TEXT PRIMARY KEY,
        thread_id     TEXT NOT NULL,
        client_id     TEXT NOT NULL,
        joined_at     INTEGER NOT NULL,
        left_at       INTEGER,
        role          TEXT DEFAULT 'participant',
        nickname      TEXT,
        metadata      TEXT,
        FOREIGN KEY (thread_id)    REFERENCES threads(id)     ON DELETE CASCADE,
        FOREIGN KEY (client_id) REFERENCES llm_clients(id)  ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id               TEXT PRIMARY KEY,
        thread_id        TEXT,
        client_id        TEXT,
        role             TEXT NOT NULL,
        content          TEXT NOT NULL,
        tool_calls       TEXT,
        tool_results     TEXT,
        timestamp        INTEGER NOT NULL,
        sequence         INTEGER,
        parent_message_id TEXT,
        is_edited        INTEGER DEFAULT 0,
        edited_at        INTEGER,
        tokens           INTEGER,
        cost             REAL,
        metadata         TEXT,
        FOREIGN KEY (thread_id)    REFERENCES threads(id)     ON DELETE CASCADE,
        FOREIGN KEY (client_id) REFERENCES llm_clients(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id)`,
      `CREATE INDEX IF NOT EXISTS idx_thread_participants_thread_id ON thread_participants(thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_thread_participants_client_id ON thread_participants(client_id)`
    ];

    for (const statement of statements) {
      await this.db.run(sql.raw(statement));
    }
  }
}

/** 以前呼び出していた util も Promise に */
export const getDatabase = async (dbPath?: string) => {
  const manager = await DatabaseManager.getInstance(dbPath);
  return manager ? manager.getDb() : null;
};
