/**
 * Bluesky Link Card Headline CSS Unit Tests
 *
 * Bluesky external link cards (article embeds) are an anchor laid out as
 * a flex row: thumbnail image plus a text body carrying the article
 * headline. The headline is always in the DOM, but the stylesheet used
 * to give the image `width: 100%` with `flex-shrink: 0`, which clamped
 * the text body to zero width — posts showed only the splash image with
 * no clickable headline.
 *
 * These tests guard the stylesheet contract that keeps the headline
 * visible: the thumbnail takes a fixed slice of the row and the body is
 * allowed to grow into the rest.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

describe('bluesky link card headline CSS', () => {
  it('gives the thumbnail a fixed slice instead of the whole card', () => {
    const rule = css.match(/\.rss-social-link-card img \{[\s\S]*?\n\}/);
    expect(rule).toBeTruthy();
    // No `width: 100%` on the thumbnail: that is what starved the
    // headline of space.
    expect(rule[0]).not.toMatch(/width:\s*100%/);
    expect(rule[0]).toMatch(/flex:\s*0 0 /);
  });

  it('lets the text body grow into the remaining row space', () => {
    const rule = css.match(/\.rss-social-link-card-body \{[\s\S]*?\n\}/);
    expect(rule).toBeTruthy();
    // Zero flex basis: the body fills exactly the space the thumbnail
    // leaves (a percentage width overflows once the row gap is added).
    expect(rule[0]).toMatch(/flex:\s*1 1 0/);
    // `min-width: 0` stays so long headlines ellipsize instead of
    // overflowing the card.
    expect(rule[0]).toContain('min-width: 0;');
  });
});
