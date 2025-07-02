// DeepSeek-specific types

export interface DeepSeekChatCompletionRequest {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  tools?: DeepSeekTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | DeepSeekMessageContent[];
  name?: string;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
}

export interface DeepSeekMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface DeepSeekTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface DeepSeekToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface DeepSeekChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage?: DeepSeekUsage;
}

export interface DeepSeekChoice {
  index: number;
  message: DeepSeekResponseMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface DeepSeekResponseMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
}

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekStreamChoice[];
}

export interface DeepSeekStreamChoice {
  index: number;
  delta: DeepSeekStreamDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface DeepSeekStreamDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: DeepSeekToolCall[];
}