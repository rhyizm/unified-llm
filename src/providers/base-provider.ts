import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  MessageContent,
  ToolUseContent,
  Tool,
} from '../types/unified-api';

// 抽象基底クラス
abstract class BaseProvider {
  protected model: string | undefined;
  protected tools?: Tool[];
  
  // Public getter for model
  public get modelName(): string | undefined {
    return this.model;
  }
  
  constructor({ model, tools }: { model?: string, tools?: Tool[] }) {
    this.model = model || undefined;
    this.tools = tools;
  }
  
  abstract chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  abstract stream(request: UnifiedChatRequest): AsyncIterableIterator<UnifiedChatResponse>;
  
  // 共通のヘルパーメソッド
  protected generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  protected normalizeContent(content: MessageContent[] | string): MessageContent[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }
    return content;
  }

  // ツール呼び出しがあるかチェック
  protected hasToolCalls(content: MessageContent[]): boolean {
    return content.some(c => c.type === 'tool_use');
  }

  // ツール呼び出しを抽出
  protected extractToolCalls(content: MessageContent[]): ToolUseContent[] {
    return content.filter(c => c.type === 'tool_use') as ToolUseContent[];
  }
}

export default BaseProvider;