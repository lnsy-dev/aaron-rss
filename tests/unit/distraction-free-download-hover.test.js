/**
 * Distraction Free Download Hover CSS Unit Tests
 *
 * The hover-reveal of the "Download Video" / "Download Podcast" action
 * in Distraction Free Mode is pure CSS (styles/rss-feed-component.css).
 * These tests guard the stylesheet contract: the actions stay hidden in
 * distraction free mode, article hover reveals the container, and every
 * non-download action button inside it stays hidden.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

const componentPath = fileURLToPath(
  new URL('../../src/rss-feed-component.js', import.meta.url)
);
const componentSource = readFileSync(componentPath, 'utf8');

describe('distraction free download hover CSS', () => {
  it('hides the per-article actions in distraction free mode', () => {
    expect(css).toMatch(
      /body\.distraction-free \.rss-header,\s*\nbody\.distraction-free \.rss-footer,\s*\nbody\.distraction-free \.rss-article-actions \{\s*\n  display: none;\s*\n\}/
    );
  });

  it('reveals the actions container while hovering an article', () => {
    expect(css).toMatch(
      /body\.distraction-free \.rss-article:hover \.rss-article-actions \{\s*\n  display: flex;\s*\n\}/
    );
  });

  it('keeps every non-download action button hidden inside the reveal', () => {
    const rule = css.match(
      /body\.distraction-free\s*\n\s*\.rss-article:hover\s*\n\s*\.rss-article-actions\s*\n\s*\.rss-action-button:not\([^)]+\):not\([^)]+\) \{[\s\S]*?\n\}/
    );
    expect(rule).toBeTruthy();
    expect(rule[0]).toContain('display: none;');
    // Only the YouTube "Download Video" and podcast "Download Podcast"
    // buttons survive the filter.
    expect(rule[0]).toContain(':not(.rss-youtube-download-button)');
    expect(rule[0]).toContain(':not(.rss-podcast-download-button)');
  });

  it('stamps the download buttons with the classes the reveal filter keeps', () => {
    // The CSS filter keys off these classes, so the renderer must keep
    // stamping them on the YouTube and podcast download actions.
    expect(componentSource).toContain("className = 'rss-action-button rss-podcast-download-button'");
    expect(componentSource).toContain("className = 'rss-action-button rss-youtube-download-button'");
  });
});
