/**
 * Video Download Toast
 *
 * Thin wrapper around the central toast system (src/lib/toast.js) that
 * adds YouTube-download-specific behaviour: progress events arriving over
 * the Electron preload bridge are routed to the toast matching the
 * download URL. All DOM and styling live in the central module, so video
 * download toasts look and behave exactly like every other toast in the
 * app.
 *
 * The returned handle is driven by the caller: update() for manual
 * progress, complete() on success, fail() on error. Toasts created
 * outside Electron (tests, plain browser) simply sit in their
 * indeterminate state until the caller completes or fails them.
 */

import { showProgressToast, resetToasts } from './toast.js';
import { onDownloadProgress } from './youtube-bridge.js';

/** Active toasts keyed by download URL. */
const activeToasts = new Map();

/** Unsubscribe function for the shared progress listener, if installed. */
let unsubscribeProgress = null;

/**
 * Map a backend progress event to toast text and percent.
 *
 * @param {{stage: string, percent?: number|null, eta?: string}} event
 * @returns {{text: string, percent: number|null}}
 */
function describeProgress(event) {
  if (event.stage === 'processing') {
    return { text: 'Processing video…', percent: 100 };
  }
  if (event.stage === 'downloading') {
    const percent = typeof event.percent === 'number' ? event.percent : null;
    if (percent === null) {
      return { text: 'Downloading…', percent: null };
    }
    const eta = event.eta ? ` (${event.eta})` : '';
    return { text: `Downloading… ${Math.round(percent)}%${eta}`, percent };
  }
  return { text: 'Preparing download…', percent: null };
}

/**
 * Install the shared IPC progress listener once.
 *
 * @returns {void}
 */
function ensureProgressListener() {
  if (unsubscribeProgress) {
    return;
  }

  unsubscribeProgress = onDownloadProgress((event) => {
    const toast = activeToasts.get(event?.url);
    if (!toast) {
      return;
    }
    const { text, percent } = describeProgress(event);
    toast.update(text, percent);
  });
}

/**
 * Show a video download toast for a URL.
 *
 * The toast is deduplicated by URL in the central system, so a retried
 * download replaces its stale toast.
 *
 * @param {string} url - Download URL; keys IPC progress routing
 * @param {string} [initialText] - First status line shown
 * @returns {{update: (text: string, percent?: number|null) => void,
 *            complete: (text?: string) => void,
 *            fail: (text: string) => void,
 *            remove: () => void}}
 */
export function showVideoDownloadToast(url, initialText = 'Preparing download…') {
  ensureProgressListener();

  // The central system dedupes by key (the URL here), replacing any
  // stale toast for a retried download.
  const handle = showProgressToast(url, initialText);

  // Keep the video-specific completion default; the central system's
  // default is generic ("Done ✓").
  const wrappedHandle = {
    ...handle,
    complete: (nextText) => handle.complete(nextText ?? 'Video saved ✓'),
  };
  activeToasts.set(url, wrappedHandle);
  return wrappedHandle;
}

/**
 * Clear all active video download toasts and detach the progress
 * listener.
 *
 * Intended for tests so repeated suites start from a clean slate.
 *
 * @returns {void}
 */
export function resetVideoDownloadToasts() {
  for (const handle of activeToasts.values()) {
    handle.remove();
  }
  activeToasts.clear();
  resetToasts();
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }
}
