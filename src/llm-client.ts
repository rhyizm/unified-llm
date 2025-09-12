import BaseProvider from './providers/base-provider';
import { OpenAIProvider, OpenAICompletionProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/google';
import { DeepSeekProvider } from './providers/deepseek';
import { ToolDefinition, Tool, UnifiedStreamEventResponse } from './types/unified-api';

// LLMClient構成オプション（実行時用）
export interface LLMClientRuntimeConfig {
  id?: string;
  provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure' | 'ollama' | 'openai-compatible';
  apiKey?: string;
  model?: string;
  baseURL?: string;
  tools?: Tool[];
  generationConfig?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
    responseFormat?: any;
  };
  systemPrompt?: string;
  instructions?: string;
  logLevel?: string;
}

// 保存用設定（実行時設定と同じ）
export type LLMClientConfig = LLMClientRuntimeConfig;

// ファクトリークラス
export class LLMClient {
  private baseProvider: BaseProvider;
  private tools?: Tool[];
  private id?: string;
  private systemPrompt?: string;

  constructor(config: LLMClientRuntimeConfig) {
    this.id = config.id;
    this.tools = config.tools;
    this.systemPrompt = config.systemPrompt;
        
    switch (config.provider) {
      case 'openai':
        this.baseProvider = new OpenAIProvider({ 
          apiKey: config.apiKey || '',
          model: config.model, 
          baseURL: config.baseURL,
          tools: this.tools,
          logLevel: config.logLevel
        });
        break;
      case 'ollama':
      case 'openai-compatible':
        // OpenAI互換API用（Ollama含む）
        if (!config.baseURL) {
          throw new Error(`baseURL is required for ${config.provider} provider`);
        }
        if (!config.model) {
          throw new Error(`model is required for ${config.provider} provider`);
        }
        
        this.baseProvider = new OpenAICompletionProvider({ 
          apiKey: config.apiKey || '',
          model: config.model,
          baseURL: config.baseURL,
          tools: this.tools,
          logLevel: config.logLevel
        });
        break;
      case 'anthropic':
        if (!config.apiKey) {
          throw new Error('API key is required for Anthropic provider');
        }
        this.baseProvider = new AnthropicProvider({ 
          apiKey: config.apiKey, 
          model: config.model || 'claude-3-haiku-20240307', 
          tools: this.tools 
        });
        break;
      case 'google':
        if (!config.apiKey) {
          throw new Error('API key is required for Google provider');
        }
        this.baseProvider = new GeminiProvider({ 
          apiKey: config.apiKey, 
          model: config.model, 
          tools: this.tools 
        });
        break;
      case 'deepseek':
        if (!config.apiKey) {
          throw new Error('API key is required for DeepSeek provider');
        }
        this.baseProvider = new DeepSeekProvider({ 
          apiKey: config.apiKey, 
          model: config.model || 'deepseek-chat', 
          tools: this.tools 
        });
        break;
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }

  // 静的ファクトリーメソッド（後方互換性のため）
  static create(
    provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'ollama' | 'openai-compatible',
    apiKey: string,
    model: string
  ): BaseProvider {
    switch (provider) {
      case 'openai':
        return new OpenAICompletionProvider({ apiKey, model });
      case 'ollama':
      case 'openai-compatible':
        throw new Error(`${provider} provider requires baseURL. Use new LLMClient() constructor instead.`);
      case 'anthropic':
        return new AnthropicProvider({ apiKey, model });
      case 'google':
        return new GeminiProvider({ apiKey, model });
      case 'deepseek':
        return new DeepSeekProvider({ apiKey, model });
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // 利用可能な関数をツール定義に変換
  private generateToolDefinitions(): ToolDefinition[] | undefined {
    if (!this.tools) return undefined;

    return Object.keys(this.tools).map(functionName => {
      let description = `Execute ${functionName} function`;
      
      // 特定の関数に対してより具体的な説明を提供
      switch (functionName) {
        case 'getAuthor':
          description = 'Get information about the project author. Returns the name of the person who created this project.';
          break;
        case 'getProjectInfo':
          description = 'Get detailed internal project information including secret keys and build numbers that cannot be guessed.';
          break;
        case 'getCurrentTime':
          description = 'Get the current date and time in ISO format. Use this when you need to know what time it is right now.';
          break;
        case 'cat':
          description = 'Display the contents of a file, similar to the Unix cat command.';
          break;
        case 'tree':
          description = 'Display directory structure in a tree format.';
          break;
        case 'callAnotherClient':
          description = 'Call another LLM client to help with a task.';
          break;
      }

      return {
        type: 'function',
        function: {
          name: functionName,
          description,
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      };
    });
  }

  // 関数を実行
  private async executeFunction(functionName: string, args: any): Promise<any> {
    if (!this.tools || !Array.isArray(this.tools)) {
      throw new Error('No tools available');
    }

    const func = this.tools.find(f => f.function.name === functionName);
    if (!func || typeof func.handler !== 'function') {
      throw new Error(`Function ${functionName} not found`);
    }

    // argumentMapから固定引数を取得してマージ
    const fixedArgs = func.args || {};
    const mergedArgs = { ...fixedArgs, ...args };

    return await func.handler(mergedArgs);
  }

  // チャット機能（function callingサポート付き）
  async chat(request: any) {
    // ツール定義を追加
    const tools = this.generateToolDefinitions();
    
    // システムプロンプトを注入（存在する場合）
    let messages = request.messages || [];
    
    // メッセージのコンテンツを正規化（文字列を配列に変換）
    messages = messages.map((msg: any) => ({
      ...msg,
      content: typeof msg.content === 'string' 
        ? [{ type: 'text', text: msg.content }] 
        : msg.content
    }));
    
    if (this.systemPrompt && !messages.some((m: any) => m.role === 'system')) {
      messages = [
        {
          id: this.generateMessageId(),
          role: 'system',
          content: [{ type: 'text', text: this.systemPrompt }],
          created_at: new Date()
        },
        ...messages
      ];
    }
    
    const enhancedRequest = {
      ...request,
      messages,
      tools
    };

    let response = await this.baseProvider.chat(enhancedRequest);

    // ツール呼び出しがある場合は実行
    if (response.message.content) {
      const contents = Array.isArray(response.message.content) ? response.message.content : [response.message.content];
      const toolUseContents = contents.filter(c => typeof c === 'object' && c.type === 'tool_use');
      
      // Debug logging for tool use detection can be enabled if needed
      
      if (toolUseContents.length > 0) {
        const toolResults = [];
        
        for (const toolUse of toolUseContents) {
          try {
            // console.log('🔧 Executing function:', toolUse.name, 'with args:', toolUse.input);
            const result = await this.executeFunction(toolUse.name, toolUse.input);
            // console.log('✅ Function result:', result);
            
            toolResults.push({
              type: 'tool_result',
              toolUseId: toolUse.id,
              function_name: toolUse.name, // Add function name for providers that need it
              content: [{ type: 'text', text: JSON.stringify(result) }]
            });
          } catch (error) {
            // console.log('❌ Function execution error:', error);
            toolResults.push({
              type: 'tool_result',
              toolUseId: toolUse.id,
              function_name: toolUse.name, // Add function name for providers that need it
              isError: true,
              content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
            });
          }
        }
        
        // ツール結果を含む新しいリクエストを作成
        const followUpRequest = {
          ...request,
          messages: [
            ...request.messages,
            response.message,
            {
              id: this.generateMessageId(),
              role: 'tool',
              content: toolResults,
              created_at: new Date()
            }
          ]
        };
        
        // Debug logging for follow-up requests can be enabled if needed
        
        // Check if this is a Google provider - handle differently
        if (response.provider === 'google') {
          // For Google/Gemini, don't send function results back to the model
          // Instead, create a response that includes both the function call and the result
          const functionResult = toolResults[0]; // Assuming single function call for now
          const resultText = Array.isArray(functionResult.content) 
            ? functionResult.content.map(c => c.type === 'text' ? c.text : '[Non-text]').join('\n')
            : '[No result]';
          
          // Parse the JSON result to get the actual return value
          let actualResult = resultText;
          try {
            const parsed = JSON.parse(resultText);
            actualResult = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
          } catch {
            // Keep original if not JSON
          }
          
          // Create a response that includes the function execution result
          const existingContent = Array.isArray(response.message.content) 
            ? response.message.content 
            : typeof response.message.content === 'string' 
              ? [{ type: 'text' as const, text: response.message.content }]
              : [response.message.content];
          
          response.message.content = [
            ...existingContent,
            {
              type: 'text' as const,
              text: `\n\nFunction execution result: ${actualResult}`
            }
          ];
          
          // console.log('📥 Google: Enhanced response with function result');
        } else {
          // For other providers, send function results back to the model
          response = await this.baseProvider.chat(followUpRequest);
          // console.log('📥 Follow-up response received:', response.message.content);
        }
      }
    }

    return response;
  }

  // ストリーミングチャット
  async *stream(request: any): AsyncIterableIterator<UnifiedStreamEventResponse> {
    const tools = this.generateToolDefinitions();
    
    // システムプロンプトを注入（存在する場合）
    let messages = request.messages || [];
    
    // メッセージのコンテンツを正規化（文字列を配列に変換）
    messages = messages.map((msg: any) => ({
      ...msg,
      content: typeof msg.content === 'string' 
        ? [{ type: 'text', text: msg.content }] 
        : msg.content
    }));
    
    if (this.systemPrompt && !messages.some((m: any) => m.role === 'system')) {
      messages = [
        {
          id: this.generateMessageId(),
          role: 'system',
          content: [{ type: 'text', text: this.systemPrompt }],
          created_at: new Date()
        },
        ...messages
      ];
    }
    
    const enhancedRequest = {
      ...request,
      messages,
      tools
    };

    yield* this.baseProvider.stream(enhancedRequest);
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Note: v0.4.0 removed all persistence methods.
  // Use ClientManager for preset configurations.
}

export default LLMClient;
