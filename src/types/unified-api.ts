import { ResponseFormat } from '../response-format';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function' | 'developer';

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'tool_use' | 'tool_result' | 'reasoning';

export type ImageSourceType = 'base64' | 'url';

export interface ImageContent {
  type: 'image';
  source: {
    type: ImageSourceType;
    mediaType?: string;
    data?: string;
    url?: string;
  };
  altText?: string;
}

export interface BaseContent {
  type: ContentType;
  id?: string;
  role?: MessageRole;
  name?: string;
  text?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface FileContent {
  type: 'file';
  fileType: string;
  name?: string;
  source: {
    type: 'base64' | 'url' | 'file_id';
    data?: string;
    url?: string;
    fileId?: string;
  };
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  isError?: boolean;
  content?: Array<TextContent | ImageContent>;
}

export interface AudioContent {
  type: 'audio';
  source: {
    type: 'base64' | 'url';
    mediaType?: string;
    data?: string;
    url?: string;
  };
  transcript?: string;
}

export interface VideoContent {
  type: 'video';
  source: {
    type: 'base64' | 'url';
    mediaType?: string;
    data?: string;
    url?: string;
  };
  thumbnail?: ImageContent;
}

export type MessageContent = 
  | TextContent 
  | ImageContent 
  | AudioContent 
  | VideoContent 
  | FileContent 
  | ToolUseContent 
  | ToolResultContent;

export interface Message {
  id: string;
  role: MessageRole;
  content: MessageContent[] | string;
  name?: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface Tool<TArgs = any, TResult = any> extends ToolDefinition {
  handler: (args: TArgs) => Promise<TResult | null>;
  args?: any;
}

export const defineTool = <
  T extends { handler: (args: any) => Promise<any> } & ToolDefinition
>(
  tool: T
): Tool<
  // handler の第 1 引数
  Parameters<T['handler']>[0],
  // handler の戻り値 (Promise を外す)
  Awaited<ReturnType<T['handler']>>
> => tool as any;

export interface GenerationConfig {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  stopSequences?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  responseFormat?: {
    type: 'text' | 'json_object';
    schema?: Record<string, unknown>;
  } | ResponseFormat;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
}

export interface SafetySetting {
  category: string;
  threshold: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
}

export interface ProviderSpecificConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'deepseek';
  openai?: {
    organization?: string;
    responseFormat?: { type: 'json_object' };
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  };
  anthropic?: {
    anthropicVersion?: string;
    metadata?: { userId?: string };
    thinkingBudget?: number;
  };
  google?: {
    safetySettings?: SafetySetting[];
    generation_config?: {
      candidateCount?: number;
      stopSequences?: string[];
    };
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: Date;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: MessageRole;
      content?: string | MessageContent[];
      toolCalls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
}

export interface UnifiedChatRequest {
  messages: Message[];
  model?: string;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  generationConfig?: GenerationConfig;
  providerConfig?: ProviderSpecificConfig;
}

export interface UnifiedError {
  code: string;
  message: string;
  type: 'api_error' | 'rate_limit' | 'invalid_request' | 'authentication' | 'server_error';
  statusCode?: number;
  provider?: string;
  details?: unknown;
}

export interface UnifiedChatResponse {
  id: string;
  model: string;
  provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'deepseek';
  message: Message;
  text: string;
  usage?: UsageStats;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  createdAt: Date;
  rawResponse?: unknown;
}

// Unified streaming event model (docs/streaming-unification.md)
export type StreamEventType =
  | 'start'
  | 'text_delta'
  | 'stop'
  | 'error';

export type StreamDelta =
  | { type: 'text'; text: string }
  | { type: 'error'; code: string; message: string; errType?: string; details?: unknown };

export type UnifiedStreamEventResponse = Omit<UnifiedChatResponse, 'createdAt'> & {
  createdAt?: Date;
  eventType: StreamEventType;
  outputIndex: number;
  delta?: StreamDelta;
};
