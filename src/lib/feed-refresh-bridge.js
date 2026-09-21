/**
 * Feed Refresh Worker Bridge
 *
 * Main-thread client for src/feed-refresh-worker.js. Keeps the worker
 * instance alive and correlates request/response messages by id.
 *
 * The bridge also installs the fetch relay: the worker performs feed
 * network fetches inside its own thread and asks this side to forward
 * each request to the Electron preload bridge (or plain fetch outside
 * Electron) over a MessagePort. No refresh logic ever runs on the main
 * thread — only the IPC relay hop does.
 */

import { normalizeFeedURL } from './rss-network.js';

/**
 * Lazily-created module worker instance.
 *
 * @type {Worker|null}
 */
let worker = null;

/** @type {number} Monotonic request id counter */
let nextRequestId = 1;

/** @type {Map<number, {resolve: Function, reject: Function, timeout: number}>} In-flight requests */
const pendingRequests = new Map();

/** Default timeout for worker requests so lost responses do not leak memory. */
const WORKER_REQUEST_TIMEOUT_MS = 120000;

/**
 * Fetch a URL's text on behalf of the worker.
 *
 * In Electron the preload bridge does the fetch in the main process
 * (avoiding CORS); anywhere else the renderer's own fetch() is used,
 * which is what the dev server and the e2e suite rely on.
 *
 * @param {string} url - Absolute URL to fetch
 * @returns {Promise<{ok: boolean, status: number, text: string}>}
 */
async function fetchTextForWorker(url) {
  if (typeof window !== 'undefined' && window.electron && typeof window.electron.fetchText === 'function') {
    return window.electron.fetchText(normalizeFeedURL(url));
  }

  const response = await fetch(normalizeFeedURL(url));
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

/**
 * Install the fetch relay for a freshly created worker.
 *
 * One half of a MessagePort is transferred to the worker (which stores it
 * as its fetch relay); requests arriving on the local half are answered
 * through fetchTextForWorker. The port message is posted before any
 * refresh request, so the worker always has the relay installed by the
 * time the first refresh runs.
 *
 * @param {Worker} workerInstance - The freshly created worker
 * @returns {void}
 */
function installFetchRelay(workerInstance) {
  const channel = new MessageChannel();
  channel.port1.onmessage = async (event) => {
    const { id, url } = event.data;
    try {
      const result = await fetchTextForWorker(url);
      channel.port1.postMessage({ id, ok: true, result });
    } catch (error) {
      channel.port1.postMessage({ id, ok: false, error: error.message });
    }
  };
  workerInstance.postMessage({ id: 0, action: 'setFetchPort' }, [channel.port2]);
}

/**
 * Get (or create) the feed refresh worker and wire up its message handler.
 *
 * @returns {Worker} The feed refresh worker instance
 */
function getWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL('../feed-refresh-worker.js', import.meta.url), { type: 'module' });
  installFetchRelay(worker);

  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    pendingRequests.delete(id);
    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error));
    }
  };

  worker.onerror = (error) => {
    // A catastrophic worker failure rejects every in-flight request
    pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error(`Feed refresh worker error: ${error.message}`));
    });
    pendingRequests.clear();
  };

  return worker;
}

/**
 * Send an action to the worker and await its response.
 *
 * @param {string} action - Action name (see src/feed-refresh-worker.js)
 * @param {object} [params={}] - Action parameters
 * @returns {Promise<any>} The action result
 */
function callWorker(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Feed refresh worker request timed out after ${WORKER_REQUEST_TIMEOUT_MS}ms`));
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeout });
    getWorker().postMessage({ id, action, params });
  });
}

/**
 * Fetch, parse, and merge a single feed in the worker.
 *
 * With `params.fetchFromURL` set, the worker fetches the feed source
 * itself through the installed relay; otherwise the already-fetched
 * `feedText`/`htmlText`/`parsedFeed` is merged (Bluesky feeds).
 *
 * @param {object} params
 * @param {string} [params.fetchFromURL] - URL the worker fetches through
 *   the relay before parsing
 * @param {string} [params.feedText] - Raw RSS/Atom/JSON feed body
 * @param {string} [params.htmlText] - Raw HTML body for synthetic feeds
 * @param {object} params.existingFeed - The feed record loaded from the DB
 * @param {number} params.maxArticles - Maximum articles to keep per feed
 * @returns {Promise<object>} The updated feed record
 */
export function refreshFeedInWorker(params) {
  return callWorker('refreshFeed', params);
}
