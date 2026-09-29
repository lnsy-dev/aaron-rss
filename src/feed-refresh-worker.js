/**
 * Feed Refresh Worker
 *
 * Runs feed fetching, parsing, and article merging in a dedicated module
 * worker so refresh operations do not block the main UI thread. The main
 * thread remains responsible for database persistence (it owns the sqlite
 * worker) and for relaying network fetches to the Electron preload bridge
 * over a MessagePort (see setFetchPort below).
 *
 * Message protocol (main thread -> worker):
 *   { id: number, action: string, params: object }
 *   { id: 0, action: 'setFetchPort' } — transfers the fetch relay MessagePort
 * Response (worker -> main thread):
 *   { id: number, ok: true, result: any } | { id: number, ok: false, error: string }
 *
 * Fetch relay protocol (worker -> port):
 *   { id: number, url: string }
 * Response (port -> worker):
 *   { id: number, ok: true, result: {ok, status, text} } | { id: number, ok: false, error: string }
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
import {
  buildYouTubeChannelFeedURLCandidates,
  extractYouTubeChannelFeedID,
} from './lib/youtube.js';

/**
 * The fetch relay port installed via the 'setFetchPort' action.
 *
 * Workers cannot use the Electron preload bridge (it only exists on the
 * main thread) and a worker's own fetch() is subject to CORS from the
 * app:// origin, so network fetching is relayed to the main thread over
 * this port. The main-thread side forwards requests to the preload
 * bridge (or plain fetch outside Electron), keeping every refresh-stage
 * orchestration decision inside this worker thread.
 *
 * @type {MessagePort|null}
 */
let fetchPort = null;

/** @type {number} Monotonic id for relayed fetch requests */
let nextFetchId = 1;

/** @type {Map<number, {resolve: Function, reject: Function}>} In-flight relayed fetches */
const pendingFetches = new Map();

/**
 * Install the fetch relay port. Must be sent as the first message after
 * the worker is created so every later refresh can fetch.
 *
 * @param {MessagePort} port - Port paired with the main-thread relay
 * @returns {void}
 */
function setFetchPort(port) {
  fetchPort = port;
  port.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const pending = pendingFetches.get(id);
    if (!pending) {
      return;
    }
    pendingFetches.delete(id);
    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error));
    }
  };
}

/**
 * Fetch a URL's text through the main-thread relay.
 *
 * @param {string} url - Absolute URL to fetch
 * @returns {Promise<{ok: boolean, status: number, text: string}>}
 */
function relayFetchText(url) {
  if (!fetchPort) {
    return Promise.reject(new Error('Fetch relay port is not installed'));
  }
  return new Promise((resolve, reject) => {
    const id = nextFetchId++;
    pendingFetches.set(id, { resolve, reject });
    fetchPort.postMessage({ id, url });
  });
}

/**
 * Collect the fetch candidates for a feed URL, best first.
 *
 * YouTube's channel_id feeds intermittently answer 404 fleet-wide while
 * the identical upload feed keyed by the channel's uploads playlist
 * (channel ID with UC replaced by UULF) keeps working. The canonical URL
 * always comes first, so a healthy feed server is hit exactly as before;
 * the twin only matters when the canonical request fails.
 *
 * @param {string} url - Feed URL to fetch
 * @returns {Array<string>} Candidate URLs, canonical first
 */
function feedURLCandidates(url) {
  const candidates = [url];
  const channelID = extractYouTubeChannelFeedID(url);
  if (channelID) {
    for (const alternate of buildYouTubeChannelFeedURLCandidates(channelID)) {
      if (!candidates.includes(alternate)) {
        candidates.push(alternate);
      }
    }
  }
  return candidates;
}

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
 * When `params.fetchFromURL` is set the worker performs the network fetch
 * itself through the relay port, so the whole refresh (fetch + parse +
 * merge) runs in this worker thread and the main thread only relays the
 * request to the Electron preload bridge. Otherwise the already-fetched
 * `feedText`/`htmlText`/`parsedFeed` is used (Bluesky feeds, whose
 * per-item enrichment needs the main thread, still take that path).
 *
 * @param {object} params
 * @param {string} [params.fetchFromURL] - Fetch the feed source from this
 *   URL through the relay before parsing
 * @param {string} [params.feedText] - Raw RSS/Atom/JSON feed body
 * @param {string} [params.htmlText] - Raw HTML body for synthetic feeds
 * @param {Array<string>} [params.snapshotLinks] - Previously snapshotted
 *   URLs for watched-page (snapshot) feeds; presence switches the refresh
 *   into link-diff mode against the fetched HTML.
 * @param {object} params.existingFeed - The feed record loaded from the DB
 * @param {number} params.maxArticles - Maximum articles to keep per feed
 * @param {Array<string>} [params.clearedUniqueIDs] - UniqueIDs of articles
 *   deliberately cleared (research-topic "clear articles"); items with
 *   these ids arriving again from the source are not re-added as new
 * @returns {Promise<object>} The updated feed record, carrying a
 *   `snapshotLinks` property when refreshed in snapshot mode
 */
async function refreshFeed(params) {
  const { feedText, htmlText, parsedFeed: preParsedFeed, existingFeed, maxArticles } = params;
  const clearedUniqueIDs = Array.isArray(params.clearedUniqueIDs)
    ? new Set(params.clearedUniqueIDs)
    : null;
  const snapshotMode = Array.isArray(params.snapshotLinks);

  let sourceFeedText = feedText;
  let sourceHTMLText = htmlText;

  if (params.fetchFromURL !== undefined) {
    // The canonical URL is tried first; known alternates (the YouTube
    // uploads-playlist twin during channel_id outages) are only fetched
    // when it fails. The feed's stored URL is never rewritten — identity
    // stays canonical, only the transport falls back.
    let response = null;
    for (const candidate of feedURLCandidates(params.fetchFromURL)) {
      response = await relayFetchText(candidate);
      if (response.ok) {
        break;
      }
    }
    if (!response || !response.ok) {
      return buildFailedFeed(existingFeed);
    }
    if (existingFeed.synthetic) {
      sourceHTMLText = response.text;
    } else {
      sourceFeedText = response.text;
    }
  }

  let parsedFeed;
  let snapshotLinks;
  if (snapshotMode && sourceHTMLText !== undefined) {
    ({ parsedFeed, snapshotLinks } = buildSnapshotParsedFeed(sourceHTMLText, existingFeed.url, params.snapshotLinks));
  } else if (preParsedFeed) {
    parsedFeed = preParsedFeed;
  } else if (sourceHTMLText !== undefined) {
    parsedFeed = generateRSSFromHTMLText(existingFeed.url, sourceHTMLText);
  } else {
    parsedFeed = await parseFeedText(sourceFeedText, existingFeed.url);
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

  const newArticles = processNewArticles(parsedFeed.items, existingFeed, clearedUniqueIDs);
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
 * requests and responses. The 'setFetchPort' action takes the fetch
 * relay MessagePort from `event.ports[0]` and never posts a reply.
 *
 * @param {MessageEvent} event - { id, action, params }
 * @returns {Promise<void>}
 */
self.onmessage = async (event) => {
  const { id, action, params = {} } = event.data;

  try {
    if (action === 'setFetchPort') {
      const port = event.ports && event.ports[0];
      if (!port) {
        throw new Error('setFetchPort requires a transferred MessagePort');
      }
      setFetchPort(port);
      return;
    }

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
