/**
 * RSS Network Helpers
 *
 * Thin wrapper around HTTP requests for RSS discovery and parsing.
 * In Electron the renderer loads from the custom `app://` origin, so
 * renderer-side fetch() is subject to CORS. The app therefore uses the
 * preload bridge (window.electron.fetchText) for all network requests in
 * Electron; the main process answers over Chromium's network stack
 * (net.fetch) and handles Cloudflare-protected sites by clearing their
 * challenge in a window once (see electron/challenge-bypass.js).
 * Outside Electron (e.g. webpack dev server or tests) it falls back to
 * the standard fetch() API.
 */

/**
 * Detect whether the current runtime is Electron.
 *
 * @returns {boolean}
 */
function isElectron() {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

/**
 * Normalize a user-supplied URL for fetching.
 *
 * Trims whitespace and prepends `https://` when the input has no
 * scheme, so entries like "example.com/feed" do not get resolved as
 * relative URLs (which would 404 against the app origin) or rejected
 * outright by main-process fetch.
 *
 * @param {string} url - Raw URL, possibly scheme-less
 * @returns {string} Absolute URL when parsable, otherwise the input
 */
export function normalizeFeedURL(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.href;
  } catch {
    return `https://${trimmed}`;
  }
}

/**
 * Read the content-type header off a fetch response.
 *
 * @param {Response|object} response - A fetch Response (or test mock)
 * @returns {string} The content-type, or '' when unavailable
 */
function responseContentType(response) {
  return response.headers?.get?.('content-type') || '';
}

/**
 * Whether a response is a Cloudflare "prove you are human" interstitial.
 *
 * Cloudflare-protected sites answer plain HTTP clients with a
 * "Just a moment..." challenge page (usually HTTP 403/503) instead of
 * the real content. The sniffing lives in the main process for fetches
 * it performs; this renderer-side twin mirrors it for direct renderer
 * fetches (web builds) and for triaging bridge results.
 *
 * @param {{status?: number, text?: string, contentType?: string}} response
 *   A fetch-like response summary.
 * @returns {boolean} True when the response looks like a challenge page.
 */
export function isCloudflareChallenge(response) {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const status = typeof response.status === 'number' ? response.status : 0;
  const text = typeof response.text === 'string' ? response.text : '';
  const contentType = (response.contentType || '').toLowerCase();

  if (text && contentType && !contentType.includes('html')) {
    return false;
  }

  if (status === 403 || status === 503) {
    return true;
  }

  if (status === 200 && text) {
    return text.includes('/cdn-cgi/challenge-platform/') || text.includes('cf-challenge');
  }

  return false;
}

/**
 * Build a short, user-facing explanation for a failed feed request.
 *
 * @param {{status?: number, contentType?: string}} response
 *   The failed fetch response summary.
 * @returns {string} Message suitable for toasts and feed errors.
 */
export function describeFailureReason(response) {
  const status = response && typeof response.status === 'number' ? response.status : 0;
  const contentType = ((response && response.contentType) || '').toLowerCase();

  if (status === 403 || status === 503) {
    return 'Blocked by bot protection. Use "Watch Page (no RSS)" or try again.';
  }
  if (status === 404) {
    return 'The server replied 404 Not Found — this address has no feed.';
  }
  if (contentType.includes('html')) {
    return 'No feed found at this address (the page is HTML, not RSS).';
  }
  if (status >= 400) {
    return `The server replied HTTP ${status}.`;
  }
  return 'No feed found at this address.';
}

/**
 * Bridge-backed fetch with Cloudflare challenge retry.
 *
 * Subclasses of behavior shared by fetchText and fetchBytes: when the
 * main-process bridge reports a challenge response, ask it to clear the
 * challenge by visiting the URL in a window (usually hidden; sometimes
 * interactive), then retry the original request once. Clearance cookies
 * persist in the session, so the retry — and all later requests —
 * succeed.
 *
 * @param {string} url - Absolute URL to fetch.
 * @param {'fetchText'|'fetchBytes'} bridgeMethod - Bridge call to make.
 * @returns {Promise<{ok: boolean, status: number, text?: string, buffer?: Uint8Array, contentType?: string}>}
 *   The response from the bridge, or a failed stub when unavailable.
 */
async function bridgeFetchWithChallengeRetry(url, bridgeMethod) {
  const electron = typeof window !== 'undefined' ? window.electron : null;
  if (!electron || typeof electron[bridgeMethod] !== 'function') {
    throw new Error('Electron fetch bridge is not available. Cannot fetch from the renderer.');
  }

  let response = await electron[bridgeMethod](url);

  if (isCloudflareChallenge(response) && typeof electron.resolveFeedChallenge === 'function') {
    const { cleared } = await electron.resolveFeedChallenge(url).catch(() => ({ cleared: false }));
    if (cleared) {
      response = await electron[bridgeMethod](url);
    }
  }

  return response;
}

/**
 * Fetch the raw bytes of a URL.
 *
 * In Electron this goes through the main-process bridge to avoid CORS
 * (article images rarely carry CORS headers). Outside Electron it falls
 * back to the standard fetch() API in the renderer.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<{ok: boolean, status: number, buffer?: Uint8Array, contentType?: string}>}
 */
export async function fetchBytes(url) {
  url = normalizeFeedURL(url);
  if (isElectron()) {
    return bridgeFetchWithChallengeRetry(url, 'fetchBytes');
  }

  try {
    const response = await fetch(normalizeFeedURL(url));
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      buffer,
      contentType: responseContentType(response),
    };
  } catch (error) {
    return { ok: false, status: 0, contentType: '' };
  }
}

/**
 * Fetch the text body of a URL.
 *
 * In Electron this always goes through the main-process bridge to avoid
 * CORS. It never uses the renderer's fetch() in Electron. When the
 * response is a Cloudflare challenge, the challenge is cleared in a
 * window once and the request retried (see bridgeFetchWithChallengeRetry).
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<{ok: boolean, status: number, text: string, contentType: string}>}
 */
export async function fetchText(url) {
  url = normalizeFeedURL(url);
  if (isElectron()) {
    return bridgeFetchWithChallengeRetry(url, 'fetchText');
  }

  try {
    const response = await fetch(normalizeFeedURL(url));
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      contentType: responseContentType(response),
    };
  } catch (error) {
    return { ok: false, status: 0, text: error.message, contentType: '' };
  }
}
