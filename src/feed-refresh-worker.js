/**
 * Feed Refresh Worker
 *
 * Runs feed parsing and article merging in a dedicated module worker so
 * refresh operations do not block the main UI thread. The main thread
 * remains responsible for network fetching (it has the Electron preload
 * bridge) and database persistence (it owns the sqlite worker), while this
 * worker handles the CPU-heavy parse/merge work.
 *
 * Message protocol (main thread -> worker):
 *   { id: number, action: string, params: object }
 * Response (worker -> main thread):
 *   { id: number, ok: true, result: any } | { id: number, ok: false, error: string }
 *
 * For LLMs: this is a webpack 5 native module worker; it must be spawned
 * with `new Worker(new URL('./feed-refresh-worker.js', import.meta.url), { type: 'module' })`.
 */

import { parseFeedText } from './lib/rss-parser.js';
import { generateRSSFromHTMLText } from './lib/html-to-rss.js';
import { buildSnapshotParsedFeed } from './lib/page-snapshot-feed.js';
import {
  processNewArticles,
  updateExistingArticles,
  mergeArticles,
  skipPersist,
} from './lib/article-processor.js';

/**
 * Build a failure record for an existing feed when fetching or parsing fails.
 *
 * Articles are flagged skipPersist: failure records reuse the slim
 * (content-less) feed loaded for refresh, and re-writing those would
 * overwrite stored content with NULLs.
 *
 * @param {object} existingFeed
 * @returns {object}
 */
function buildFailedFeed(existingFeed) {
  return {
    ...existingFeed,
    lastFetchWasSuccessful: false,
    lastFetchEndTime: new Date(),
    articles: existingFeed.articles.map(skipPersist),
  };
}

/**
 * Refresh a single feed from fetched text/HTML.
 *
 * @param {object} params
 * @param {string} [params.feedText] - Raw RSS/Atom/JSON feed body
 * @param {string} [params.htmlText] - Raw HTML body for synthetic feeds
 * @param {Array<string>} [params.snapshotLinks] - Previously snapshotted
 *   URLs for watched-page (snapshot) feeds; presence switches the refresh
 *   into link-diff mode against the fetched HTML.
 * @param {object} params.existingFeed - The feed record loaded from the DB
 * @param {number} params.maxArticles - Maximum articles to keep per feed
 * @returns {Promise<object>} The updated feed record, carrying a
 *   `snapshotLinks` property when refreshed in snapshot mode
 */
async function refreshFeed(params) {
  const { feedText, htmlText, parsedFeed: preParsedFeed, existingFeed, maxArticles } = params;
  const snapshotMode = Array.isArray(params.snapshotLinks);

  let parsedFeed;
  let snapshotLinks;
  if (snapshotMode && htmlText !== undefined) {
    ({ parsedFeed, snapshotLinks } = buildSnapshotParsedFeed(htmlText, existingFeed.url, params.snapshotLinks));
  } else if (preParsedFeed) {
    parsedFeed = preParsedFeed;
  } else if (htmlText !== undefined) {
    parsedFeed = generateRSSFromHTMLText(existingFeed.url, htmlText);
  } else {
    parsedFeed = await parseFeedText(feedText, existingFeed.url);
  }

  if (!parsedFeed) {
    // Nothing new on a watched page is a normal outcome, not an error —
    // report success (with unchanged articles) and persist the grown
    // snapshot so those links are never re-reported.
    if (snapshotMode) {
      return {
        ...existingFeed,
        lastFetchWasSuccessful: true,
        lastFetchEndTime: new Date(),
        noNewItems: true,
        snapshotLinks,
        articles: existingFeed.articles.map(skipPersist),
      };
    }
    return buildFailedFeed(existingFeed);
  }

  const newArticles = processNewArticles(parsedFeed.items, existingFeed);
  const updatedArticles = updateExistingArticles(parsedFeed.items, existingFeed);
  const mergedArticles = mergeArticles(updatedArticles, newArticles, maxArticles);

  return {
    ...existingFeed,
    name: parsedFeed.title || existingFeed.name,
    homePageURL: parsedFeed.homePageURL || existingFeed.homePageURL,
    iconURL: parsedFeed.iconURL || existingFeed.iconURL,
    faviconURL: parsedFeed.faviconURL || existingFeed.faviconURL,
    lastFetchWasSuccessful: true,
    lastFetchEndTime: new Date(),
    articles: mergedArticles,
    ...(snapshotMode ? { snapshotLinks } : {}),
  };
}

/**
 * Message handler. Dispatches to the action handlers above and always
 * answers with the matching message id so the main thread can correlate
 * requests and responses.
 *
 * @param {MessageEvent} event - { id, action, params }
 * @returns {Promise<void>}
 */
self.onmessage = async (event) => {
  const { id, action, params = {} } = event.data;

  try {
    if (action !== 'refreshFeed') {
      throw new Error(`Unknown feed-refresh-worker action: ${action}`);
    }

    const result = await refreshFeed(params);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};

/**
 * Error handler for uncaught exceptions inside the worker.
 * Without this, worker errors fail silently from the main thread.
 */
self.onerror = (error) => {
  console.error('[feed-refresh-worker] Unhandled error:', error);
};
