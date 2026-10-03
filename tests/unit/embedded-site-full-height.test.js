/**
 * Embedded-Site Full-Height CSS Unit Tests
 *
 * The bug report: after "Open Original" started embedding sites as an
 * Electron <webview> (so Slashdot and other frame-ancestors 'self' sites
 * render in-app), the embedded page came back very short — a strip at
 * the top of the viewer instead of the full window height.
 *
 * Cause: `.rss-article-viewer-frame` was the viewer's flex item
 * (`flex: 1`), and a <webview> refuses to stretch its guest object when
 * the <webview> element is itself a flex item
 * (electron/electron#3948). The embed now lives in a plain
 * `.rss-article-viewer-embed` container that claims the remaining height,
 * with the frame absolutely filling it and the webview forced to
 * `display: flex` so Electron stretches the guest.
 *
 * These tests guard that layout contract.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * Extract a top-level CSS rule body by selector.
 *
 * @param {string} selector Exact selector text, e.g. `.rss-article-viewer-frame`
 * @returns {string|null}
 */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match ? match[1] : null;
}

describe('embedded site full-height CSS', () => {
  it('makes the embed container, not the webview, the flex item', () => {
    const container = rule('.rss-article-viewer-embed');
    expect(container).toBeTruthy();
    // Claims the height left over after the header/actions.
    expect(container).toMatch(/flex:\s*1 1 auto/);
    // Flex items default to min-height: auto, which would stop the
    // container shrinking to the available height.
    expect(container).toMatch(/min-height:\s*0/);
    // Hidden until "Open Original" switches the viewer over.
    expect(container).toMatch(/display:\s*none/);
  });

  it('stretches the frame to fill the container', () => {
    const frame = rule('.rss-article-viewer-frame');
    expect(frame).toBeTruthy();
    expect(frame).toMatch(/position:\s*absolute/);
    expect(frame).toMatch(/inset:\s*0/);
    expect(frame).toMatch(/height:\s*100%/);
    expect(frame).toMatch(/width:\s*100%/);
  });

  it('forces the Electron webview to flex so its guest object stretches', () => {
    // electron/electron#3948: the webview shadow DOM only stretches the
    // guest when the <webview> element is a flex container.
    const webview = rule('webview.rss-article-viewer-frame');
    expect(webview).toBeTruthy();
    expect(webview).toMatch(/display:\s*flex/);
  });

  it('shows the embed immediately in the standalone original viewer', () => {
    const standalone = rule('.rss-original-viewer-dialog .rss-article-viewer-embed');
    expect(standalone).toBeTruthy();
    expect(standalone).toMatch(/display:\s*block/);
  });
});
