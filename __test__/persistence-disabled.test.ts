import { DatabaseManager, getDatabase } from '../src/database/connection';
import { ThreadRepository } from '../src/database/thread-repository';
import { ClientRepository } from '../src/database/client-repository';
import { Thread } from '../src/thread';
import { TestDatabaseManager } from './test-database-manager';

describe('Persistence Disabled', () => {
  const originalEnv = process.env.UNIFIED_LLM_DB_PATH;

  beforeAll(() => {
    // Clear any existing database instances and reset environment
    TestDatabaseManager.cleanupAllTestDbs();
    // Ensure environment variable is completely removed
    delete process.env.UNIFIED_LLM_DB_PATH;
  });

  beforeEach(() => {
    // Remove the database path to simulate persistence being disabled
    delete process.env.UNIFIED_LLM_DB_PATH;
    DatabaseManager.instances.clear();
  });

  afterEach(() => {
    // Restore the original environment variable
    if (originalEnv !== undefined) {
      process.env.UNIFIED_LLM_DB_PATH = originalEnv;
    }
  });

  describe('DatabaseManager', () => {
    it('should return null when no environment variable is set', async () => {
      const manager = await DatabaseManager.getInstance();
      expect(manager).toBeNull();
    });

    it('should return null from getDatabase when no environment variable is set', async () => {
      const db = await getDatabase();
      expect(db).toBeNull();
    });
  });

  describe('ThreadRepository', () => {
    let repository: ThreadRepository;

    beforeEach(() => {
      repository = new ThreadRepository();
    });

    it('should be marked as disabled when no database path is provided', async () => {
      expect(await (repository as any).isDisabled()).toBe(true);
    });

    it('should return mock thread when creating thread with persistence disabled', async () => {
      const thread = await repository.createThread({
        title: 'Test Thread',
        description: 'Test Description'
      });

      expect(thread).toBeDefined();
      expect(thread.title).toBe('Test Thread');
      expect(thread.description).toBe('Test Description');
      expect(thread.isActive).toBe(true);
    });

    it('should return empty array when listing threads with persistence disabled', async () => {
      const threads = await repository.listThreads();
      expect(threads).toEqual([]);
    });

    it('should return mock participant when joining thread with persistence disabled', async () => {
      const participant = await repository.joinThread('test-thread-id', 'test-client-id', {
        role: 'participant',
        nickname: 'Test LLMClient'
      });

      expect(participant).toBeDefined();
      expect(participant.threadId).toBe('test-thread-id');
      expect(participant.clientId).toBe('test-client-id');
      expect(participant.role).toBe('participant');
      expect(participant.nickname).toBe('Test LLMClient');
    });

    it('should return mock message when adding message with persistence disabled', async () => {
      const message = await repository.addMessage({
        threadId: 'test-thread-id',
        role: 'user',
        content: 'Test message'
      });

      expect(message).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.content).toBe('Test message');
      expect(message.threadId).toBe('test-thread-id');
    });
  });

  describe('ClientRepository', () => {
    let repository: ClientRepository;

    beforeEach(() => {
      repository = new ClientRepository();
    });

    it('should be marked as disabled when no database path is provided', async () => {
      expect(await (repository as any).isDisabled()).toBe(true);
    });

    it('should return mock assistant when saving with persistence disabled', async () => {
      const assistant = await repository.save({
        name: 'Test LLMClient',
        provider: 'openai',
        model: 'gpt-4'
      });

      expect(assistant).toBeDefined();
      expect(assistant.name).toBe('Test LLMClient');
      expect(assistant.provider).toBe('openai');
      expect(assistant.model).toBe('gpt-4');
    });

    it('should return null when finding assistant by ID with persistence disabled', async () => {
      const assistant = await repository.findById('test-id');
      expect(assistant).toBeNull();
    });

    it('should return empty array when finding all assistants with persistence disabled', async () => {
      const assistants = await repository.findAll();
      expect(assistants).toEqual([]);
    });

    it('should return false when deleting assistant with persistence disabled', async () => {
      const result = await repository.delete('test-id');
      expect(result).toBe(false);
    });
  });

  describe('Thread', () => {
    it('should create and save successfully when persistence is disabled', async () => {
      const session = new Thread({
        title: 'Test Thread Session',
        description: 'Test Description',
        autoSave: true
      });

      expect(session.title).toBe('Test Thread Session');
      expect(session.description).toBe('Test Description');
      
      // Should not throw error when saving
      const saveResult = await session.save();
      expect(saveResult).toBe(true);
    });

    it('should handle participant operations when persistence is disabled', async () => {
      const session = new Thread({
        title: 'Participant Test'
      });

      // Getting participants should return empty array when persistence is disabled
      const participants = await session.getParticipants();
      expect(participants).toEqual([]);
    });

    it('should return empty stats when persistence is disabled', async () => {
      const session = new Thread({
        title: 'Stats Test'
      });

      const stats = await session.getStats();
      expect(stats.messageCount).toBe(0);
      expect(stats.participantCount).toBe(0);
      expect(stats.participants).toEqual([]);
    });

    it('should handle cleanup gracefully when persistence is disabled', async () => {
      const session = new Thread({
        title: 'Cleanup Test'
      });

      // Cleanup should not throw errors when persistence is disabled
      await expect(session.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('Static Methods', () => {
    it('should handle Thread.listThreads when persistence is disabled', async () => {
      const threads = await Thread.listThreads();
      expect(threads).toEqual([]);
    });

    it('should return null when loading non-existent thread with persistence disabled', async () => {
      const session = await Thread.loadThread('non-existent-id');
      expect(session).toBeNull();
    });

    it('should return false when deleting non-existent thread with persistence disabled', async () => {
      const result = await Thread.deleteThread('non-existent-id');
      expect(result).toBe(false);
    });
  });
});