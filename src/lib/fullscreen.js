/**
 * Full Screen helpers.
 *
 * Linux and Windows run without an application menu, so Electron's
 * `togglefullscreen` menu role is unreachable there. This module toggles
 * the window through the standard Fullscreen API instead — Electron wires
 * it to the whole BrowserWindow, and the same code works in the browser.
 */

/**
 * Report whether the document currently shows a full screen element.
 *
 * @param {Document} [doc] - Document to inspect (defaults to the global one)
 * @returns {boolean} True when full screen is active
 */
export function isFullScreen(doc = document) {
  return Boolean(doc.fullscreenElement);
}

/**
 * Toggle full screen for the given document's root element.
 *
 * Enters full screen when currently windowed, leaves it when already
 * full screen. The returned promise rejects when the environment refuses
 * (e.g. no user gesture, or the API is unsupported); callers decide how
 * to surface that.
 *
 * @param {Document} [doc] - Document to toggle (defaults to the global one)
 * @returns {Promise<boolean>} True when entering, false when leaving
 */
export async function toggleFullScreen(doc = document) {
  if (isFullScreen(doc)) {
    await doc.exitFullscreen();
    return false;
  }
  await doc.documentElement.requestFullscreen();
  return true;
}
