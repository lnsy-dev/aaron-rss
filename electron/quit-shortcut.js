/**
 * Ctrl+Q application-quit shortcut.
 *
 * Platforms with an application menu (macOS, see window-chrome.js) get
 * "Quit" with the Cmd+Q accelerator for free from Electron's stock
 * `appMenu` role, so the keystroke must not be intercepted a second
 * time. Linux and Windows run without an application menu at all —
 * Menu.setApplicationMenu(null) in electron/main.js — which also
 * removes every menu accelerator, so the shortcuts users still need
 * are re-registered on the window's before-input-event. Ctrl+Q is one
 * of them: a desktop reader should quit with the convention it ships
 * on every other app.
 *
 * Calling app.quit() from main.js takes the normal shutdown path
 * (before-quit, closing windows, window-all-closed), exactly like the
 * user closing the last window or picking Quit from a menu. The pure
 * matcher lives here so it can be unit tested without launching
 * Electron, the same way as escape-forwarding.js.
 */

import { usesApplicationMenu } from './window-chrome.js';

/**
 * Decide whether an input event from before-input-event is the Ctrl+Q
 * key-down that should quit the application.
 *
 * @param {{ type: string, key: string, control: boolean }} input - Electron input descriptor
 * @param {string} platform - A Node process.platform value
 * @returns {boolean} True for a Ctrl+Q key-down on a platform without an application menu
 */
export function isQuitKeyDown(input, platform) {
  if (!input || input.type !== 'keyDown') {
    return false;
  }
  if (usesApplicationMenu(platform)) {
    // macOS: the stock appMenu role already carries Cmd+Q.
    return false;
  }
  return Boolean(input.control) && String(input.key).toLowerCase() === 'q';
}
