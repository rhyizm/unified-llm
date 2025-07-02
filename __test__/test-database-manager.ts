import { DatabaseManager, getDatabase } from '../src/database/connection';
import * as fs from 'fs';
import * as path from 'path';

export class TestDatabaseManager {
  private static testDbs: string[] = [];

  /**
   * テスト用のクリーンなデータベースを作成
   */
  static async createTestDb(testName: string) {
    const testDbPath = path.resolve(process.cwd(), `test-${testName}.db`);
    
    // 既存のテストDBファイルを削除
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // DatabaseManagerの既存インスタンスをクリア
    DatabaseManager.instances.clear();
    
    // 環境変数を設定
    process.env.UNIFIED_LLM_DB_PATH = testDbPath;
    
    // テストDB一覧に追加
    this.testDbs.push(testDbPath);
    
    // 明示的にパスを指定してDBインスタンスを作成（環境変数チェックをバイパス）
    const manager = await DatabaseManager.getInstance(testDbPath);
    const db = manager?.getDb();
    
    return db;
  }

  /**
   * 指定したテストDBを削除
   */
  static cleanupTestDb(testName: string) {
    const testDbPath = path.resolve(process.cwd(), `test-${testName}.db`);
    
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (error) {
        console.warn(`Failed to cleanup test database ${testDbPath}:`, error);
      }
    }
    
    // リストから削除
    this.testDbs = this.testDbs.filter(db => db !== testDbPath);
  }

  /**
   * すべてのテストDBをクリーンアップ
   */
  static cleanupAllTestDbs() {
    this.testDbs.forEach(testDbPath => {
      if (fs.existsSync(testDbPath)) {
        try {
          fs.unlinkSync(testDbPath);
        } catch (error) {
          console.warn(`Failed to cleanup test database ${testDbPath}:`, error);
        }
      }
    });
    
    this.testDbs = [];
    DatabaseManager.instances.clear();
    
    // 環境変数をリセット
    delete process.env.UNIFIED_LLM_DB_PATH;
  }

  /**
   * テスト実行前の初期化
   */
  static async beforeTest(testName: string) {
    await this.createTestDb(testName);
  }

  /**
   * テスト実行後のクリーンアップ
   */
  static afterTest(testName: string) {
    this.cleanupTestDb(testName);
  }
}