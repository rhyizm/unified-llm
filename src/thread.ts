export type ThreadSnapshot = {
  previousResponseId?: string;
  history: any[];
};

/**
 * Maintain thread state for LLM invocations.
 * Prioritize previousResponseId if present, otherwise uses history to continue the conversation.
 */
export class Thread {
  private _previousResponseId?: string;
  private history: any[];

  /**
   * @param options.previousResponseId Previous response ID (used only when available)
   * @param options.history Initial input history
   */
  constructor(options?: { previousResponseId?: string; history?: any[] }) {
    this._previousResponseId = options?.previousResponseId;
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
    let normalizedNextInput = nextInput;
    if (
      Array.isArray(this.history) &&
      this.history.length > 0 &&
      Array.isArray(nextInput) &&
      nextInput.length > 0
    ) {
      const historyFirst = this.history[0];
      const nextFirst = nextInput[0];
      const isSystemLike = (role: unknown) => role === 'system' || role === 'developer';
      if (
        historyFirst &&
        nextFirst &&
        isSystemLike(historyFirst.role) &&
        isSystemLike(nextFirst.role)
      ) {
        try {
          if (JSON.stringify(historyFirst) === JSON.stringify(nextFirst)) {
            normalizedNextInput = nextInput.slice(1);
          }
        } catch {
          // ignore JSON stringify errors and keep original input
        }
      }
    }

    const combinedInput = [...this.history, ...normalizedNextInput];
    this.history = combinedInput;

    if (this._previousResponseId) {
      return {
        input: combinedInput,
        previous_response_id: this._previousResponseId,
      };
    }

    return { input: combinedInput };
  }

  /**
   * Update the previous_response_id.
   */
  updatePreviousResponseId(responseId?: string): void {
    if (responseId) {
      this._previousResponseId = responseId;
    }
  }

  /**
   * Convert the thread state to a serializable format.
   */
  toJSON(): ThreadSnapshot {
    return {
      previousResponseId: this._previousResponseId,
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

  get previousResponseId(): string | undefined {
    return this._previousResponseId;
  }

  set previousResponseId(value: string | undefined) {
    if (value === undefined) {
      this._previousResponseId = undefined;
      return;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('previousResponseId must be a non-empty string.');
    }
    this._previousResponseId = value;
  }
}
