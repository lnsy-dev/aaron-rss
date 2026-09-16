/**
 * Platform window-chrome policy for the main window.
 *
 * Linux and Windows keep the native window decorations and run without
 * Electron's in-window application menu. The in-window menu bar reserves
 * a strip at the top of the client area that pushes the page content
 * down (clipping the bottom of the layout in exactly-screen-sized
 * windows, such as under tiling window managers) and renders as a dark
 * bar on dark system themes. macOS keeps the hidden inset title bar and
 * the standard application menu, which its keyboard shortcuts require.
 */

/**
 * BrowserWindow option overrides for the platform.
 *
 * @param {string} platform - A Node process.platform value.
 * @returns {object} Options to merge into the BrowserWindow constructor.
 */
export function windowChromeOptions(platform) {
  if (platform === 'darwin') {
    // macOS: transparent title bar that lets the page background show
    // through, with the traffic-light buttons inset from the edge.
    return { titleBarStyle: 'hiddenInset' };
  }
  // Linux/Windows: native decorations. Tiling window managers need a
  // normally framed, normally resizable window they can tile edge to
  // edge without the app reserving any client-area chrome of its own.
  return {};
}

/**
 * Whether the platform gets Electron's in-window application menu.
 *
 * @param {string} platform - A Node process.platform value.
 * @returns {boolean} True on macOS only.
 */
export function usesApplicationMenu(platform) {
  return platform === 'darwin';
}
