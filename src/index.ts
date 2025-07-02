import { LLMClient } from './llm-client';
import Thread from './thread';
import tools from './tools';
import { ClientManager, CLIENT_PRESETS } from './client-manager';
import { clientRepository, ClientRepository } from './database/client-repository';
import { threadRepository, ThreadRepository } from './database/thread-repository';

export { 
  LLMClient, 
  Thread,
  tools, 
  ClientManager,
  CLIENT_PRESETS,
  clientRepository,
  ClientRepository,
  threadRepository,
  ThreadRepository
};

// Type exports
export type { LLMClientConfig, LLMClientRuntimeConfig } from './llm-client';
export type { StoredLLMClient, NewStoredLLMClient, Thread as ThreadType, ThreadParticipant } from './database/schema';
export type { PresetName, BatchOperation, BatchResult, ClientStats } from './client-manager';
export type { ThreadConfig, JoinThreadOptions, ThreadSummary } from './database/thread-repository';
export type { Tool } from './types/unified-api';