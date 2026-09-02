/**
 * Quick Keys Reference
 *
 * Framework-free data and formatting helpers for the application's
 * keyboard-shortcut reference dialog ("Quick Keys"). The shortcut data
 * lives here — not in the component — so it can be unit-tested without
 * a DOM and so the Electron menu, the command panel, and the renderer
 * key handler all describe the same set of keys.
 *
 * Combos use a canonical grammar independent of platform naming:
 *   Mod+?        the platform command key (Cmd on macOS, Ctrl elsewhere)
 *   Shift+?      the shift modifier
 *   Alt+?        the option/alt modifier
 *   letters, ?, ↺ … single characters as produced by the keyboard
 *   Enter, Escape, ArrowDown, ArrowUp … named keys
 */

/** @typedef {'mac'|'pc'} KeyboardPlatform */

/**
 * Detect whether the current environment uses macOS keyboard conventions.
 *
 * @param {{platform?: string, userAgent?: string}} [navigatorLike] - Injectable for tests
 * @returns {KeyboardPlatform} 'mac' for Apple keyboards, 'pc' otherwise
 */
export function detectKeyboardPlatform(navigatorLike = navigator) {
  const platform = navigatorLike.platform || '';
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) {
    return 'mac';
  }
  // navigator.platform is deprecated; fall back to the user agent.
  const userAgent = navigatorLike.userAgent || '';
  if (/Mac|iPhone|iPad|iPod/i.test(userAgent)) {
    return 'mac';
  }
  return 'pc';
}

/**
 * Shortcut groups shown in the Quick Keys dialog.
 *
 * @type {Array<{title: string, items: Array<{combo: string, description: string}>}>}
 */
const QUICK_KEY_GROUPS = [
  {
    title: 'Articles',
    items: [
      { combo: 'ArrowDown', description: 'Select the next article' },
      { combo: 'ArrowUp', description: 'Select the previous article' },
      { combo: 'Shift+ArrowDown', description: 'Select the next feed' },
      { combo: 'Shift+ArrowUp', description: 'Select the previous feed' },
      { combo: 'Enter', description: 'Open the selected article' },
      { combo: 'M', description: 'Mark the selected article as read' },
      {
        combo: 'Escape',
        description: 'Close the article viewer or find bar; on the main list, jump to the top',
      },
    ],
  },
  {
    title: 'Find',
    items: [
      { combo: 'Mod+F', description: 'Find in articles' },
      { combo: 'Enter', description: 'Find the next match' },
      { combo: 'Shift+Enter', description: 'Find the previous match' },
    ],
  },
  {
    title: 'Application',
    items: [
      { combo: 'Mod+P', description: 'Open the command panel (or Ctrl+Shift+P)' },
      { combo: 'Mod+?', description: 'Show this quick keys reference' },
    ],
  },
];

/**
 * How each canonical token renders per platform.
 *
 * Named keys map to per-platform labels; single characters pass through.
 *
 * @type {Object<string, {mac: string, pc: string}>}
 */
const TOKEN_LABELS = {
  Mod: { mac: '⌘', pc: 'Ctrl' },
  Alt: { mac: '⌥', pc: 'Alt' },
  Shift: { mac: '⇧', pc: 'Shift' },
  Enter: { mac: '↩', pc: 'Enter' },
  Escape: { mac: 'esc', pc: 'Esc' },
  ArrowDown: { mac: '↓', pc: '↓' },
  ArrowUp: { mac: '↑', pc: '↑' },
};

/**
 * Format a canonical combo into an ordered list of key-cap labels.
 *
 * @param {string} combo - Canonical combo, e.g. 'Mod+Shift+ArrowDown'
 * @param {KeyboardPlatform} platform - Target platform conventions
 * @returns {string[]} One label per key cap, in press order
 */
export function formatKeyCombo(combo, platform) {
  return combo.split('+').map((token) => {
    const labels = TOKEN_LABELS[token];
    if (labels) {
      return labels[platform];
    }
    // Single characters and unknown tokens render verbatim (uppercased so
    // bare letters read as key caps).
    return token.length === 1 ? token.toUpperCase() : token;
  });
}

/**
 * Get the quick key groups formatted for a platform.
 *
 * @param {KeyboardPlatform} platform - Target platform conventions
 * @returns {Array<{title: string, items: Array<{combo: string, labels: string[], description: string}>}>}
 */
export function getQuickKeyGroups(platform) {
  return QUICK_KEY_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      combo: item.combo,
      labels: formatKeyCombo(item.combo, platform),
      description: item.description,
    })),
  }));
}

/**
 * Determine whether a keydown event is the Quick Keys shortcut
 * (Cmd+? on macOS, Ctrl+? elsewhere; the ? character implies Shift on
 * most layouts, which is fine — the produced character is what counts).
 *
 * @param {{key: string, code?: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean}} event
 * @returns {boolean}
 */
export function isQuickKeysEvent(event) {
  // Alt participates in character production on many layouts; treat it
  // as a different shortcut rather than a variant of this one.
  if (event.altKey) {
    return false;
  }
  if (!(event.metaKey || event.ctrlKey)) {
    return false;
  }
  // Normal path: event.key reflects the produced character, so the
  // shifted slash arrives as '?'.
  if (event.key === '?') {
    return true;
  }
  // Some environments (CDP-driven automation, unusual layouts) report the
  // physical key as '/' even while Shift is held; Shift+/ IS the ? key,
  // so accept that shape too.
  return event.code === 'Slash' && event.shiftKey === true;
}
