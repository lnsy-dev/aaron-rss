/**
 * Dark-Mode Modal Overlay CSS Unit Tests
 *
 * The modal backdrop paints the theme's --scrim translucently. It used
 * to paint var(--foreground-color), which the dark theme flips to a
 * light cream (#e5c7a9) — so every modal in dark mode opened over a
 * jarring light overlay while the app underneath stayed dark.
 *
 * These tests guard the stylesheet contract: the theme defines a dark
 * --scrim in BOTH color schemes, and the modal overlay rule reads that
 * token while keeping its translucent 0.7 opacity (an article viewer
 * left open underneath must remain visible).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

const themePath = fileURLToPath(new URL('../../styles/dataroom-theme.css', import.meta.url));
const themeCss = readFileSync(themePath, 'utf8');

/**
 * Extract the light :root block (the first one — the dark values live
 * inside the prefers-color-scheme media query further down).
 *
 * @returns {string} The :root rule text including braces, or ''.
 */
function lightRootRule() {
  const start = themeCss.indexOf(':root {');
  if (start === -1) {
    return '';
  }
  const end = themeCss.indexOf('\n}', start);
  return end === -1 ? '' : themeCss.slice(start, end + 2);
}

/**
 * Extract the dark-theme media query block.
 *
 * @returns {string} The @media block text including braces, or ''.
 */
function darkMediaRule() {
  const start = themeCss.indexOf('@media (prefers-color-scheme: dark) {');
  if (start === -1) {
    return '';
  }
  const end = themeCss.indexOf('\n}', start);
  return end === -1 ? '' : themeCss.slice(start, end + 2);
}

/**
 * Extract the .rss-modal-overlay::before rule block.
 *
 * @returns {string} The rule text including braces, or ''.
 */
function scrimRule() {
  const start = css.indexOf('.rss-modal-overlay::before {');
  if (start === -1) {
    return '';
  }
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end + 2);
}

/**
 * Parse a hex color value like "#1a1812".
 *
 * @param {string} rule Text containing a "--scrim: #hex;" declaration
 * @returns {{r: number, g: number, b: number} | null} RGB channels or null.
 */
function scrimRgb(rule) {
  const match = rule.match(/--scrim:\s*(#\w+)/);
  if (!match) {
    return null;
  }
  const int = parseInt(match[1].slice(1), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

describe('theme --scrim token', () => {
  it('is a dark dim in the light theme (unchanged rendering)', () => {
    const rule = lightRootRule();
    expect(rule).toBeTruthy();
    const rgb = scrimRgb(rule);
    expect(rgb).toBeTruthy();
    // Dark channels: the light theme's scrim must keep dimming the way
    // the old var(--foreground-color) (#1a1812) did.
    expect(rgb.r).toBeLessThan(64);
    expect(rgb.g).toBeLessThan(64);
    expect(rgb.b).toBeLessThan(64);
  });

  it('is a near-black dim in the dark theme, not the cream foreground', () => {
    const rule = darkMediaRule();
    expect(rule).toBeTruthy();
    const rgb = scrimRgb(rule);
    expect(rgb).toBeTruthy();
    // The dark theme's --foreground is #e5c7a9 (light cream); the scrim
    // must not track it — assert the channels stay near-black.
    expect(rgb.r).toBeLessThan(32);
    expect(rgb.g).toBeLessThan(32);
    expect(rgb.b).toBeLessThan(32);
  });
});

describe('modal overlay rule', () => {
  it('paints the backdrop from the theme scrim with the translucent opacity', () => {
    const rule = scrimRule();
    expect(rule).toBeTruthy();
    expect(rule).toContain('background: var(--scrim);');
    expect(rule).toContain('opacity: 0.7;');
  });

  it('no longer paints the backdrop with the flipping foreground color', () => {
    const rule = scrimRule();
    expect(rule).toBeTruthy();
    // Match the declaration only — the rule's comment references the old
    // var(--foreground-color) on purpose.
    expect(rule).not.toMatch(/background:\s*var\(--foreground-color\)/);
  });
});
