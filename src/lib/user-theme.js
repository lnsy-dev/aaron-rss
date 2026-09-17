/**
 * User theme application for the renderer.
 *
 * When a user-authored theme exists at ~/.config/theme.css, the
 * Electron main process reads it (see electron/user-theme.js) and this
 * module injects it as the last stylesheet of the document. Its :root
 * variable definitions — the same custom properties the bundled
 * styles/dataroom-theme.css defines — therefore win the cascade and
 * re-theme the app. On the plain web (no Electron bridge) there is no
 * ~/.config to read, so nothing happens.
 */

/**
 * Element id of the injected user theme <style> element.
 *
 * @type {string}
 */
export const USER_THEME_STYLE_ID = 'user-theme';

/**
 * Apply a user theme stylesheet to the document.
 *
 * Creates (or reuses) a <style id="user-theme"> element at the end of
 * the document head so its rules override every bundled stylesheet of
 * equal specificity. Empty or whitespace-only stylesheets are ignored.
 *
 * @param {string} css - The stylesheet text to apply
 * @param {Document} [doc] - The document to theme (defaults to the global document)
 * @returns {HTMLStyleElement|null} The style element, or null when there is no head to append to
 */
export function applyUserTheme(css, doc = (typeof document !== 'undefined' ? document : undefined)) {
  if (!css || !css.trim() || !doc || !doc.head) {
    return null;
  }
  let style = doc.getElementById(USER_THEME_STYLE_ID);
  if (!style) {
    style = doc.createElement('style');
    style.id = USER_THEME_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = css;
  return style;
}

/**
 * Load and apply the user theme through the Electron bridge.
 *
 * Resolves quietly to null — applying nothing — when there is no
 * Electron bridge (plain web), the bridge lacks the theme accessor,
 * no theme.css exists, or the stylesheet is empty.
 *
 * @param {{getUserThemeCss?: () => Promise<string|null>}} [bridge] - The window.electron bridge
 * @returns {Promise<HTMLStyleElement|null>} The applied style element, or null when no theme was applied
 */
export async function initUserTheme(bridge) {
  const electronBridge =
    bridge !== undefined
      ? bridge
      : (typeof window !== 'undefined' ? window.electron : undefined);
  if (!electronBridge || typeof electronBridge.getUserThemeCss !== 'function') {
    return null;
  }
  const css = await electronBridge.getUserThemeCss();
  if (!css || !css.trim()) {
    return null;
  }
  return applyUserTheme(css);
}
