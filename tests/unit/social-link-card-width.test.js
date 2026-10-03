/**
 * Bluesky Link Card Width CSS Unit Tests
 *
 * The bug report: the external link card (`rss-social-link-card`) rendered
 * too small — it did not fill the width of the div holding it, and the
 * text was clipped to a thin strip.
 *
 * Two stylesheet rules caused it:
 *  1. `.rss-social-media a` (0,1,1) set `display: block` on every media
 *     anchor, beating the card's own `display: flex` (0,1,0), so the
 *     thumbnail and text body stacked vertically and the card collapsed.
 *  2. `.rss-article-content img` (0,1,1) added vertical margins and a
 *     radius to the thumbnail in the timeline, and the thumbnail's
 *     `min-height: 100%` was a circular percentage against the
 *     auto-height flex card — together they made the card shorter than
 *     its own content, clipping it (`overflow: hidden`).
 *
 * These tests guard the contract that keeps the card full-width with a
 * natural, content-driven height.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * Extract a top-level CSS rule body by selector.
 *
 * @param {string} selector Exact selector text, e.g. `.rss-social-link-card`
 * @returns {string|null}
 */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match ? match[1] : null;
}

describe('bluesky link card width CSS', () => {
  it('lays the card out as a full-width flex row', () => {
    const card = rule('.rss-social-link-card');
    expect(card).toBeTruthy();
    expect(card).toMatch(/display:\s*flex/);
    expect(card).toMatch(/width:\s*100%/);
    // Border-box so the 1px border does not push the card past the
    // wrapper width.
    expect(card).toMatch(/box-sizing:\s*border-box/);
  });

  it('does not let the generic media-anchor rule override the card layout', () => {
    // `.rss-social-media a` would win on specificity (0,1,1 > 0,1,0) and
    // force `display: block`, which is the original bug.
    expect(rule('.rss-social-media a')).toBeNull();

    const generic = rule('.rss-social-media a:not(.rss-social-link-card)');
    expect(generic).toBeTruthy();
    expect(generic).toMatch(/display:\s*block/);
  });

  it('sizes the thumbnail from the flex row without clipping the card', () => {
    const thumb = rule('.rss-social-media .rss-social-link-card img');
    expect(thumb).toBeTruthy();
    // A percentage min-height is circular against an auto-height flex
    // container and collapsed the card below its content height.
    expect(thumb).not.toMatch(/min-height:\s*100%/);
    expect(thumb).toMatch(/min-height:\s*0/);
    // Neutralize `.rss-article-content img`'s margins/radius (0,1,1) by
    // scoping through `.rss-social-media` (0,2,1).
    expect(thumb).toMatch(/margin:\s*0/);
    expect(thumb).toMatch(/border-radius:\s*0/);
    // Still a fixed slice so the headline gets the rest of the row.
    expect(thumb).toMatch(/flex:\s*0 0 6rem/);
  });

  it('lets the text body grow into the remaining row space', () => {
    const body = rule('.rss-social-link-card-body');
    expect(body).toBeTruthy();
    expect(body).toMatch(/flex:\s*1 1 0/);
    expect(body).toContain('min-width: 0;');
  });
});
