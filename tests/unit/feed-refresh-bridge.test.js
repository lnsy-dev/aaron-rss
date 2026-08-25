/**
 * Feed Refresh Bridge Unit Tests
 *
 * Tests the main-thread client that relays feed refresh work to the
 * feed-refresh worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Fake Worker stand-in. Each instance records every postMessage it
 * receives and replies asynchronously through the handler assigned to
 * FakeWorker.onMessage.
 */
class FakeWorker {
  static instance = null;
  static onMessage = null;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    FakeWorker.instance = this;
  }

  postMessage(message) {
    this.messages.push(message);
    const handler = FakeWorker.onMessage || ((m) => ({ id: m.id, ok: true, result: null }));
    const response = handler(message, this);
    if (response) {
      queueMicrotask(() => this.onmessage?.({ data: response }));
    }
  }
}

/** @returns {Promise<object>} The freshly imported bridge module */
async function importBridgeModule() {
  return await import('../../src/lib/feed-refresh-bridge.js');
}

describe('feed refresh bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instance = null;
    FakeWorker.onMessage = null;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a module worker for the feed refresh script', async () => {
    const bridge = await importBridgeModule();
    await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });

    expect(FakeWorker.instance).not.toBeNull();
    expect(FakeWorker.instance.options).toEqual({ type: 'module' });
  });

  it('reuses the same worker across calls', async () => {
    const bridge = await importBridgeModule();
    await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });
    await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'b' }, maxArticles: 50 });

    expect(FakeWorker.instance.messages).toHaveLength(2);
  });

  it('sends the refreshFeed action with params', async () => {
    const bridge = await importBridgeModule();
    await bridge.refreshFeedInWorker({
      feedText: '<rss/>',
      existingFeed: { feedID: 'a', url: 'https://example.com/feed' },
      maxArticles: 25,
    });

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('refreshFeed');
    expect(message.params.feedText).toBe('<rss/>');
    expect(message.params.existingFeed).toEqual({ feedID: 'a', url: 'https://example.com/feed' });
    expect(message.params.maxArticles).toBe(25);
  });

  it('resolves the worker result', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: { feedID: 'a', lastFetchWasSuccessful: true },
    });

    const bridge = await importBridgeModule();
    const result = await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });

    expect(result).toEqual({ feedID: 'a', lastFetchWasSuccessful: true });
  });

  it('rejects when the worker answers with an error', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: false, error: 'parse failed' });

    const bridge = await importBridgeModule();
    await expect(bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 }))
      .rejects.toThrow('parse failed');
  });

  it('rejects all pending requests when the worker errors catastrophically', async () => {
    FakeWorker.onMessage = () => null; // never answers

    const bridge = await importBridgeModule();
    const pending = bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });
    const assertion = expect(pending).rejects.toThrow('Feed refresh worker error: boom');

    FakeWorker.instance.onerror?.({ message: 'boom' });
    await assertion;
  });

  it('rejects and cleans up pending requests that time out', async () => {
    vi.useFakeTimers();
    FakeWorker.onMessage = () => null; // never answers

    try {
      const bridge = await importBridgeModule();
      const pending = bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });

      vi.advanceTimersByTime(120001);

      await expect(pending).rejects.toThrow('timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});
