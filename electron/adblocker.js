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
 * Initialize the Ghostery ad/tracker blocker.
 *
 * Loads (or restores from cache) the prebuilt ads-and-tracking filter engine,
 * then enables blocking on `session.defaultSession`. The cache is stored in
 * the Electron user data directory so subsequent starts do not need to
 * re-download the filter lists.
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

  return blocker;
}
