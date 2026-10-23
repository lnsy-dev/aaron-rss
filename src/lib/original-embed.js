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
 * Escape keys: the guest page takes keyboard focus as soon as the user
 * clicks into it, and a guest's keystrokes never reach the host
 * document — the app could not close the viewer with Escape anymore.
 * Where the same-origin policy permits, a small forwarder script is
 * injected into the guest document that posts an
 * `original-embed-escape` message (ORIGINAL_EMBED_ESCAPE_MESSAGE) to
 * the host window; the component listens for it and runs its regular
 * Escape action. Cross-origin guests refuse injection (the browser
 * throws on document access); in Electron the webview's keystrokes are
 * instead forwarded from the main process (see electron/main.js), and
 * the Distraction Free CSS keeps the viewer header visible as a pointer
 * fallback.
 *
 * The element always carries the `rss-article-viewer-frame` class so
 * the existing viewer layout applies unchanged.
 */

/** DOM event fired on the embed when the site cannot render in-app. */
export const ORIGINAL_EMBED_BLOCKED_EVENT = 'original-embed-blocked';

/**
 * postMessage type the injected Escape forwarder sends to the host
 * window when the user presses Escape inside a same-origin guest page.
 */
export const ORIGINAL_EMBED_ESCAPE_MESSAGE = 'original-embed-escape';

/**
 * Whether a message event's payload announces an Escape press from an
 * original-site embed.
 *
 * @param {*} data - The MessageEvent's data property
 * @returns {boolean}
 */
export function isOriginalEmbedEscapeMessage(data) {
  return Boolean(data) && data.type === ORIGINAL_EMBED_ESCAPE_MESSAGE;
}

/**
 * Build the inline script that the host injects into a same-origin guest
 * document.
 *
 * The code must run inside the guest's own realm: a listener function
 * created in the host realm (and merely attached to the guest document)
 * would report the HOST window as postMessage's event.source, which the
 * component's source check rejects. An inline <script> is compiled in
 * the guest realm, so the forwarded message's source is the guest
 * window — and the guest keeps its own Escape behavior because the
 * press is not prevented.
 *
 * @param {string} messageType - Message type to announce Escape with
 * @param {string} targetOrigin - Origin the host window is reachable at
 * @returns {string} Inline script source
 */
export function buildEscapeForwarderScript(messageType, targetOrigin) {
  return `(function () {
    if (document.__escapeForwarderInjected) { return; }
    document.__escapeForwarderInjected = true;
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') { return; }
      window.parent.postMessage({ type: ${JSON.stringify(messageType)} }, ${JSON.stringify(targetOrigin)});
    }, true);
  })();`;
}

/**
 * Inject an Escape forwarder into a same-origin guest document.
 *
 * The forwarder is an inline <script> appended to the guest document
 * (see buildEscapeForwarderScript for why it must be inline rather than
 * a host-realm closure). Cross-origin guests throw a SecurityError on
 * document access — the injection is silently skipped and the host
 * falls back to its other Escape paths (Electron IPC forwarding, or the
 * visible viewer header). A guest CSP that forbids inline scripts also
 * just leaves the fallbacks in place.
 *
 * The guard flag lives on the guest document, so it dies with each
 * navigation and every new document gets a fresh forwarder.
 *
 * @param {HTMLElement} frame - The iframe whose guest document gets the forwarder
 * @param {string} [targetOrigin] - Origin the host window is reachable at
 * @returns {void}
 */
export function injectEscapeForwarder(frame, targetOrigin = (typeof location !== 'undefined' ? location.origin : '*')) {
  try {
    const guestDocument = frame.contentWindow.document;
    // The guard flag is owned by the script itself: setting it here too
    // would make the script's own guard bail out before it ever
    // attached its listener.
    const script = guestDocument.createElement('script');
    script.textContent = buildEscapeForwarderScript(ORIGINAL_EMBED_ESCAPE_MESSAGE, targetOrigin);
    guestDocument.documentElement.appendChild(script);
  } catch {
    // Cross-origin guest: the same-origin policy refuses document
    // access, so no forwarder can be installed. Escape inside such a
    // page is handled by the Electron IPC path or the visible header.
  }
}

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
    // Best-effort: give the guest document an Escape forwarder so the
    // host app can still close the viewer once the page takes keyboard
    // focus. Same-origin guests get the script; cross-origin ones skip
    // it silently (see injectEscapeForwarder).
    injectEscapeForwarder(frame);
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
