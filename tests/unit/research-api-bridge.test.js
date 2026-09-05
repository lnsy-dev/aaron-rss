/**
 * Research API Bridge Unit Tests
 *
 * Tests src/lib/research-api-bridge.js — the renderer-side handler that
 * maps main-process API queries onto the database helpers. The database
 * module is mocked; window.electron is stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/database.js', () => ({
  listResearchTopics: vi.fn(),
  listFeedArticles: vi.fn(),
  listResearchTopicArticles: vi.fn(),
  getArticleMarkdown: vi.fn(),
  getFeedName: vi.fn(),
}));

import {
  listResearchTopics,
  listFeedArticles,
  listResearchTopicArticles,
  getArticleMarkdown,
  getFeedName,
} from '../../src/lib/database.js';

/** Captured handler registered on the fake electron bridge. */
let registeredHandler = null;

async function importBridgeModule() {
  return await import('../../src/lib/research-api-bridge.js');
}

describe('research api bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandler = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unavailability without the Electron bridge', async () => {
    const bridge = await importBridgeModule();
    expect(bridge.isResearchApiBridgeAvailable()).toBe(false);
    expect(bridge.registerResearchApiBridge()).toBe(false);
    expect(registeredHandler).toBeNull();
  });

  it('registers a handler when the Electron bridge exists', async () => {
    vi.stubGlobal('window', {
      electron: {
        onResearchApiQuery: (handler) => {
          registeredHandler = handler;
        },
      },
    });

    const bridge = await importBridgeModule();
    expect(bridge.registerResearchApiBridge()).toBe(true);
    expect(registeredHandler).toBeTypeOf('function');
  });

  it('answers listResearchTopics queries', async () => {
    vi.stubGlobal('window', {
      electron: { onResearchApiQuery: (handler) => { registeredHandler = handler; } },
    });
    const topics = [{ topicID: 't1', name: 'T', feeds: [] }];
    listResearchTopics.mockResolvedValue(topics);

    const bridge = await importBridgeModule();
    bridge.registerResearchApiBridge();

    await expect(registeredHandler({ type: 'listResearchTopics', params: {} })).resolves.toBe(topics);
  });

  it('answers getResearchTopic with the topic or null', async () => {
    vi.stubGlobal('window', {
      electron: { onResearchApiQuery: (handler) => { registeredHandler = handler; } },
    });
    const topic = { topicID: 't1', name: 'T', feeds: [] };
    listResearchTopics.mockResolvedValue([topic]);

    const bridge = await importBridgeModule();
    bridge.registerResearchApiBridge();

    await expect(registeredHandler({ type: 'getResearchTopic', params: { topicID: 't1' } }))
      .resolves.toBe(topic);
    await expect(registeredHandler({ type: 'getResearchTopic', params: { topicID: 'nope' } }))
      .resolves.toBeNull();
  });

  it('answers getResearchTopicArticles with topic header and articles', async () => {
    vi.stubGlobal('window', {
      electron: { onResearchApiQuery: (handler) => { registeredHandler = handler; } },
    });
    const topic = { topicID: 't1', name: 'Topic', summary: 'What it tracks', feeds: [] };
    const articles = [{ articleID: 'a1', markdownReady: true }];
    listResearchTopics.mockResolvedValue([topic]);
    listResearchTopicArticles.mockResolvedValue(articles);

    const bridge = await importBridgeModule();
    bridge.registerResearchApiBridge();

    await expect(registeredHandler({ type: 'getResearchTopicArticles', params: { topicID: 't1' } }))
      .resolves.toEqual({ topicID: 't1', name: 'Topic', summary: 'What it tracks', articles });
    // Unknown topic maps to null, which the server turns into a 404.
    await expect(registeredHandler({ type: 'getResearchTopicArticles', params: { topicID: 'nope' } }))
      .resolves.toBeNull();
  });

  it('answers getFeedArticles with name and articles, null for unknown feeds', async () => {
    vi.stubGlobal('window', {
      electron: { onResearchApiQuery: (handler) => { registeredHandler = handler; } },
    });
    listFeedArticles.mockResolvedValue([{ articleID: 'a1' }]);
    getFeedName.mockResolvedValue('Example Feed');

    const bridge = await importBridgeModule();
    bridge.registerResearchApiBridge();

    // Known feed (even without articles) resolves to a result object.
    await expect(registeredHandler({ type: 'getFeedArticles', params: { feedID: 'f1' } }))
      .resolves.toEqual({ feedID: 'f1', name: 'Example Feed', articles: [{ articleID: 'a1' }] });
    expect(listFeedArticles).toHaveBeenCalledWith('f1');

    // Unknown feed resolves to null.
    getFeedName.mockResolvedValue(null);
    await expect(registeredHandler({ type: 'getFeedArticles', params: { feedID: 'nope' } }))
      .resolves.toBeNull();
  });

  it('answers getArticleMarkdown with raw markdown or null', async () => {
    vi.stubGlobal('window', {
      electron: { onResearchApiQuery: (handler) => { registeredHandler = handler; } },
    });
    getArticleMarkdown.mockResolvedValue({ markdown: '# Ready', scrapedAt: 't' });

    const bridge = await importBridgeModule();
    bridge.registerResearchApiBridge();

    await expect(registeredHandler({ type: 'getArticleMarkdown', params: { feedID: 'f1', articleID: 'a1' } }))
      .resolves.toBe('# Ready');

    getArticleMarkdown.mockResolvedValue(null);
    await expect(registeredHandler({ type: 'getArticleMarkdown', params: { feedID: 'f1', articleID: 'a2' } }))
      .resolves.toBeNull();
  });

  it('rejects unknown query types so the server answers 500', async () => {
    vi.stubGlobal('window', {
      electron: { onResearchApiQuery: (handler) => { registeredHandler = handler; } },
    });

    const bridge = await importBridgeModule();
    bridge.registerResearchApiBridge();

    await expect(registeredHandler({ type: 'dropTables', params: {} })).rejects.toThrow(
      'Unknown research API query type'
    );
  });
});
