/**
 * Video Download Toast
 *
 * Fixed bottom-right toast showing live progress for video downloads.
 * Each toast has a status line (var(--font-ui)) and a progress bar.
 * While real percent values arrive from the Electron main process the
 * bar is determinate; before that (provisioning, metadata lookup) it
 * runs in an indeterminate sweep so the user always sees motion.
 *
 * Progress events arrive over the Electron preload bridge keyed by the
 * download URL, so the module keeps a registry of active toasts and
 * routes updates to the matching one. Toasts created outside Electron
 * (tests, plain browser) simply sit in their indeterminate state until
 * the caller completes or fails them.
 */

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
 * Create the shared toast container element if needed.
 *
 * @returns {HTMLElement} The container element
 */
function ensureContainer() {
  let container = document.querySelector('.video-download-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'video-download-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Create a single toast element with text and progress bar children.
 *
 * @returns {{root: HTMLElement, text: HTMLElement, fill: HTMLElement, bar: HTMLElement}}
 */
function buildToastElements() {
  const root = document.createElement('div');
  root.className = 'video-download-toast';

  const text = document.createElement('div');
  text.className = 'video-download-toast-text';
  root.appendChild(text);

  const bar = document.createElement('div');
  bar.className = 'video-download-toast-progress';
  root.appendChild(bar);

  const fill = document.createElement('div');
  fill.className = 'video-download-toast-progress-fill video-download-toast-indeterminate';
  bar.appendChild(fill);

  return { root, text, fill, bar };
}

/**
 * Update the visual state of a toast's progress bar.
 *
 * A null percent switches the bar into its indeterminate sweep; a
 * number pins the fill width to that percentage.
 *
 * @param {HTMLElement} fill
 * @param {number|null} percent
 * @returns {void}
 */
function applyPercent(fill, percent) {
  if (percent === null || percent === undefined) {
    fill.classList.add('video-download-toast-indeterminate');
    fill.style.removeProperty('--video-download-toast-progress');
  } else {
    fill.classList.remove('video-download-toast-indeterminate');
    fill.style.setProperty(
      '--video-download-toast-progress',
      `${Math.max(0, Math.min(100, percent))}%`
    );
  }
}

/**
 * Remove a toast from the DOM after its fade-out transition.
 *
 * @param {HTMLElement} root
 * @returns {void}
 */
function fadeOutAndRemove(root) {
  root.classList.add('video-download-toast-fade');
  setTimeout(() => root.remove(), 300);
}

/**
 * Show a video download toast for a URL.
 *
 * The returned handle is driven by the caller: update() for manual
 * progress, complete() on success, fail() on error. Progress events
 * arriving over IPC for the same URL update the toast automatically.
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

  // Replace any stale toast for the same URL (e.g. a retried download).
  const existing = activeToasts.get(url);
  if (existing) {
    existing.remove();
  }

  const container = ensureContainer();
  const { root, text, fill } = buildToastElements();
  text.textContent = initialText;
  applyPercent(fill, null);
  container.appendChild(root);

  const handle = {
    /**
     * Update the status text and progress percent.
     *
     * @param {string} nextText
     * @param {number|null} [percent]
     * @returns {void}
     */
    update(nextText, percent = null) {
      text.textContent = nextText;
      applyPercent(fill, percent);
    },

    /**
     * Mark the download as finished and fade the toast out.
     *
     * @param {string} [nextText]
     * @returns {void}
     */
    complete(nextText = 'Video saved ✓') {
      text.textContent = nextText;
      applyPercent(fill, 100);
      activeToasts.delete(url);
      setTimeout(() => fadeOutAndRemove(root), 1200);
    },

    /**
     * Mark the download as failed and fade the toast out.
     *
     * @param {string} nextText
     * @returns {void}
     */
    fail(nextText) {
      text.textContent = nextText;
      root.classList.add('video-download-toast-error');
      applyPercent(fill, null);
      activeToasts.delete(url);
      setTimeout(() => fadeOutAndRemove(root), 3000);
    },

    /**
     * Remove the toast immediately (no fade).
     *
     * @returns {void}
     */
    remove() {
      activeToasts.delete(url);
      root.remove();
    },
  };

  activeToasts.set(url, handle);
  return handle;
}

/**
 * Clear all active toasts and detach the progress listener.
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
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }
}
