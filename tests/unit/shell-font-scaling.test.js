/**
 * Shell Font Scaling Unit Tests
 *
 * The Cmd/Ctrl+= / - / 0 shortcuts used to scale only the reading pane
 * (.rss-markdown-content, the social viewer). The app chrome — the main
 * header, the feed list rows, the view headers, and the action buttons —
 * kept its normal size no matter the step.
 *
 * These tests pin the stylesheet contract: every chrome text surface has
 * a rule that multiplies its own base by --article-font-scale, gated on
 * a non-default step (step0 leaves everything at the unscaled size).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

const PREFIX = 'rss-feed-component[data-article-font-step]:not([data-article-font-step="step0"])';

/**
 * Collect every font-size declaration in a rule block.
 *
 * @param {string} selector Full selector to search for
 * @returns {string[]} font-size declaration values in that block
 */
function fontSizesFor(selector) {
  const rule = css
    .split('\n\n')
    .find((chunk) => chunk.includes(selector) && chunk.includes('font-size:'));
  if (!rule) {
    return [];
  }
  return [...rule.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
}

describe('shell font scaling', () => {
  it.each([
    ['.rss-hamburger', '1rem'],
    ['.rss-unread-count', '0.875rem'],
    ['.rss-feed-title', '1em'],
    ['.rss-unread-badge', '0.8rem'],
    ['.rss-kebab-button', '1.1rem'],
    ['.rss-article-title', '1em'],
    ['.rss-article-meta', '0.8rem'],
    ['.rss-article-summary', '0.9rem'],
    ['.rss-article-feed-name', '1em'],
    ['.rss-article-downloaded-badge', '0.8rem'],
  ])('scales %s from its %s base', (selector, base) => {
    const sizes = fontSizesFor(`${PREFIX} ${selector}`);
    expect(sizes).toContain(`calc(var(--article-font-scale) * ${base})`);
  });

  it('scales the three view-header counts from their shared 0.85rem base', () => {
    const sizes = fontSizesFor(`${PREFIX} .rss-videos-view-count`);
    expect(sizes).toContain('calc(var(--article-font-scale) * 0.85rem)');
    expect(fontSizesFor(`${PREFIX} .rss-podcasts-view-count`)).toEqual(
      fontSizesFor(`${PREFIX} .rss-videos-view-count`)
    );
    expect(fontSizesFor(`${PREFIX} .rss-read-later-view-count`)).toEqual(
      fontSizesFor(`${PREFIX} .rss-videos-view-count`)
    );
  });

  it('scales the action buttons and the article viewer header', () => {
    const buttonSizes = fontSizesFor(`${PREFIX} .rss-action-button`);
    expect(buttonSizes).toContain('calc(var(--article-font-scale) * 0.85rem)');

    const viewerTitleSizes = fontSizesFor(`${PREFIX} .rss-article-viewer-header h2`);
    expect(viewerTitleSizes).toContain(
      'calc(var(--article-font-scale) * var(--h3-font-size))'
    );

    const backSizes = fontSizesFor(`${PREFIX} .rss-article-viewer-back`);
    expect(backSizes).toContain('calc(var(--article-font-scale) * 0.85rem)');
  });

  it('leaves the unscaled (step0) chrome rules untouched', () => {
    // The plain rules keep their original fixed sizes; the scale only
    // applies under the gated prefix.
    const plainHamburger = css.match(/(?<!\[)^(?!\s)(\r?\n)?\.rss-hamburger \{[^}]*\}/m);
    expect(plainHamburger).toBeTruthy();
    expect(plainHamburger[0]).toContain('font-size: 1rem');

    const plainBadge = css.match(/^\.rss-unread-count \{[^}]*\}/m);
    expect(plainBadge).toBeTruthy();
    expect(plainBadge[0]).toContain('font-size: 0.875rem');
  });

  it('does not scale .rss-article-content (its social embeds would double-scale)', () => {
    // The timeline enrichment renders .rss-social-embed inside
    // .rss-article-content; the embed rule already multiplies 1em, so
    // scaling the container too would square the factor.
    expect(fontSizesFor(`${PREFIX} .rss-article-content`)).toEqual([]);
  });
});
