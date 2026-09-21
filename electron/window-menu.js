/**
 * Window application-menu template.
 *
 * macOS only (see window-chrome.js). Electron's stock `windowMenu` role
 * has no extension point for extra items, so the role's macOS submenu is
 * rebuilt here and a "Float on Top" checkbox is added that lets the
 * window float above all other windows.
 */

/**
 * Build the Window menu template entry.
 *
 * @param {object} options
 * @param {boolean} options.floatOnTop - Current float-on-top state, reflected in the checkbox.
 * @param {(enabled: boolean) => void} options.onToggleFloatOnTop - Invoked with the checkbox's new state when clicked.
 * @returns {object} Menu template entry for the Window menu.
 */
export function buildWindowMenu({ floatOnTop, onToggleFloatOnTop }) {
  return {
    label: 'Window',
    submenu: [
      {
        id: 'float-on-top',
        label: 'Float on Top',
        type: 'checkbox',
        checked: floatOnTop,
        // Electron toggles a checkbox's state before running its click
        // handler, so menuItem.checked is already the requested state.
        click: (menuItem) => onToggleFloatOnTop(menuItem.checked),
      },
      { type: 'separator' },
      // The items Electron's `windowMenu` role provides on macOS.
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
    ],
  };
}
