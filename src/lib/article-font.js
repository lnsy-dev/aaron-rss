/**
 * Article Font Size
 *
 * Framework-free helpers for the article font size feature: keyboard
 * shortcut detection (Ctrl+Plus / Ctrl+Minus / Ctrl+0, Cmd on macOS),
 * step clamping, and the mapping from a step value to the CSS attribute
 * that drives the visual scale.
 *
 * Font sizing is CSS-only: the component sets a
 * `data-article-font-step` attribute and styles/rss-feed-component.css
 * carries one rule per step. This module holds the shared vocabulary —
 * bounds, detection, and mapping — so the component, the Quick Keys
 * reference, and the tests all agree on one definition.
 *
 * The step scale runs from -3 (smallest) to +5 (largest) with 0 as the
 * theme default. Non-zero steps trade title hierarchy space for reading
 * comfort; ±4 would make h1/h6 nearly indistinguishable, and beyond
 * that the article header wraps badly at every window width.
 */

/** @type {number} Smallest (most negative) font step. */
export const ARTICLE_FONT_MIN_STEP = -3;

/** @type {number} Largest font step. */
export const ARTICLE_FONT_MAX_STEP = 5;

/** @type {number} Step value meaning "the theme's default size". */
export const ARTICLE_FONT_DEFAULT_STEP = 0;

/**
 * The CSS attribute value for a step, e.g. "step-2", "step0", "step-1".
 *
 * A bare number would need a leading sign character that CSS attribute
 * selectors handle awkwardly for negatives; the `step` prefix keeps
 * every selector a simple equality match.
 *
 * @param {number} step
 * @returns {string} Attribute value like "step-3" … "step5"
 */
export function articleFontStepAttrValue(step) {
  return `step${step}`;
}

/**
 * Clamp a step value into the supported range.
 *
 * NaN falls back to the theme default; ±Infinity clamp to the range
 * limits.
 *
 * @param {number} step
 * @returns {number} The clamped integer step
 */
export function clampArticleFontStep(step) {
  if (Number.isNaN(step)) {
    return ARTICLE_FONT_DEFAULT_STEP;
  }
  return Math.min(ARTICLE_FONT_MAX_STEP, Math.max(ARTICLE_FONT_MIN_STEP, Math.round(step)));
}

/**
 * Determine whether a keydown event is an article font size shortcut
 * (Cmd/Ctrl+Plus, Cmd/Ctrl+Minus, or Cmd/Ctrl+0 to reset).
 *
 * Accepts both the "+" key and "=" (the unshifted character on the same
 * physical key), which browsers deliver for Ctrl/Cmd plus that key.
 * Alt variants are rejected: they mean different shortcuts on many
 * layouts.
 *
 * @param {{key: string, code?: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean}} event
 * @returns {'increase'|'decrease'|'reset'|null} The action, or null when the event is not a font shortcut
 */
export function getArticleFontAction(event) {
  if (event.altKey) {
    return null;
  }
  if (!(event.metaKey || event.ctrlKey)) {
    return null;
  }

  const key = event.key;

  // Ctrl/Cmd+= or Ctrl/Cmd++ (Shift on the same physical key) grows.
  if (key === '=' || key === '+') {
    return 'increase';
  }
  if (key === '-') {
    return 'decrease';
  }
  // Ctrl/Cmd+0 resets to the theme default, like browser zoom.
  if (key === '0') {
    return 'reset';
  }
  // CDP-driven automation and some layouts report the physical key via
  // code rather than the produced character in key; accept those shapes.
  if (event.code === 'Equal' && (key === '' || key === 'Dead')) {
    return 'increase';
  }
  if (event.code === 'Minus' && (key === '' || key === 'Dead')) {
    return 'decrease';
  }
  if (event.code === 'Digit0' && (key === '' || key === 'Dead')) {
    return 'reset';
  }
  return null;
}

/**
 * Parse a stored articleFontStep settings value.
 *
 * Settings are persisted as strings; a missing or corrupt value falls
 * back to the theme default.
 *
 * @param {string|number|null|undefined} value
 * @returns {number} The parsed and clamped step
 */
export function parseArticleFontStep(value) {
  if (value === null || value === undefined || value === '') {
    return ARTICLE_FONT_DEFAULT_STEP;
  }
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return ARTICLE_FONT_DEFAULT_STEP;
  }
  return clampArticleFontStep(parsed);
}
