/**
 * Research API Server Unit Tests
 *
 * Tests electron/research-api.js — the read-only localhost HTTP server
 * that exposes Research Topics to other applications. The server is
 * driven with real HTTP requests in Node; the injected `query` function
 * (wired to the renderer over IPC in production) is faked here.
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  createResearchApiServer,
  markdownPath,
  RESEARCH_API_HOST,
} from '../../electron/research-api.js';

/** Servers started during a test, stopped afterwards. */
const runningServers = [];

afterAll(async () => {
  await Promise.all(runningServers.map((server) => server.stop()));
});

/**
 * Start a server with the given fake query function on an ephemeral
 * port and return a base URL for requests plus the server handle.
 *
 * @param {Function} query - Fake query implementation
 * @returns {Promise<{server: object, baseUrl: string}>}
 */
async function startServer(query) {
  const server = createResearchApiServer({
    query,
    host: RESEARCH_API_HOST,
    port: 0,
    log: () => {},
  });
  const { port } = await server.start();
  runningServers.push(server);
  return { server, baseUrl: `http://${RESEARCH_API_HOST}:${port}` };
}

describe('research api server', () => {
  it('answers the health check', async () => {
    const { baseUrl } = await startServer(async () => {
      throw new Error('should not be queried');
    });

    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ ok: true, service: 'aaron-rss-research-api' });
  });

  it('lists research topics from the query result', async () => {
    const topics = [{ topicID: 't1', name: 'Topic', feeds: [] }];
    const { baseUrl } = await startServer(async ({ type }) => {
      expect(type).toBe('listResearchTopics');
      return topics;
    });

    const response = await fetch(`${baseUrl}/api/research-topics`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ topics });
  });

  it('serves a single topic when the query finds it', async () => {
    const topic = { topicID: 't1', name: 'Topic', feeds: [] };
    const { baseUrl } = await startServer(async ({ type, params }) => {
      expect(type).toBe('getResearchTopic');
      expect(params).toEqual({ topicID: 't1' });
      return topic;
    });

    const response = await fetch(`${baseUrl}/api/research-topics/t1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ topic });
  });

  it('returns 404 for an unknown topic', async () => {
    const { baseUrl } = await startServer(async () => null);

    const response = await fetch(`${baseUrl}/api/research-topics/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Research topic not found' });
  });

  it('serves topic articles with markdownUrl decorated onto each article', async () => {
    const { baseUrl } = await startServer(async ({ type, params }) => {
      expect(type).toBe('getResearchTopicArticles');
      expect(params).toEqual({ topicID: 't1' });
      return {
        topicID: 't1',
        name: 'Topic',
        summary: 'What it tracks',
        articles: [
          { feedID: 'f1', articleID: 'a1', title: 'Ready', markdownReady: true },
          { feedID: 'f2', articleID: 'a2', title: 'Pending', markdownReady: false },
        ],
      };
    });

    const response = await fetch(`${baseUrl}/api/research-topics/t1/articles`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.topicID).toBe('t1');
    expect(body.name).toBe('Topic');
    expect(body.summary).toBe('What it tracks');
    expect(body.articles[0].markdownUrl).toBe('/api/feeds/f1/articles/a1/markdown');
    expect(body.articles[1].markdownUrl).toBe('/api/feeds/f2/articles/a2/markdown');
  });

  it('serves a single feed with markdownUrl decoration', async () => {
    const { baseUrl } = await startServer(async ({ type, params }) => {
      expect(type).toBe('getFeedArticles');
      expect(params).toEqual({ feedID: 'f1' });
      return { feedID: 'f1', name: 'Feed', articles: [{ feedID: 'f1', articleID: 'a1' }] };
    });

    const response = await fetch(`${baseUrl}/api/feeds/f1/articles`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe('Feed');
    expect(body.articles[0].markdownUrl).toBe('/api/feeds/f1/articles/a1/markdown');
  });

  it('returns 404 for an unknown feed', async () => {
    const { baseUrl } = await startServer(async () => null);

    const response = await fetch(`${baseUrl}/api/feeds/missing/articles`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Feed not found' });
  });

  it('serves ready markdown as text/markdown (vkv5tc)', async () => {
    const { baseUrl } = await startServer(async ({ type, params }) => {
      expect(type).toBe('getArticleMarkdown');
      expect(params).toEqual({ feedID: 'f1', articleID: 'a1' });
      return '# Hello\n\nScraped content.';
    });

    const response = await fetch(`${baseUrl}/api/feeds/f1/articles/a1/markdown`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toBe('# Hello\n\nScraped content.');
  });

  it('returns 404 when the markdown is not ready yet', async () => {
    const { baseUrl } = await startServer(async () => null);

    const response = await fetch(`${baseUrl}/api/feeds/f1/articles/a9/markdown`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Markdown is not ready for this article' });
  });

  it('returns 404 for unknown routes and 405 for non-GET methods', async () => {
    const { baseUrl } = await startServer(async () => ({}));

    const notFound = await fetch(`${baseUrl}/nope`);
    expect(notFound.status).toBe(404);

    const post = await fetch(`${baseUrl}/api/research-topics`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(await post.json()).toEqual({ error: 'Method not allowed' });
  });

  it('answers CORS preflight requests', async () => {
    const { baseUrl } = await startServer(async () => ({}));

    const response = await fetch(`${baseUrl}/api/research-topics`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('maps query failures to a 500 JSON error', async () => {
    const { baseUrl } = await startServer(async () => {
      throw new Error('renderer is gone');
    });

    const response = await fetch(`${baseUrl}/api/research-topics`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('binds to the requested host only', async () => {
    const { server } = await startServer(async () => ({}));
    const address = server.server.address();
    expect(address.address).toBe('127.0.0.1');
  });

  it('builds encoded markdown paths', () => {
    expect(markdownPath('feed/1', 'art 2')).toBe('/api/feeds/feed%2F1/articles/art%202/markdown');
  });
});
