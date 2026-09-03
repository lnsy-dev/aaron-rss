/**
 * Research Topics Watch API
 *
 * A small read-only localhost HTTP server that lets other applications
 * watch the app's Research Topics: the topic list, the member feeds with
 * their scrape status, the articles of a topic or a single feed, and the
 * fully scraped markdown of any article whose scrape is ready.
 *
 * The SQLite database lives in the renderer (sqlite-wasm + OPFS), so the
 * server never touches data directly. Every request is answered by an
 * injected async `query({ type, params })` function — main.js wires that
 * to the renderer over IPC.
 *
 * This module deliberately imports nothing from Electron so it can be
 * unit tested in Node with real HTTP requests. main.js wires it up after
 * the window exists.
 */

import http from 'node:http';

/** Default bind address: only local processes may watch the topics. */
export const RESEARCH_API_HOST = '127.0.0.1';

/** Shared CORS headers so browser-based tools on other origins can read. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/**
 * The API surface, described for humans. main.js reports this to the
 * renderer so the Research Topics view can show watchable endpoints.
 *
 * @type {Array<{method: string, path: string, description: string}>}
 */
export const API_ENDPOINTS = [
  { method: 'GET', path: '/api/research-topics', description: 'List every research topic with its member feeds and scrape status' },
  { method: 'GET', path: '/api/research-topics/{topicID}', description: 'One research topic with its member feeds' },
  { method: 'GET', path: '/api/research-topics/{topicID}/articles', description: 'Every article in a topic, newest first, with markdownReady flags' },
  { method: 'GET', path: '/api/feeds/{feedID}/articles', description: 'Every article of one feed, newest first, with markdownReady flags' },
  { method: 'GET', path: '/api/feeds/{feedID}/articles/{articleID}/markdown', description: 'The fully scraped markdown of an article, when ready' },
  { method: 'GET', path: '/api/health', description: 'Availability check' },
];

/**
 * Serialize and send a JSON response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...CORS_HEADERS,
  });
  res.end(data);
}

/**
 * Create the watch API server.
 *
 * @param {object} options
 * @param {({type: string, params: object}) => Promise<unknown>} options.query
 *   Answers API queries against the app database (wired to the renderer
 *   over IPC by main.js). Unknown query types should reject.
 * @param {string} [options.host] - Bind address (default: 127.0.0.1)
 * @param {number} [options.port] - Bind port (default: ephemeral)
 * @param {(message: string) => void} [options.log]
 * @returns {{start: () => Promise<{host: string, port: number}>, stop: () => Promise<void>, get port(): number|null}}
 */
export function createResearchApiServer({ query, host = RESEARCH_API_HOST, port = 0, log = () => {} } = {}) {
  if (typeof query !== 'function') {
    throw new Error('createResearchApiServer requires a query function');
  }

  /**
   * Dispatch one request. Route matches below are the whole API surface;
   * everything else is a 404.
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<void>}
   */
  async function dispatch(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // Browser-based consumers on other origins send a preflight first.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...CORS_HEADERS,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // The API is read-only.
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (path === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'aaron-rss-research-api' });
      return;
    }

    if (path === '/api/research-topics') {
      const topics = await query({ type: 'listResearchTopics', params: {} });
      sendJson(res, 200, { topics });
      return;
    }

    let match = path.match(/^\/api\/research-topics\/([^/]+)$/);
    if (match) {
      const topicID = decodeURIComponent(match[1]);
      const topic = await query({ type: 'getResearchTopic', params: { topicID } });
      if (!topic) {
        sendJson(res, 404, { error: 'Research topic not found' });
        return;
      }
      sendJson(res, 200, { topic });
      return;
    }

    match = path.match(/^\/api\/research-topics\/([^/]+)\/articles$/);
    if (match) {
      const topicID = decodeURIComponent(match[1]);
      const result = await query({ type: 'getResearchTopicArticles', params: { topicID } });
      if (!result) {
        sendJson(res, 404, { error: 'Research topic not found' });
        return;
      }
      const articles = (result.articles || []).map((article) => ({
        ...article,
        markdownUrl: markdownPath(article.feedID, article.articleID),
      }));
      sendJson(res, 200, { topicID: result.topicID, name: result.name, articles });
      return;
    }

    match = path.match(/^\/api\/feeds\/([^/]+)\/articles$/);
    if (match) {
      const feedID = decodeURIComponent(match[1]);
      const result = await query({ type: 'getFeedArticles', params: { feedID } });
      if (!result) {
        sendJson(res, 404, { error: 'Feed not found' });
        return;
      }
      const articles = (result.articles || []).map((article) => ({
        ...article,
        markdownUrl: markdownPath(article.feedID, article.articleID),
      }));
      sendJson(res, 200, { feedID: result.feedID, name: result.name, articles });
      return;
    }

    match = path.match(/^\/api\/feeds\/([^/]+)\/articles\/([^/]+)\/markdown$/);
    if (match) {
      const feedID = decodeURIComponent(match[1]);
      const articleID = decodeURIComponent(match[2]);
      const markdown = await query({ type: 'getArticleMarkdown', params: { feedID, articleID } });
      if (markdown === null || markdown === undefined) {
        // Either the article is unknown or its markdown has not been
        // scraped yet; the listing endpoints expose markdownReady so
        // consumers only ask when it is ready.
        sendJson(res, 404, { error: 'Markdown is not ready for this article' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        ...CORS_HEADERS,
      });
      res.end(markdown);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    dispatch(req, res).catch((error) => {
      log(`[research-api] Request failed: ${error.message}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal server error' });
      } else {
        res.end();
      }
    });
  });

  let actualPort = null;

  return {
    /** The underlying node http server (exposed for tests). */
    server,

    /**
     * Bind the server and resolve with the concrete host/port.
     *
     * @returns {Promise<{host: string, port: number}>}
     */
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          actualPort = server.address().port;
          resolve({ host, port: actualPort });
        });
      });
    },

    /**
     * Stop the server.
     *
     * @returns {Promise<void>}
     */
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },

    get port() {
      return actualPort;
    },
  };
}

/**
 * Build the canonical markdown path for an article.
 *
 * @param {string} feedID
 * @param {string} articleID
 * @returns {string}
 */
export function markdownPath(feedID, articleID) {
  return `/api/feeds/${encodeURIComponent(feedID)}/articles/${encodeURIComponent(articleID)}/markdown`;
}
