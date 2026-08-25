/**
 * Feed Refresh Worker Bridge
 *
 * Main-thread client for src/feed-refresh-worker.js. Keeps the worker
 * instance alive and correlates request/response messages by id.
 */

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
 * Get (or create) the feed refresh worker and wire up its message handler.
 *
 * @returns {Worker} The feed refresh worker instance
 */
function getWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL('../feed-refresh-worker.js', import.meta.url), { type: 'module' });

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
 * Parse and merge a single feed in the worker.
 *
 * @param {object} params
 * @param {string} [params.feedText] - Raw RSS/Atom/JSON feed body
 * @param {string} [params.htmlText] - Raw HTML body for synthetic feeds
 * @param {object} params.existingFeed - The feed record loaded from the DB
 * @param {number} params.maxArticles - Maximum articles to keep per feed
 * @returns {Promise<object>} The updated feed record
 */
export function refreshFeedInWorker(params) {
  return callWorker('refreshFeed', params);
}
