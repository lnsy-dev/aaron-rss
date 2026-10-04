/**
 * Sticky View Header CSS Unit Tests
 *
 * The Videos, Podcasts, and Read Later views keep their primary action in a
 * header row at the top of the view. That row is sticky CSS
 * (styles/rss-feed-component.css): it sticks at the app header's measured
 * height so its buttons never slide under the hamburger menu, and it is
 * opaque so the entries scrolling underneath stay hidden. These tests guard
 * that stylesheet contract plus the component's publication of the measured
 * height as a custom property.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

const componentPath = fileURLToPath(new URL('../../src/rss-feed-component.js', import.meta.url));
const componentSource = readFileSync(componentPath, 'utf8');

/**
 * Body of the first CSS rule whose selector list matches.
 *
 * @param {RegExp} selectorPattern Pattern matching the full selector list
 * @returns {string} The declarations block, or '' when no rule matches
 */
function ruleBody(selectorPattern) {
  const match = css.match(selectorPattern);
  return match ? match[0] : '';
}

describe('sticky view header CSS', () => {
  it('makes the app header opaque', () => {
    const headerRule = ruleBody(/\.rss-header \{[\s\S]*?\n\}/);
    expect(headerRule).toContain('background: var(--background-color);');
    expect(headerRule).not.toContain('background: transparent;');
  });

  it('sticks every view header below the app header', () => {
    const viewHeaderRule = ruleBody(
      /\.rss-videos-view-header,\s*\n\.rss-podcasts-view-header,\s*\n\.rss-read-later-view-header \{[\s\S]*?\n\}/
    );
    expect(viewHeaderRule).toBeTruthy();
    expect(viewHeaderRule).toContain('position: sticky;');
    // The offset comes from the measured header height, published by the
    // component as --rss-header-height.
    expect(viewHeaderRule).toContain('top: var(--rss-header-height, 0px);');
    // Stays below the app header's z-index so it never covers the
    // hamburger.
    expect(viewHeaderRule).toContain('background: var(--background-color);');
  });

  it('stays below the app header z-index', () => {
    const headerRule = ruleBody(/\.rss-header \{[\s\S]*?\n\}/);
    const viewHeaderRule = ruleBody(
      /\.rss-videos-view-header,\s*\n\.rss-podcasts-view-header,\s*\n\.rss-read-later-view-header \{[\s\S]*?\n\}/
    );
    const headerZ = Number(headerRule.match(/z-index:\s*(\d+);/)[1]);
    const viewHeaderZ = Number(viewHeaderRule.match(/z-index:\s*(\d+);/)[1]);
    expect(viewHeaderZ).toBeLessThan(headerZ);
  });

  it('pins the view headers to the top when distraction free hides the header', () => {
    const distractionFreeRule = ruleBody(
      /body\.distraction-free \.rss-videos-view-header,\s*\nbody\.distraction-free \.rss-podcasts-view-header,\s*\nbody\.distraction-free \.rss-read-later-view-header \{[\s\S]*?\n\}/
    );
    expect(distractionFreeRule).toBeTruthy();
    expect(distractionFreeRule).toContain('top: 0;');
  });
});

describe('header height publication', () => {
  it('publishes the measured header height as a custom property', () => {
    expect(componentSource).toContain("setProperty('--rss-header-height'");
    expect(componentSource).toMatch(
      /_syncHeaderHeight\(\)\s*\{[\s\S]*?getBoundingClientRect\(\)\.height[\s\S]*?\}/
    );
  });

  it('re-measures on resize and on header resize', () => {
    // The offset depends on the font size and the window width, so a single
    // measurement at startup would drift.
    expect(componentSource).toContain('new ResizeObserver(() => this._syncHeaderHeight())');
    expect(componentSource).toMatch(
      /addEventListener\('resize',[\s\S]*?_syncHeaderHeight\(\)/
    );
  });
});