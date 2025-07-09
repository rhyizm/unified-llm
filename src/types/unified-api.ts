export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function' | 'developer';

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'tool_use' | 'tool_result';

export type ImageSourceType = 'base64' | 'url';

export interface ImageContent {
  type: 'image';
  source: {
    type: ImageSourceType;
    media_type?: string;
    data?: string;
    url?: string;
  };
  alt_text?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface FileContent {
  type: 'file';
  file_type: string;
  name?: string;
  source: {
    type: 'base64' | 'url' | 'file_id';
    data?: string;
    url?: string;
    file_id?: string;
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
  tool_use_id: string;
  is_error?: boolean;
  content?: Array<TextContent | ImageContent>;
}

export interface AudioContent {
  type: 'audio';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
  transcript?: string;
}

export interface VideoContent {
  type: 'video';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
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
  created_at: Date;
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
  stop_sequences?: string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: {
    type: 'text' | 'json_object';
    schema?: Record<string, unknown>;
  };
}

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  reasoning_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: Date;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
    logprobs?: unknown;
  }>;
  usage?: UsageStats;
  system_fingerprint?: string;
}

export interface ConversationThread {
  id: string;
  title?: string;
  messages: Message[];
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
  config?: ConversationConfig;
}

export interface ConversationConfig {
  model: string;
  system_prompt?: string;
  tools?: ToolDefinition[];
  generation_config?: GenerationConfig;
  safety_settings?: SafetySetting[];
}

export interface SafetySetting {
  category: string;
  threshold: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
}

export interface ProviderSpecificConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'deepseek';
  openai?: {
    organization?: string;
    response_format?: { type: 'json_object' };
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  };
  anthropic?: {
    anthropic_version?: string;
    metadata?: { user_id?: string };
    thinking_budget?: number;
  };
  google?: {
    safety_settings?: SafetySetting[];
    generation_config?: {
      candidate_count?: number;
      stop_sequences?: string[];
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
      tool_calls?: Array<{
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
  generation_config?: GenerationConfig;
  provider_config?: ProviderSpecificConfig;
}

export type ConvertToProviderFormat<T> = (request: UnifiedChatRequest) => T;
export type ConvertFromProviderFormat<T> = (response: T) => ChatCompletionResponse;

export interface UnifiedError {
  code: string;
  message: string;
  type: 'api_error' | 'rate_limit' | 'invalid_request' | 'authentication' | 'server_error';
  status_code?: number;
  provider?: string;
  details?: unknown;
}

export interface UnifiedChatResponse {
  id: string;
  model: string;
  provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'deepseek';
  message: Message;
  usage?: UsageStats;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  created_at: Date;
  raw_response?: unknown;
}