/**
 * Ad Blocker Library
 *
 * Main-process wrapper around @ghostery/adblocker-electron. It loads the
 * prebuilt ads-and-tracking filter list (with on-disk caching) and enables
 * request blocking on the default Electron session.
 *
 * This module must only run in the Electron main process; the renderer has
 * no access to the blocker and no Node/Electron APIs.
 */

import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { app, session } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Filename for the serialized blocker cache inside the user data directory. */
const ENGINE_FILE_NAME = 'adblocker-engine.bin';

/**
 * Session partition used by the "Open Original" article viewer.
 *
 * The viewer embeds source websites in a <webview> that opts into its own
 * persistent session (see `createOriginalSiteEmbed` in
 * `src/lib/original-embed.js`, which sets the same string on the element).
 * That session is separate from `session.defaultSession`, so the app's
 * ad blocker must be enabled on it explicitly or original-page views load
 * unfiltered. Keep the two in sync.
 *
 * @type {string}
 */
export const ORIGINAL_SITES_PARTITION = 'persist:original-sites';

/**
 * Apply the blocker's network filters to one session directly.
 *
 * `ElectronBlocker.enableBlockingInSession()` also registers GLOBAL
 * `ipcMain` handlers for cosmetic-filter injection. Those handlers are
 * process-wide (not per-session), so a second call — required for the
 * viewer's separate partition session — throws "Attempted to register a
 * second handler" partway through `enable()`. The throw happens before the
 * `webRequest` listeners are attached, which would leave that session with
 * no ad/tracker blocking at all.
 *
 * Registering the per-session `webRequest` listeners here gives the session
 * network filtering (the bulk of ad/tracker blocking) without touching the
 * global handlers that `session.defaultSession` already installed.
 *
 * @param {import('@ghostery/adblocker-electron').ElectronBlocker} blocker - The configured blocker
 * @param {Electron.Session} targetSession - Session to filter
 * @returns {void}
 */
function enableNetworkBlockingInSession(blocker, targetSession) {
  // Registering the same event again simply replaces the previous listener,
  // so this stays safe to call more than once for a session.
  //
  // Look the handler up on the blocker when each request arrives rather than
  // capturing it now, so the YouTube bypass installed below also applies to
  // requests from this session.
  targetSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) =>
    blocker.onBeforeRequest(details, callback),
  );
  targetSession.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) =>
    blocker.onHeadersReceived(details, callback),
  );
}

/**
 * Initialize the Ghostery ad/tracker blocker.
 *
 * Loads (or restores from cache) the prebuilt ads-and-tracking filter engine,
 * then enables blocking on `session.defaultSession` and on the "Open Original"
 * viewer's partition session. The cache is stored in the Electron user data
 * directory so subsequent starts do not need to re-download the filter lists.
 *
 * @param {Function} [fetchImpl=globalThis.fetch] - Fetch implementation used to download filter lists
 * @returns {Promise<import('@ghostery/adblocker-electron').ElectronBlocker>} The configured blocker
 */
export async function initializeAdBlocker(fetchImpl = globalThis.fetch) {
  const cachePath = path.join(app.getPath('userData'), ENGINE_FILE_NAME);

  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl, {
    path: cachePath,
    read: readFile,
    write: writeFile,
  });

  // YouTube's embedded player and its API endpoints (youtubei, googlevideo,
  // ytimg, etc.) are brittle when ad/tracker filters cancel their requests.
  // Blocking them produces ERR_BLOCKED_BY_CLIENT and "Error 153: Video Player
  // Configuration Error". Allow all YouTube-family requests to pass through.
  const originalOnBeforeRequest = blocker.onBeforeRequest.bind(blocker);
  blocker.onBeforeRequest = (details, callback) => {
    const hostname = details.url ? new URL(details.url).hostname : '';
    const allowed =
      hostname === 'www.youtube.com' ||
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com' ||
      hostname === 'youtu.be' ||
      hostname === 'www.youtu.be' ||
      hostname.endsWith('.youtube.com') ||
      hostname.endsWith('.ytimg.com') ||
      hostname.endsWith('.googlevideo.com') ||
      hostname.endsWith('.gvt2.com');

    if (allowed) {
      callback({});
      return;
    }
    return originalOnBeforeRequest(details, callback);
  };

  blocker.enableBlockingInSession(session.defaultSession);

  // The "Open Original" viewer runs in its own persistent session, so the
  // default-session blocker above never sees its requests. Filter that
  // session too, otherwise original-page views load ads and trackers.
  enableNetworkBlockingInSession(blocker, session.fromPartition(ORIGINAL_SITES_PARTITION));

  return blocker;
}
