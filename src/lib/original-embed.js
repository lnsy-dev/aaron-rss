/**
 * Original-Site Embed
 *
 * The "Open Original" viewers embed the article's source website in the
 * article window. Which element can do that depends on the runtime:
 *
 * - In Electron the embed is a <webview>. Sites that send
 *   `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN` (Slashdot,
 *   many news sites) refuse to render inside a plain <iframe>, which
 *   used to leave a blank viewer that fell back to the system browser
 *   after several seconds. A webview loads the site as a top-level
 *   guest, which those headers do not govern, so the site renders
 *   in-app again like it did before the headers appeared.
 *
 * - Elsewhere (plain browser, Playwright tests) it stays a sandboxed
 *   <iframe> with the old blank-load detection: a site that blocks
 *   framing reports about:blank.
 *
 * In both cases the element dispatches an `original-embed-blocked`
 * CustomEvent (detail: { url }) when the site cannot be shown in-app,
 * so each caller can choose its fallback (close the viewer, revert to
 * the extracted article, or hand the URL to the system browser).
 *
 * The element always carries the `rss-article-viewer-frame` class so
 * the existing viewer layout applies unchanged.
 */

/** DOM event fired on the embed when the site cannot render in-app. */
export const ORIGINAL_EMBED_BLOCKED_EVENT = 'original-embed-blocked';

/**
 * Whether this renderer runs inside Electron.
 *
 * Mirrors the navigator.userAgent check used by the network helpers.
 *
 * @returns {boolean}
 */
function isElectronRuntime() {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

/**
 * Announce that the site could not be shown inside the embed.
 *
 * @param {HTMLElement} embed - The embed element that failed
 * @param {string} url - The URL the embed was asked to load
 * @returns {void}
 */
function dispatchBlocked(embed, url) {
  embed.dispatchEvent(new CustomEvent(ORIGINAL_EMBED_BLOCKED_EVENT, { detail: { url } }));
}

/**
 * Create the embed element for an original-site view.
 *
 * The returned element is NOT navigated; call navigateOriginalSiteEmbed
 * when the view becomes visible, so no fetches happen for viewers the
 * user never opens.
 *
 * @param {string} url - The original article URL
 * @returns {HTMLElement} A webview (Electron) or iframe element
 */
export function createOriginalSiteEmbed(url) {
  if (isElectronRuntime()) {
    const webview = document.createElement('webview');
    webview.className = 'rss-article-viewer-frame';
    webview.title = 'Original article';
    // Persistent partition: cookies and Cloudflare clearances survive
    // across articles and app restarts, so sites do not re-challenge
    // every open. Because the partition is its own Electron session, the
    // ad/tracker blocker has to be enabled on this exact string — see
    // ORIGINAL_SITES_PARTITION in electron/adblocker.js.
    webview.setAttribute('partition', 'persist:original-sites');
    // Let target=_blank links reach the system browser through the
    // main-process window-open handler instead of dying silently.
    webview.setAttribute('allowpopups', '');
    // A webview can only fail a main-frame load through real network
    // errors (framing headers do not apply to guests). -3 ERR_ABORTED
    // is navigation churn (redirects, quick re-navigation), not a
    // failure the user needs a fallback for.
    webview.addEventListener('did-fail-load', (event) => {
      if (!webview.__originalEmbedNavigated) {
        return;
      }
      if (event.isMainFrame && event.errorCode !== -3) {
        dispatchBlocked(webview, url);
      }
    });
    return webview;
  }

  const frame = document.createElement('iframe');
  frame.className = 'rss-article-viewer-frame';
  frame.title = 'Original article';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.addEventListener('load', () => {
    // An inserted iframe fires a load for its initial about:blank
    // document before any real navigation; only judge navigations the
    // embed factory performed.
    if (!frame.__originalEmbedNavigated) {
      return;
    }
    // Give the document a beat to settle before judging it blank.
    setTimeout(() => {
      try {
        const location = frame.contentWindow.location.href;
        if (location === 'about:blank' || location === window.location.href) {
          // The site refused to be framed (CSP frame-ancestors /
          // X-Frame-Options) and Chromium left the frame empty.
          dispatchBlocked(frame, url);
        }
      } catch {
        // Reading location.href across origins throws SecurityError,
        // which means the frame loaded real cross-origin content.
      }
    }, 500);
  });
  return frame;
}

/**
 * Point an original-site embed at its URL.
 *
 * Marks the embed as genuinely navigated first, so the blank/failure
 * detection above only judges real loads, then navigates. Safe to call
 * repeatedly (view toggling re-navigates).
 *
 * @param {HTMLElement} embed - Element from createOriginalSiteEmbed
 * @param {string} url - The original article URL
 * @returns {void}
 */
export function navigateOriginalSiteEmbed(embed, url) {
  embed.__originalEmbedNavigated = true;
  embed.src = url;
}
