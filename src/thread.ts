import { LLMClient } from './llm-client';
import { ConversationThread, Message as UnifiedMessage, UnifiedChatResponse } from './types/unified-api';
import { v4 as uuidv4 } from 'uuid';

/**
 * Thread-based chat session
 * Multiple LLM clients can join an in-memory conversation thread
 * Note: v0.4.0 removed persistence support - threads are now in-memory only
 */
export class Thread {
  public id: string;
  public title?: string;
  public description?: string;
  public clients: Map<string, LLMClient> = new Map();
  public messages: UnifiedMessage[] = [];
  
  constructor(config: { 
    threadId?: string; 
    title?: string; 
    description?: string; 
  } = {}) {
    this.id = config.threadId || `thread_${uuidv4()}`;
    this.title = config.title;
    this.description = config.description;
  }

  /**
   * Add an LLM client to the thread
   */
  addAssistant(assistant: LLMClient, name: string): void {
    this.clients.set(name, assistant);
  }

  /**
   * Remove an LLM client from the thread
   */
  removeAssistant(name: string): boolean {
    return this.clients.delete(name);
  }

  /**
   * Send a message to all clients in the thread
   */
  async broadcast(message: string): Promise<Map<string, UnifiedChatResponse>> {
    const responses = new Map<string, UnifiedChatResponse>();
    
    // Add user message to thread
    this.messages.push({
      id: `msg_${uuidv4()}`,
      role: 'user',
      content: [{
        type: 'text',
        text: message
      }],
      created_at: new Date(),
      metadata: {
        timestamp: new Date(),
      }
    });

    // Get responses from all clients
    for (const [name, client] of this.clients) {
      try {
        const response = await client.chat(this.messages);
        responses.set(name, response);
        
        // Add assistant response to thread
        this.messages.push({
          id: response.id,
          role: 'assistant',
          content: response.message.content,
          created_at: response.created_at,
          metadata: {
            ...response.message.metadata,
            client_name: name,
          }
        });
      } catch (error) {
        console.error(`Failed to get response from ${name}:`, error);
      }
    }

    return responses;
  }

  /**
   * Send a message to a specific client in the thread
   */
  async sendTo(clientName: string, message: string): Promise<UnifiedChatResponse | null> {
    const client = this.clients.get(clientName);
    if (!client) {
      console.error(`Client ${clientName} not found in thread`);
      return null;
    }

    // Add user message to thread
    this.messages.push({
      id: `msg_${uuidv4()}`,
      role: 'user',
      content: [{
        type: 'text',
        text: message
      }],
      created_at: new Date(),
      metadata: {
        timestamp: new Date(),
        directed_to: clientName,
      }
    });

    try {
      const response = await client.chat(this.messages);
      
      // Add assistant response to thread
      this.messages.push({
        id: response.id,
        role: 'assistant',
        content: response.message.content,
        created_at: response.created_at,
        metadata: {
          ...response.message.metadata,
          client_name: clientName,
        }
      });

      return response;
    } catch (error) {
      console.error(`Failed to get response from ${clientName}:`, error);
      return null;
    }
  }

  /**
   * Get the conversation thread as a structured object
   */
  getConversation(): ConversationThread {
    return {
      id: this.id,
      title: this.title,
      messages: this.messages,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: {
        description: this.description,
        client_count: this.clients.size,
        message_count: this.messages.length,
      }
    };
  }

  /**
   * Clear all messages from the thread
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Get all client names in the thread
   */
  getClientNames(): string[] {
    return Array.from(this.clients.keys());
  }
}

export default Thread;