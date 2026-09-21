/**
 * Feed Refresh Bridge Unit Tests
 *
 * Tests the main-thread client that relays feed refresh work to the
 * feed-refresh worker, including the fetch relay: the bridge transfers
 * one half of a MessagePort to the worker and answers the worker's fetch
 * requests through the Electron preload bridge (or plain fetch outside
 * Electron).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Fake Worker stand-in. Each instance records every postMessage it
 * receives (including the fetch-relay transfer list) and replies
 * asynchronously through the handler assigned to FakeWorker.onMessage.
 */
class FakeWorker {
  static instance = null;
  static onMessage = null;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.transferredPorts = [];
    FakeWorker.instance = this;
  }

  postMessage(message, transfer) {
    this.messages.push(message);
    if (Array.isArray(transfer)) {
      this.transferredPorts.push(...transfer);
    }
    const handler = FakeWorker.onMessage || ((m) => (m.action === 'setFetchPort' ? null : { id: m.id, ok: true, result: null }));
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

  it('transfers the fetch relay port to the worker before any refresh', async () => {
    const bridge = await importBridgeModule();
    await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });

    const messages = FakeWorker.instance.messages;
    expect(messages[0].action).toBe('setFetchPort');
    expect(messages[0].id).toBe(0);
    // The port is transferred with the install message, so the worker has
    // the relay before the first refresh message arrives.
    expect(FakeWorker.instance.transferredPorts).toHaveLength(1);
    expect(messages[1].action).toBe('refreshFeed');
  });

  it('reuses the same worker across calls', async () => {
    const bridge = await importBridgeModule();
    await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });
    await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'b' }, maxArticles: 50 });

    // One setFetchPort install + one refreshFeed message per call.
    expect(FakeWorker.instance.messages).toHaveLength(3);
  });

  it('sends the refreshFeed action with params', async () => {
    const bridge = await importBridgeModule();
    await bridge.refreshFeedInWorker({
      feedText: '<rss/>',
      existingFeed: { feedID: 'a', url: 'https://example.com/feed' },
      maxArticles: 25,
    });

    const message = FakeWorker.instance.messages[1];
    expect(message.action).toBe('refreshFeed');
    expect(message.params.feedText).toBe('<rss/>');
    expect(message.params.existingFeed).toEqual({ feedID: 'a', url: 'https://example.com/feed' });
    expect(message.params.maxArticles).toBe(25);
  });

  it('resolves the worker result', async () => {
    FakeWorker.onMessage = (m) => {
      if (m.action === 'setFetchPort') return null;
      return { id: m.id, ok: true, result: { feedID: 'a', lastFetchWasSuccessful: true } };
    };

    const bridge = await importBridgeModule();
    const result = await bridge.refreshFeedInWorker({ existingFeed: { feedID: 'a' }, maxArticles: 50 });

    expect(result).toEqual({ feedID: 'a', lastFetchWasSuccessful: true });
  });

  it('rejects when the worker answers with an error', async () => {
    FakeWorker.onMessage = (m) => {
      if (m.action === 'setFetchPort') return null;
      return { id: m.id, ok: false, error: 'parse failed' };
    };

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

  describe('fetch relay', () => {
    /**
     * Simulate the worker side of the relay for the NEXT refresh call:
     * the worker answers a refreshFeed(fetchFromURL) request by asking
     * the main thread to fetch over the transferred port, then completes
     * the refresh with the fetch outcome. The real `fetch` (or
     * window.electron.fetchText) mock runs inside the bridge's relay
     * handler. Must be installed before starting the refresh, because the
     * fake worker delivers messages synchronously.
     */
    function serveFetches() {
      FakeWorker.onMessage = (m) => {
        if (m.action === 'setFetchPort') return null;
        // The transfer list is recorded before the handler runs, so the
        // relay port is available here.
        const port = FakeWorker.instance.transferredPorts[0];
        // Answer to a relayed fetch request arriving back from the bridge.
        port.onmessage = ({ data }) => {
          if (data.ok) {
            FakeWorker.instance.onmessage({
              data: {
                id: m.id,
                ok: true,
                result: { feedID: m.params.existingFeed.feedID, lastFetchWasSuccessful: true },
              },
            });
          } else {
            FakeWorker.instance.onmessage({ data: { id: m.id, ok: false, error: data.error } });
          }
        };
        // Ask the main thread to fetch, then wait for the port answer.
        port.postMessage({ id: 1, url: m.params.fetchFromURL });
        return null;
      };
    }

    it('answers worker fetch requests through the renderer fetch fallback', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '<rss/>',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const bridge = await importBridgeModule();
      serveFetches();
      const result = await bridge.refreshFeedInWorker({
        fetchFromURL: 'https://example.com/feed',
        existingFeed: { feedID: 'a' },
        maxArticles: 50,
      });

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/feed');
      expect(result).toEqual({ feedID: 'a', lastFetchWasSuccessful: true });
      vi.unstubAllGlobals();
    });

    it('normalizes scheme-less URLs before fetching', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
      vi.stubGlobal('fetch', fetchMock);

      const bridge = await importBridgeModule();
      serveFetches();
      await bridge.refreshFeedInWorker({
        fetchFromURL: 'example.com/feed',
        existingFeed: { feedID: 'a' },
        maxArticles: 50,
      });

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/feed');
      vi.unstubAllGlobals();
    });

    it('reports relay fetch failures back to the worker', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('network unreachable');
      }));

      const bridge = await importBridgeModule();
      serveFetches();
      await expect(bridge.refreshFeedInWorker({
        fetchFromURL: 'https://example.com/feed',
        existingFeed: { feedID: 'a' },
        maxArticles: 50,
      })).rejects.toThrow('network unreachable');
      vi.unstubAllGlobals();
    });

    it('prefers the Electron preload bridge for worker fetches when present', async () => {
      const electronFetch = vi.fn(async () => ({ ok: true, status: 200, text: '<rss/>' }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      vi.stubGlobal('window', { electron: { fetchText: electronFetch } });

      try {
        const bridge = await importBridgeModule();
        serveFetches();
        const result = await bridge.refreshFeedInWorker({
          fetchFromURL: 'https://example.com/feed',
          existingFeed: { feedID: 'a' },
          maxArticles: 50,
        });

        expect(electronFetch).toHaveBeenCalledWith('https://example.com/feed');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result).toEqual({ feedID: 'a', lastFetchWasSuccessful: true });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('falls back to renderer fetch when window.electron lacks fetchText', async () => {
      const electronFetch = vi.fn(async () => ({ ok: true, status: 200, text: '<rss/>' }));
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<rss/>' }));
      vi.stubGlobal('fetch', fetchMock);
      vi.stubGlobal('window', { electron: { openExternal: vi.fn() } });

      try {
        const bridge = await importBridgeModule();
        serveFetches();
        await bridge.refreshFeedInWorker({
          fetchFromURL: 'https://example.com/feed',
          existingFeed: { feedID: 'a' },
          maxArticles: 50,
        });

        expect(fetchMock).toHaveBeenCalled();
        expect(electronFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
