/**
 * Bluesky Comment Font Scaling CSS Unit Tests
 *
 * Cmd/Ctrl+Plus / Cmd/Ctrl+Minus adjust the article font size by setting
 * a data-article-font-step attribute whose rules multiply the theme font
 * sizes by --article-font-scale. Those rules used to target only the
 * Markdown reader (.rss-markdown-content), so Bluesky post text and its
 * comment thread kept their fixed sizes no matter how often the shortcut
 * was pressed.
 *
 * These tests guard the stylesheet contract that scales the social post
 * viewer's text and comments with the same factor.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/** Selector prefix every font-step scaling rule must carry. */
const STEP_SELECTOR =
  'rss-feed-component[data-article-font-step]:not([data-article-font-step="step0"])';

/**
 * Extract the scaling rule block for a class from the stylesheet.
 *
 * @param {string} className
 * @returns {string} The rule text including braces, or '' when missing.
 */
function scalingRuleFor(className) {
  const selector = `${STEP_SELECTOR} .${className} {`;
  const start = css.indexOf(selector);
  if (start === -1) {
    return '';
  }
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end + 2);
}

describe('social post viewer font scaling CSS', () => {
  it('scales the Bluesky post text with the font factor', () => {
    const rule = scalingRuleFor('rss-social-text');
    expect(rule).toBeTruthy();
    // The post text renders at the h2 theme size; scaling must multiply
    // that same variable, not replace it.
    expect(rule).toContain('--article-font-scale');
    expect(rule).toContain('var(--font-size-h2)');
  });

  it('scales the comment thread with the font factor', () => {
    const rule = scalingRuleFor('rss-social-comment');
    expect(rule).toBeTruthy();
    // The comment block sets the base size its header, handle, date, and
    // text all inherit, so one rule scales the whole comment.
    expect(rule).toContain('--article-font-scale');
    // Comments render slightly smaller than body text (* 0.8); scaling
    // must keep that factor instead of promoting comments to full size.
    expect(rule).toContain('var(--font-size-body) * 0.8');
  });

  it('scales quoted-post embeds with the font factor', () => {
    const rule = scalingRuleFor('rss-social-embed');
    expect(rule).toBeTruthy();
    expect(rule).toContain('--article-font-scale');
    // Embeds have no base size of their own — they inherit the viewer's,
    // so the scale multiplies 1em rather than hardcoding a base.
    expect(rule).toContain('* 1em');
  });

  it('keeps every scaling rule gated on a non-default step', () => {
    // step0 means "the theme default": rules must not fire there, or the
    // attribute alone would change rendering at the default size.
    for (const className of ['rss-social-text', 'rss-social-comment', 'rss-social-embed']) {
      const rule = scalingRuleFor(className);
      expect(rule).toContain(':not([data-article-font-step="step0"])');
    }
  });
});
