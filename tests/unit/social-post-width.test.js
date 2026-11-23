/**
 * Social Post Viewer Layout CSS Unit Tests
 *
 * The root social-media post (Bluesky, Mastodon, …) must fill the
 * article viewer's full width — a fixed `max-width: 66ch` cap measured
 * at the unzoomed font size kept the post in a narrow column once
 * ctrl+plus scaled the text, so the text never filled the screen the
 * way a zoomed regular article does.
 *
 * The reply thread stays narrower than the root post and nested replies
 * indent per depth level through data-depth CSS rules (the renderer no
 * longer writes inline margin styles).
 *
 * These tests guard that stylesheet contract.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * Extract a rule block by its selector from the stylesheet.
 *
 * @param {string} selector The full selector text, ending in " {".
 * @returns {string} The rule text including braces, or '' when missing.
 */
function ruleFor(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    return '';
  }
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end + 2);
}

describe('social post viewer layout CSS', () => {
  it('renders the root post at full width with no ch cap', () => {
    const rule = ruleFor('.rss-social-post');
    expect(rule).toBeTruthy();
    expect(rule).toContain('width: 100%');
    // The old fixed column cap must be gone: a ch-based max-width is
    // measured at the element's font size and stopped the zoomed post
    // from filling the viewer width.
    expect(rule).not.toContain('max-width');
  });

  it('keeps comments in a narrower column than the root post', () => {
    const rule = ruleFor('.rss-social-comment');
    expect(rule).toBeTruthy();
    expect(rule).toContain('max-width: 66ch');
  });

  it('indents nested replies per depth level via data-depth rules', () => {
    // The renderer sets data-depth on nested comment blocks; the CSS
    // owns the indentation (inline margin styles are prohibited).
    let previous = 0;
    for (let depth = 1; depth <= 8; depth += 1) {
      const rule = ruleFor(`.rss-social-comment[data-depth="${depth}"]`);
      expect(rule).toBeTruthy();
      const margin = parseFloat(rule.match(/margin-left:\s*([0-9.]+)rem/)?.[1] ?? 'NaN');
      expect(margin).toBeGreaterThan(previous);
      previous = margin;
    }
  });

  it('leaves depth-0 comments flush with the column', () => {
    // Top-level replies carry no data-depth attribute; there must be no
    // rule that indents plain .rss-social-comment blocks.
    const rule = ruleFor('.rss-social-comment');
    expect(rule).not.toContain('margin-left');
  });
});
