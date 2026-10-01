/**
 * Dark-mode Danger Button CSS Unit Tests
 *
 * Danger buttons used to fill from --error-color, an alias of --accent.
 * The dark theme flips --accent to a light cream, and the floating video
 * chrome's Delete Video button pairs that fill with hardcoded white
 * text, so in dark mode it rendered light-on-light — impossible to read.
 *
 * These tests guard the stylesheet contract that replaced it: the theme
 * defines a --danger red fill in BOTH color schemes, and every danger
 * button rule pairs that fill with white text instead of the
 * theme-inverting --error-color / var(--background-color) pair.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

const themePath = fileURLToPath(new URL('../../styles/dataroom-theme.css', import.meta.url));
const themeCss = readFileSync(themePath, 'utf8');

const variablesPath = fileURLToPath(new URL('../../styles/variables.css', import.meta.url));
const variablesCss = readFileSync(variablesPath, 'utf8');

const componentPath = fileURLToPath(
  new URL('../../src/rss-feed-component.js', import.meta.url)
);

/**
 * Extract a rule block from the stylesheet by selector.
 *
 * @param {string} selector Selector text including the trailing " {"
 * @returns {string} The rule text including braces, or '' when missing.
 */
function ruleFor(selector) {
  const start = css.indexOf(selector);
  if (start === -1) {
    return '';
  }
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end + 2);
}

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
 * Parse a hex color value like "#c24541".
 *
 * @param {string} value Value text after "--danger:"
 * @returns {{r: number, g: number, b: number} | null} RGB channels or null.
 */
function parseHex(value) {
  const match = value.match(/#([0-9a-f]{6})/i);
  if (!match) {
    return null;
  }
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

describe('theme --danger fill', () => {
  it('defines a red --danger fill in the light theme', () => {
    const rule = lightRootRule();
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/--danger:\s*#/);
    const rgb = parseHex(rule.match(/--danger:\s*(#\w+)/)[1]);
    // Red-dominant: the destructive fill must not drift toward the
    // accent creams the dark theme uses for its fills.
    expect(rgb.r).toBeGreaterThan(rgb.g);
    expect(rgb.r).toBeGreaterThan(rgb.b);
    expect(rgb.r).toBeGreaterThan(100);
  });

  it('defines a red --danger fill in the dark theme', () => {
    const rule = darkMediaRule();
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/--danger:\s*#/);
    const rgb = parseHex(rule.match(/--danger:\s*(#\w+)/)[1]);
    expect(rgb.r).toBeGreaterThan(rgb.g);
    expect(rgb.r).toBeGreaterThan(rgb.b);
    // Light enough for white text to clear 4.5:1, dark enough to stand
    // apart from the dark surface: keep the red channel in a mid range.
    expect(rgb.r).toBeGreaterThanOrEqual(150);
    expect(rgb.r).toBeLessThanOrEqual(230);
  });

  it('keeps --error-color aliased to --accent for text usages', () => {
    // Menus, toasts, and inline error text still want the theme's
    // inverting error color; only button fills moved to --danger.
    expect(variablesCss).toMatch(/--error-color:\s*var\(--accent\)/);
  });
});

describe('danger button rules', () => {
  it('fills the danger action button from --danger with white text', () => {
    const rule = ruleFor('.rss-button-danger {');
    expect(rule).toBeTruthy();
    expect(rule).toContain('background: var(--danger);');
    expect(rule).toContain('border-color: var(--danger);');
    expect(rule).toContain('color: #fff;');
    // The old pairing: --error-color fill (light cream in dark mode)
    // with a text color that flips with the background.
    expect(rule).not.toContain('var(--error-color)');
    expect(rule).not.toContain('var(--background-color)');
  });

  it('fills the floating-chrome Delete Video button from --danger with white text', () => {
    const rule = ruleFor('.rss-video-chrome .rss-youtube-delete-button {');
    expect(rule).toBeTruthy();
    expect(rule).toContain('background: var(--danger);');
    expect(rule).toContain('border-color: var(--danger);');
    // White text was fine in light mode but unreadable over the dark
    // theme's cream --error-color fill; it is only safe on --danger.
    expect(rule).toContain('color: #fff;');
    expect(rule).not.toContain('var(--error-color)');
  });

  it('stamps the chrome fill on the element the four reported classes land on', () => {
    // The reported button carries all four classes; the renderer must
    // keep stamping them so the CSS rules above keep matching it.
    const componentSource = readFileSync(componentPath, 'utf8');
    expect(componentSource).toContain(
      "'rss-action-button rss-button-danger rss-youtube-external-button rss-youtube-delete-button'"
    );
  });
});
