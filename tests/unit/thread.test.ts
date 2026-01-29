import { describe, it, expect } from 'vitest';
import { Thread } from '../../src/thread.js';

describe('Thread', () => {
  it('stores and returns previousResponseId via getter/setter', () => {
    const thread = new Thread();
    expect(thread.previousResponseId).toBeUndefined();

    thread.previousResponseId = 'resp_123';
    expect(thread.previousResponseId).toBe('resp_123');

    thread.previousResponseId = undefined;
    expect(thread.previousResponseId).toBeUndefined();
  });

  it('rejects invalid previousResponseId values', () => {
    const thread = new Thread();
    expect(() => {
      thread.previousResponseId = '';
    }).toThrow('previousResponseId must be a non-empty string.');

    expect(() => {
      thread.previousResponseId = '   ';
    }).toThrow('previousResponseId must be a non-empty string.');
  });

  it('builds request context with previous_response_id when available', () => {
    const thread = new Thread({ previousResponseId: 'resp_abc', history: [] });
    const ctx = thread.buildRequestContextForResponsesAPI([
      { role: 'user', content: 'hello' },
    ]);

    expect(ctx.previous_response_id).toBe('resp_abc');
    expect(ctx.input).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('deduplicates system prompt at the start of history', () => {
    const systemMessage = { role: 'system', content: 'You are helpful.' };
    const thread = new Thread({ history: [systemMessage] });

    const ctx = thread.buildRequestContextForResponsesAPI([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]);

    expect(ctx.input).toEqual([systemMessage, { role: 'user', content: 'Hi' }]);
  });

  it('deduplicates developer prompt at the start of history', () => {
    const devMessage = { role: 'developer', content: 'Follow rules.' };
    const thread = new Thread({ history: [devMessage] });

    const ctx = thread.buildRequestContextForResponsesAPI([
      { role: 'developer', content: 'Follow rules.' },
      { role: 'user', content: 'Hi' },
    ]);

    expect(ctx.input).toEqual([devMessage, { role: 'user', content: 'Hi' }]);
  });

  it('does not deduplicate when the first messages differ', () => {
    const thread = new Thread({
      history: [{ role: 'system', content: 'A' }],
    });

    const ctx = thread.buildRequestContextForResponsesAPI([
      { role: 'system', content: 'B' },
      { role: 'user', content: 'Hi' },
    ]);

    expect(ctx.input).toEqual([
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('serializes and restores thread state', () => {
    const thread = new Thread({
      previousResponseId: 'resp_999',
      history: [{ role: 'user', content: 'Hello' }],
    });

    const snapshot = thread.toJSON();
    const restored = Thread.fromJSON(snapshot);

    expect(restored.previousResponseId).toBe('resp_999');
    expect(restored.getHistory()).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});
