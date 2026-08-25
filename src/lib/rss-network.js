/**
 * RSS Network Helpers
 *
 * Thin wrapper around HTTP requests for RSS discovery and parsing.
 * In Electron the renderer loads from the custom `app://` origin, so
 * renderer-side fetch() is subject to CORS. The app therefore uses the
 * preload bridge (window.electron.fetchText) for all network requests in
 * Electron. Outside Electron (e.g. webpack dev server or tests) it falls
 * back to the standard fetch() API.
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
  if (isElectron()) {
    if (typeof window !== 'undefined' && window.electron && typeof window.electron.fetchBytes === 'function') {
      return window.electron.fetchBytes(url);
    }
    throw new Error('Electron fetch bridge is not available. Cannot fetch from the renderer.');
  }

  try {
    const response = await fetch(url);
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      buffer,
      contentType: response.headers.get('content-type') || '',
    };
  } catch (error) {
    return { ok: false, status: 0, contentType: '' };
  }
}

/**
 * Fetch the text body of a URL.
 *
 * In Electron this always goes through the main-process bridge to avoid
 * CORS. It never uses the renderer's fetch() in Electron.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<{ok: boolean, status: number, text: string}>}
 */
export async function fetchText(url) {
  if (isElectron()) {
    if (typeof window !== 'undefined' && window.electron && typeof window.electron.fetchText === 'function') {
      return window.electron.fetchText(url);
    }
    throw new Error('Electron fetch bridge is not available. Cannot fetch from the renderer.');
  }

  try {
    const response = await fetch(url);
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: error.message };
  }
}
