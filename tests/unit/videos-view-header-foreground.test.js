/**
 * Videos View Header Foreground Color Unit Tests
 *
 * The Videos view header (the "N videos" count plus the "Play All"
 * button row) used the theme's muted --quaternary-color, which is hard
 * to read against the background. It should render in the theme's
 * foreground color instead.
 *
 * These tests pin the stylesheet contract: the header rule declares
 * color: var(--foreground-color), and the count label inherits it
 * rather than overriding with --quaternary-color.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * Extract a top-level CSS rule block by selector.
 *
 * @param {string} selector Selector to search for
 * @returns {string} The rule text including braces, or ''
 */
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    return '';
  }
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end + 2);
}

describe('Videos view header foreground color', () => {
  it('declares the foreground color on .rss-videos-view-header', () => {
    const headerRule = rule('.rss-videos-view-header');
    expect(headerRule).not.toBe('');
    expect(headerRule).toMatch(/color:\s*var\(--foreground-color\)/);
  });

  it('no longer paints the count label with the muted quaternary color', () => {
    const countRule = rule('.rss-videos-view-count');
    expect(countRule).not.toBe('');
    expect(countRule).not.toMatch(/--quaternary-color/);
  });

  it('lets the count label inherit the header color', () => {
    const countRule = rule('.rss-videos-view-count');
    expect(countRule).toMatch(/color:\s*inherit/);
  });

  it('leaves the sibling Podcasts view header untouched', () => {
    // The task only covers the Videos view header.
    const podcastsRule = rule('.rss-podcasts-view-count');
    expect(podcastsRule).toMatch(/color:\s*var\(--quaternary-color\)/);
  });
});
