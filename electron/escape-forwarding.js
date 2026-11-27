/**
 * Escape forwarding from embedded-site webview guests.
 *
 * The "Show Original" viewer embeds the article's real website as a
 * <webview> guest (see src/lib/original-embed.js). When the user clicks
 * or tabs into that guest, keyboard focus moves to the guest's own
 * webContents — from then on the main window's before-input-event
 * listener (electron/main.js createWindow) no longer sees any
 * keystrokes, because Electron delivers input events only to the
 * focused webContents. Without forwarding, Escape pressed while reading
 * the embedded site does nothing: the user is stuck in the viewer (a
 * particular trap in Distraction Free Mode, where Escape is the only
 * way back to the feed without the menu chrome).
 *
 * The fix mirrors the main-window relay: watch each guest webContents'
 * before-input-event and forward Escape presses to the renderer over
 * the same 'escape-pressed' IPC channel. The renderer's shared Escape
 * pipeline (_runEscapeAction in src/rss-feed-component.js) deduplicates
 * the two delivery paths with a 250 ms timestamp guard.
 *
 * Deliberately Escape-only:
 * - The app's other navigation keys (arrows, Enter, M) are intentionally
 *   inert while a modal is open, so forwarding them would do nothing but
 *   risk confusing the embedded site.
 * - Shortcut combos that stay live inside the viewer (Ctrl+F, Ctrl+D,
 *   F11, font size, Ctrl+Z) are also live keys for the embedded site
 *   (page find, bookmark, video fullscreen, editor undo). Relaying them
 *   would make every press act twice — once on the site, once on the
 *   app. Escape is the one key whose app meaning (navigate backwards)
 *   matches what a user expects while reading the original site.
 *
 * The Escape event is NOT preventDefault()-ed: the embedded site keeps
 * its own Escape behavior (exiting video fullscreen, closing its own
 * dialogs, …) exactly as before; only the app additionally gets to
 * navigate. Pure helpers live here so they can be unit tested without
 * launching Electron.
 */

/**
 * Decide whether an input event from before-input-event is an Escape
 * key-down that should be forwarded to the renderer.
 *
 * @param {{ type: string, key: string }} input - Electron input descriptor
 * @returns {boolean} True for an Escape key-down press
 */
export function isEscapeKeyDown(input) {
  return Boolean(input) && input.type === 'keyDown' && input.key === 'Escape';
}

/**
 * Attach Escape forwarding to a webview guest webContents.
 *
 * @param {Electron.WebContents} webContents - A webview guest webContents
 * @param {Function} send - Called with no arguments for each Escape press
 * @returns {void}
 */
export function attachGuestEscapeForwarding(webContents, send) {
  webContents.on('before-input-event', (event, input) => {
    if (!isEscapeKeyDown(input)) {
      return;
    }
    // No preventDefault: the guest site still receives Escape and keeps
    // its own handling; the app only learns about the press as well.
    send();
  });
}
