/**
 * Original Embed Escape Unit Tests
 *
 * When the article viewer shows the original website, the guest page
 * takes keyboard focus and its keystrokes never reach the host document
 * — Escape would stop closing the viewer (fatal in Distraction Free
 * Mode, where Escape is the only exit). These tests guard the pieces
 * that give Escape back: the postMessage forwarder injected into
 * same-origin guest documents (src/lib/original-embed.js), the message
 * shape the component listens for, and the CSS that keeps the viewer
 * header visible as a pointer escape hatch while the original site is
 * shown.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isOriginalEmbedEscapeMessage,
  injectEscapeForwarder,
  buildEscapeForwarderScript,
  ORIGINAL_EMBED_ESCAPE_MESSAGE,
} from '../../src/lib/original-embed.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../styles/rss-feed-component.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * Build an iframe stand-in with the bits injectEscapeForwarder touches:
 * contentWindow.document (optionally throwing like a cross-origin
 * access does) with a createElement/documentElement.appendChild pair
 * that records the injected inline scripts.
 *
 * @param {{ throwOnDocumentAccess?: boolean }} [options]
 * @returns {{ frame: object, scripts: Array<{textContent: string}> }}
 */
function createFakeFrame({ throwOnDocumentAccess = false } = {}) {
  const scripts = [];
  const contentWindow = throwOnDocumentAccess
    ? {
        get document() {
          throw new Error(
            'SecurityError: Blocked a frame with origin from accessing a cross-origin frame.'
          );
        },
      }
    : {
        document: {
          createElement: vi.fn(() => ({ textContent: '' })),
          documentElement: {
            appendChild: vi.fn((script) => {
              scripts.push(script);
            }),
          },
        },
      };
  return { frame: { contentWindow }, scripts };
}

/**
 * A fake guest realm mimicking how an inline script compiles inside the
 * guest: its `document` and `window` are the guest's own. Injected
 * scripts run against the SAME realm object, like repeated executions
 * in one live document would.
 *
 * @returns {{ document: object, runScript: (source: string) => void, postMessage: Function, fireKeydown: (key: string) => void, keydownListeners: number }}
 */
function createGuestRealm() {
  const keydownListeners = [];
  const postMessage = vi.fn();
  const realm = {
    document: null,
    postMessage,
    fireKeydown: (key) => keydownListeners.forEach((listener) => listener({ key })),
    keydownListeners: () => keydownListeners.length,
    runScript(source) {
      new Function('document', 'window', source)(realm.document, realm.window);
    },
  };
  realm.document = {
    __escapeForwarderInjected: false,
    addEventListener: vi.fn((type, listener) => {
      if (type === 'keydown') {
        keydownListeners.push(listener);
      }
    }),
  };
  realm.window = { parent: { postMessage } };
  return realm;
}

describe('isOriginalEmbedEscapeMessage', () => {
  it('accepts the forwarder message shape', () => {
    expect(isOriginalEmbedEscapeMessage({ type: ORIGINAL_EMBED_ESCAPE_MESSAGE })).toBe(true);
  });

  it('rejects other payloads', () => {
    expect(isOriginalEmbedEscapeMessage({ type: 'something-else' })).toBe(false);
    expect(isOriginalEmbedEscapeMessage(null)).toBe(false);
    expect(isOriginalEmbedEscapeMessage(undefined)).toBe(false);
    expect(isOriginalEmbedEscapeMessage('original-embed-escape')).toBe(false);
  });
});

describe('buildEscapeForwarderScript', () => {
  it('serializes the message type and target origin literally', () => {
    const source = buildEscapeForwarderScript('original-embed-escape', 'https://app.example');
    expect(source).toContain('"original-embed-escape"');
    expect(source).toContain('"https://app.example"');
    expect(source).toContain("window.parent.postMessage");
  });
});

describe('injectEscapeForwarder', () => {
  it('appends one inline script to the guest document', () => {
    const { frame, scripts } = createFakeFrame();

    injectEscapeForwarder(frame, 'https://app.example');

    expect(scripts).toHaveLength(1);
    expect(scripts[0].textContent).toContain("window.parent.postMessage");
  });

  it('runs in the guest realm and forwards Escape to the host window', () => {
    const { frame, scripts } = createFakeFrame();
    injectEscapeForwarder(frame, 'https://app.example');

    const realm = createGuestRealm();
    realm.runScript(scripts[0].textContent);
    realm.fireKeydown('Escape');

    expect(realm.postMessage).toHaveBeenCalledWith(
      { type: 'original-embed-escape' },
      'https://app.example'
    );
  });

  it('does not forward other keys', () => {
    const { frame, scripts } = createFakeFrame();
    injectEscapeForwarder(frame, 'https://app.example');

    const realm = createGuestRealm();
    realm.runScript(scripts[0].textContent);
    realm.fireKeydown('Enter');
    realm.fireKeydown('q');

    expect(realm.postMessage).not.toHaveBeenCalled();
  });

  it('does not stack a second listener on the same document', () => {
    const { frame, scripts } = createFakeFrame();
    injectEscapeForwarder(frame, 'https://app.example');
    // Both injections run in the same live document: the script's own
    // guard flag must keep the second one a no-op.
    const realm = createGuestRealm();
    realm.runScript(scripts[0].textContent);
    injectEscapeForwarder(frame, 'https://app.example');
    if (scripts[1]) {
      realm.runScript(scripts[1].textContent);
    }

    realm.fireKeydown('Escape');

    expect(realm.keydownListeners()).toBe(1);
    expect(realm.postMessage).toHaveBeenCalledTimes(1);
  });

  it('survives cross-origin guests that refuse document access', () => {
    const { frame, scripts } = createFakeFrame({ throwOnDocumentAccess: true });

    expect(() => injectEscapeForwarder(frame, 'https://app.example')).not.toThrow();
    expect(scripts).toHaveLength(0);
  });
});

describe('distraction free original-viewer CSS escape hatch', () => {
  it('keeps the viewer header and actions visible while the original site is shown', () => {
    const rule = css.match(
      /body\.distraction-free\s*\n\s*\.rss-article-viewer-overlay\.rss-viewer-mode-original[\s\S]*?\n\}/
    );
    expect(rule).toBeTruthy();
    expect(rule[0]).toContain('display: flex;');
    expect(rule[0]).toContain('.rss-article-viewer-header');
    expect(rule[0]).toContain('.rss-article-viewer-actions');
  });

  it('only re-shows them in the original mode, not for every viewer', () => {
    // The base distraction free hiding rule must not mention the
    // original-mode class; the exception rule is a separate selector.
    const baseRule = css.match(
      /body\.distraction-free\s*\n\s*\.rss-article-viewer-overlay\s*\n\s*\.rss-article-viewer-header,[\s\S]*?\n\}/
    );
    expect(baseRule).toBeTruthy();
    expect(baseRule[0]).not.toContain('rss-viewer-mode-original');
  });

  it('marks the overlay with the original-mode class from the component', () => {
    const componentSource = readFileSync(
      fileURLToPath(new URL('../../src/rss-feed-component.js', import.meta.url)),
      'utf8'
    );
    expect(componentSource).toContain("classList.add('rss-viewer-mode-original')");
    expect(componentSource).toContain("classList.remove('rss-viewer-mode-original')");
  });
});
