import { LLMClient, LLMClientConfig } from '../src/llm-client';
import { ClientManager } from '../src/client-manager';
import { clientRepository } from '../src/database/client-repository';
import { TestDatabaseManager } from './test-database-manager';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('LLMClient Persistence', () => {
  let testAssistantIds: string[] = [];

  beforeAll(async () => {
    await TestDatabaseManager.beforeTest('llm-persistence');
  });

  afterAll(async () => {
    // Clean up test assistants
    for (const id of testAssistantIds) {
      try {
        await clientRepository.hardDelete(id);
      } catch (error) {
        console.warn(`Failed to clean up test assistant ${id}:`, error);
      }
    }
    
    TestDatabaseManager.afterTest('llm-persistence');
  });

  describe('Basic Persistence Operations', () => {
    it('should save and retrieve assistant configuration', async () => {
      const config: LLMClientConfig = {
        name: 'Test LLMClient',
        description: 'A test assistant for unit testing',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        systemPrompt: 'You are a helpful test assistant.',
        instructions: 'Follow test instructions carefully.',
        generationConfig: {
          temperature: 0.7,
          max_tokens: 1000,
        },
        tools: ['getCurrentTime', 'getAuthor'],
        argumentMap: {
          getAuthor: { name: 'Test Author' }
        },
        tags: ['test', 'automation'],
        metadata: { testCase: 'basic-persistence' }
      };

      // Save the assistant
      const savedId = await LLMClient.save(config);
      testAssistantIds.push(savedId);

      expect(savedId).toBeDefined();
      expect(savedId).toMatch(/^asst_/);

      // Retrieve the assistant
      const retrieved = await LLMClient.getConfig(savedId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(config.name);
      expect(retrieved!.provider).toBe(config.provider);
      expect(retrieved!.generationConfig?.temperature).toBe(0.7);
      expect(retrieved!.tags).toEqual(['test', 'automation']);
    });

    it('should create assistant from saved configuration', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('⚠️ Skipping OpenAI test - no API key');
        return;
      }

      const config: LLMClientConfig = {
        name: 'Runtime Test LLMClient',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        systemPrompt: 'You are a test assistant.',
        generationConfig: {
          temperature: 0.1,
        },
        tools: ['getCurrentTime'],
      };

      const savedId = await LLMClient.save(config);
      testAssistantIds.push(savedId);

      // Create assistant from saved config
      const assistant = await LLMClient.fromSaved(savedId, process.env.OPENAI_API_KEY);
      expect(assistant).toBeDefined();

      // Test basic functionality
      const response = await assistant.chat({
        messages: [{
          id: 'test-1',
          role: 'user',
          content: 'Say hello',
          created_at: new Date()
        }],
        model: 'gpt-4.1-mini'
      });

      expect(response.message.content).toBeDefined();
      expect(response.provider).toBe('openai');
    });

    it('should update assistant configuration', async () => {
      const config: LLMClientConfig = {
        name: 'Update Test LLMClient',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        tags: ['test']
      };

      const savedId = await LLMClient.save(config);
      testAssistantIds.push(savedId);

      // Update the configuration
      await LLMClient.update(savedId, {
        description: 'Updated description',
        tags: ['test', 'updated'],
        generationConfig: {
          temperature: 0.5
        }
      });

      const updated = await LLMClient.getConfig(savedId);
      expect(updated!.description).toBe('Updated description');
      expect(updated!.tags).toEqual(['test', 'updated']);
      expect(updated!.generationConfig?.temperature).toBe(0.5);
    });

    it('should list assistants with filters', async () => {
      // Create test assistants
      const configs = [
        {
          name: 'OpenAI Test 1',
          provider: 'openai' as const,
          tags: ['test', 'openai']
        },
        {
          name: 'Anthropic Test 1',
          provider: 'anthropic' as const,
          tags: ['test', 'anthropic']
        },
        {
          name: 'Google Test 1',
          provider: 'google' as const,
          tags: ['test', 'google']
        }
      ];

      for (const config of configs) {
        const id = await LLMClient.save(config);
        testAssistantIds.push(id);
      }

      // Test provider filtering
      const openaiAssistants = await LLMClient.list({ provider: 'openai' });
      const testOpenaiAssistants = openaiAssistants.filter(a => a.name?.includes('Test'));
      expect(testOpenaiAssistants.length).toBeGreaterThanOrEqual(1);

      // Test tag filtering
      const taggedAssistants = await LLMClient.list({ tags: ['openai'] });
      const testTaggedAssistants = taggedAssistants.filter(a => a.name?.includes('Test'));
      expect(testTaggedAssistants.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete assistant (soft delete)', async () => {
      const config: LLMClientConfig = {
        name: 'Delete Test LLMClient',
        provider: 'openai',
      };

      const savedId = await LLMClient.save(config);
      testAssistantIds.push(savedId);

      // Soft delete
      const deleted = await LLMClient.delete(savedId);
      expect(deleted).toBe(true);

      // Should not appear in active list
      const activeAssistants = await LLMClient.list();
      const found = activeAssistants.find(a => a.id === savedId);
      expect(found).toBeUndefined();

      // Should appear in inactive list
      const allAssistants = await LLMClient.list({ includeInactive: true });
      const foundInactive = allAssistants.find(a => a.id === savedId);
      expect(foundInactive).toBeDefined();
      expect(foundInactive!.isActive).toBe(false);
    });
  });

  describe('LLMClient Manager', () => {
    it('should create preset assistants', async () => {
      const id = await ClientManager.createPreset('coding-agent', {
        name: 'Test Coding LLMClient'
      });
      testAssistantIds.push(id);

      const config = await LLMClient.getConfig(id);
      expect(config!.name).toBe('Test Coding LLMClient');
      expect(config!.tags).toContain('coding');
      expect(config!.tools).toContain('getProjectInfo');
    });

    it('should clone assistant', async () => {
      const originalConfig: LLMClientConfig = {
        name: 'Original LLMClient',
        provider: 'openai',
        description: 'Original description',
        tags: ['original']
      };

      const originalId = await LLMClient.save(originalConfig);
      testAssistantIds.push(originalId);

      const clonedId = await ClientManager.clone(originalId, 'Cloned LLMClient', {
        description: 'Cloned description',
        tags: ['cloned']
      });
      testAssistantIds.push(clonedId);

      const cloned = await LLMClient.getConfig(clonedId);
      expect(cloned!.name).toBe('Cloned LLMClient');
      expect(cloned!.description).toBe('Cloned description');
      expect(cloned!.tags).toEqual(['cloned']);
      expect(cloned!.provider).toBe('openai'); // Inherited
    });

    it('should export and import assistant', async () => {
      const config: LLMClientConfig = {
        name: 'Export Test LLMClient',
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
        description: 'Test export functionality',
        generationConfig: {
          temperature: 0.8,
          max_tokens: 2000
        },
        tags: ['export', 'test']
      };

      const originalId = await LLMClient.save(config);
      testAssistantIds.push(originalId);

      // Export
      const exported = await ClientManager.export(originalId);
      expect(exported).toContain('Export Test LLMClient');
      expect(exported).toContain('anthropic');

      // Import
      const importedId = await ClientManager.import(exported);
      testAssistantIds.push(importedId);

      const imported = await LLMClient.getConfig(importedId);
      expect(imported!.name).toBe(config.name);
      expect(imported!.provider).toBe(config.provider);
      expect(imported!.generationConfig?.temperature).toBe(0.8);
    });

    it('should get statistics', async () => {
      // Create a few test assistants
      const configs = [
        { name: 'Stats Test 1', provider: 'openai' as const, tags: ['stats'] },
        { name: 'Stats Test 2', provider: 'anthropic' as const, tags: ['stats'] },
        { name: 'Stats Test 3', provider: 'openai' as const, tags: ['stats', 'testing'] }
      ];

      for (const config of configs) {
        const id = await LLMClient.save(config);
        testAssistantIds.push(id);
      }

      const stats = await ClientManager.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byProvider).toBeDefined();
      expect(stats.popularTags).toBeDefined();
      expect(stats.recentlyUpdated).toBeDefined();
    });

    it('should search assistants', async () => {
      const searchConfig: LLMClientConfig = {
        name: 'Searchable Test LLMClient',
        provider: 'google',
        model: 'gemini-1.5-pro',
        tags: ['searchable', 'unique-tag']
      };

      const searchId = await LLMClient.save(searchConfig);
      testAssistantIds.push(searchId);

      // Search by name
      const nameResults = await ClientManager.search({ name: 'Searchable' });
      expect(nameResults.length).toBeGreaterThan(0);
      expect(nameResults.some(a => a.name === 'Searchable Test LLMClient')).toBe(true);

      // Search by provider
      const providerResults = await ClientManager.search({ provider: 'google' });
      expect(providerResults.some(a => a.name === 'Searchable Test LLMClient')).toBe(true);

      // Search by tags
      const tagResults = await ClientManager.search({ tags: ['unique-tag'] });
      expect(tagResults.some(a => a.name === 'Searchable Test LLMClient')).toBe(true);

      // Search by model
      const modelResults = await ClientManager.search({ model: 'gemini-1.5-pro' });
      expect(modelResults.some(a => a.name === 'Searchable Test LLMClient')).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should validate assistant configuration', async () => {
      const invalidConfig = {
        // Missing required name
        provider: 'openai',
        generationConfig: {
          temperature: 5.0, // Invalid temperature
          max_tokens: -1000 // Invalid max_tokens
        }
      } as LLMClientConfig;

      await expect(LLMClient.save(invalidConfig)).rejects.toThrow(/Invalid LLM client configuration/);
    });

    it('should validate temperature range', async () => {
      const config: LLMClientConfig = {
        name: 'Validation Test',
        provider: 'openai',
        generationConfig: {
          temperature: 3.0 // Invalid
        }
      };

      await expect(LLMClient.save(config)).rejects.toThrow(/Temperature must be between 0 and 2/);
    });

    it('should validate provider', async () => {
      const config = {
        name: 'Provider Test',
        provider: 'invalid-provider'
      } as any;

      await expect(LLMClient.save(config)).rejects.toThrow(/Provider must be one of/);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing assistant', async () => {
      await expect(LLMClient.getConfig('nonexistent-id')).resolves.toBeNull();
      await expect(LLMClient.fromSaved('nonexistent-id')).rejects.toThrow(/not found/);
    });

  });
});