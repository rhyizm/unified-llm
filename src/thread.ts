export type ThreadSnapshot = {
  previousResponseId?: string;
  history: any[];
};

/**
 * Maintain thread state for LLM invocations.
 * Prioritize previousResponseId if present, otherwise uses history to continue the conversation.
 */
export class Thread {
  private previousResponseId?: string;
  private history: any[];

  /**
   * @param options.previousResponseId Previous response ID (used only when available)
   * @param options.history Initial input history
   */
  constructor(options?: { previousResponseId?: string; history?: any[] }) {
    this.previousResponseId = options?.previousResponseId;
    this.history = options?.history ?? [];
  }

  /**
   * Get the current history.
   */
  getHistory(): any[] {
    return this.history;
  }

  /**
   * Replace the entire history.
   */
  setHistory(items: any[]): void {
    this.history = items;
  }

  /**
   * Append elements to the history.
   */
  appendToHistory(items: any[]): void {
    this.history.push(...items);
  }

  /**
   * Build the input and previous_response_id required for the next request.
   */
  buildRequestContextForResponsesAPI(nextInput: any[]): {
    input: any[];
    previous_response_id?: string;
  } {
    const combinedInput = [...this.history, ...nextInput];
    this.history = combinedInput;

    if (this.previousResponseId) {
      return {
        input: combinedInput,
        previous_response_id: this.previousResponseId,
      };
    }

    return { input: combinedInput };
  }

  /**
   * Update the previous_response_id.
   */
  updatePreviousResponseId(responseId?: string): void {
    if (responseId) {
      this.previousResponseId = responseId;
    }
  }

  /**
   * Convert the thread state to a serializable format.
   */
  toJSON(): ThreadSnapshot {
    return {
      previousResponseId: this.previousResponseId,
      history: JSON.parse(JSON.stringify(this.history)),
    };
  }

  /**
   * Restore from a saved thread state.
   */
  static fromJSON(snapshot: ThreadSnapshot): Thread {
    return new Thread({
      previousResponseId: snapshot.previousResponseId,
      history: snapshot.history,
    });
  }
}
