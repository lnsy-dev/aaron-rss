/**
 * Central Toast System
 *
 * The single shared location for every toast in the app. Toasts stack in
 * one fixed container at the bottom-right of the viewport, painted above
 * every overlay (including the command palette and article viewer).
 *
 * Two kinds of toasts share the same styling and container:
 * - Simple toasts: `showToast(message, options)` — transient feedback
 *   that fades out automatically after a short duration.
 * - Progress toasts: `showProgressToast(key, initialText)` — long-lived
 *   toasts with a status line and progress bar, driven through the
 *   returned handle (`update`, `complete`, `fail`, `remove`). Progress
 *   toasts are deduplicated by key so a retried operation replaces its
 *   stale toast instead of stacking a duplicate.
 *
 * While real percent values are provided the progress bar is determinate;
 * with a null percent it runs in an indeterminate sweep so the user
 * always sees motion.
 */

/** Active progress toast handles keyed by their dedupe key. */
const activeToasts = new Map();

/** How long a completed progress toast lingers before fading (ms). */
const COMPLETE_LINGER_MS = 1200;

/** How long a failed progress toast lingers before fading (ms). */
const FAIL_LINGER_MS = 3000;

/** How long the fade-out transition takes (ms). */
const FADE_MS = 300;

/**
 * Create the shared toast container element if needed.
 *
 * @returns {HTMLElement} The container element
 */
function ensureContainer() {
  let container = document.querySelector('.app-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'app-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Build the DOM for a single toast: a root with a status text line and,
 * when `withProgress` is set, a progress bar with an animated fill.
 *
 * @param {boolean} withProgress Whether to include the progress bar
 * @returns {{root: HTMLElement, text: HTMLElement, fill: HTMLElement|null}}
 */
function buildToastElements(withProgress) {
  const root = document.createElement('div');
  root.className = 'app-toast';

  const text = document.createElement('div');
  text.className = 'app-toast-text';
  root.appendChild(text);

  let fill = null;
  if (withProgress) {
    const bar = document.createElement('div');
    bar.className = 'app-toast-progress';
    root.appendChild(bar);

    fill = document.createElement('div');
    fill.className = 'app-toast-progress-fill app-toast-indeterminate';
    bar.appendChild(fill);
  }

  return { root, text, fill };
}

/**
 * Update the visual state of a toast's progress bar.
 *
 * A null/undefined percent switches the bar into its indeterminate sweep;
 * a number pins the fill width to that percentage.
 *
 * @param {HTMLElement|null} fill
 * @param {number|null} [percent]
 * @returns {void}
 */
function applyPercent(fill, percent) {
  if (!fill) {
    return;
  }
  if (percent === null || percent === undefined) {
    fill.classList.add('app-toast-indeterminate');
    fill.style.removeProperty('--app-toast-progress');
  } else {
    fill.classList.remove('app-toast-indeterminate');
    fill.style.setProperty(
      '--app-toast-progress',
      `${Math.max(0, Math.min(100, percent))}%`
    );
  }
}

/**
 * Start the fade-out transition and remove the element when it ends.
 *
 * @param {HTMLElement} root
 * @param {number} [delay] Extra delay before the fade starts (ms)
 * @returns {void}
 */
function fadeOutAndRemove(root, delay = 0) {
  setTimeout(() => {
    root.classList.add('app-toast-fade');
    setTimeout(() => root.remove(), FADE_MS);
  }, delay);
}

/**
 * Show a simple transient toast.
 *
 * @param {string} message - Text to display
 * @param {{type?: 'info'|'error', duration?: number}} [options]
 * @returns {void}
 */
export function showToast(message, { type = 'info', duration = 3000 } = {}) {
  const container = ensureContainer();
  const { root, text } = buildToastElements(false);
  if (type === 'error') {
    root.classList.add('app-toast-error');
  }
  text.textContent = message;
  container.appendChild(root);

  setTimeout(() => fadeOutAndRemove(root), duration);
}

/**
 * Show a progress toast identified by `key`.
 *
 * The returned handle is driven by the caller: update() for progress,
 * complete() on success, fail() on error, remove() to dismiss at once.
 * Showing a toast with a key that is already active replaces the stale
 * one instead of stacking.
 *
 * @param {string} key - Dedupe key (e.g. a download URL or 'feed-refresh')
 * @param {string} [initialText] - First status line shown
 * @returns {{update: (text: string, percent?: number|null) => void,
 *            complete: (text?: string) => void,
 *            fail: (text: string) => void,
 *            remove: () => void}}
 */
export function showProgressToast(key, initialText = '') {
  // Replace any stale toast for the same key (e.g. a retried operation).
  const existing = activeToasts.get(key);
  if (existing) {
    existing.remove();
  }

  const container = ensureContainer();
  const { root, text, fill } = buildToastElements(true);
  text.textContent = initialText;
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
     * Mark the operation as finished and fade the toast out shortly.
     *
     * @param {string} [nextText]
     * @returns {void}
     */
    complete(nextText = 'Done ✓') {
      text.textContent = nextText;
      applyPercent(fill, 100);
      activeToasts.delete(key);
      fadeOutAndRemove(root, COMPLETE_LINGER_MS);
    },

    /**
     * Mark the operation as failed and fade the toast out shortly.
     *
     * @param {string} nextText
     * @returns {void}
     */
    fail(nextText) {
      text.textContent = nextText;
      root.classList.add('app-toast-error');
      applyPercent(fill, null);
      activeToasts.delete(key);
      fadeOutAndRemove(root, FAIL_LINGER_MS);
    },

    /**
     * Remove the toast immediately (no fade).
     *
     * @returns {void}
     */
    remove() {
      activeToasts.delete(key);
      root.remove();
    },
  };

  activeToasts.set(key, handle);
  return handle;
}

/**
 * Clear all active toasts.
 *
 * Intended for tests so repeated suites start from a clean slate.
 *
 * @returns {void}
 */
export function resetToasts() {
  for (const handle of activeToasts.values()) {
    handle.remove();
  }
  activeToasts.clear();
}
