/**
 * Original-Site Embed Unit Tests
 *
 * Covers the embed factory behind "Open Original": Electron gets a
 * <webview> (immune to frame-ancestors headers), the plain browser
 * keeps a sandboxed iframe whose blank-load detection dispatches the
 * blocked event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let electronUserAgent = false;

// Minimal CustomEvent + element stubs for the Node environment.
class StubEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function createStubElement(tagName) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    tagName,
    className: '',
    title: '',
    listeners,
    attributes,
    src: '',
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchEvent(event) {
      const handler = listeners.get(event.type);
      if (handler) {
        handler(event);
      }
      return true;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
  };
}

function stubDOM() {
  vi.stubGlobal('CustomEvent', StubEvent);
  vi.stubGlobal('window', { location: { href: 'http://localhost:3456/' } });
  vi.stubGlobal('navigator', {
    // Getter: tests flip electronUserAgent after stubbing.
    get userAgent() {
      return electronUserAgent ? 'Mozilla Electron' : 'Mozilla Firefox';
    },
  });
  vi.stubGlobal('document', {
    createElement(tag) {
      return createStubElement(tag.toUpperCase());
    },
  });
}

describe('original-embed', () => {
  beforeEach(() => {
    electronUserAgent = false;
    stubDOM();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a webview in Electron with persistent cookies and popup handling', async () => {
    electronUserAgent = true;
    const { createOriginalSiteEmbed } = await import('../../src/lib/original-embed.js');
    const embed = createOriginalSiteEmbed('https://example.com/post');

    expect(embed.tagName).toBe('WEBVIEW');
    expect(embed.getAttribute('partition')).toBe('persist:original-sites');
    expect(embed.hasAttribute('allowpopups')).toBe(true);
    expect(embed.src).toBe(''); // navigated separately
  });

  it('builds a sandboxed iframe outside Electron with no navigation yet', async () => {
    const { createOriginalSiteEmbed } = await import('../../src/lib/original-embed.js');
    const embed = createOriginalSiteEmbed('https://example.com/post');

    expect(embed.tagName).toBe('IFRAME');
    expect(embed.getAttribute('sandbox')).toContain('allow-scripts');
    expect(embed.src).toBe('');
  });

  it('does not fire blocked for the pre-navigation about:blank load', async () => {
    const { createOriginalSiteEmbed } = await import('../../src/lib/original-embed.js');
    const embed = createOriginalSiteEmbed('https://example.com/post');
    const blocked = vi.fn();
    embed.addEventListener('original-embed-blocked', blocked);

    // Simulate the insertion-time load before any real navigation.
    embed.dispatchEvent(new StubEvent('load'));

    expect(blocked).not.toHaveBeenCalled();
  });

  it('fires blocked when a navigated iframe lands on a blank document', async () => {
    vi.useFakeTimers();
    try {
      const { createOriginalSiteEmbed, navigateOriginalSiteEmbed } = await import(
        '../../src/lib/original-embed.js'
      );
      const embed = createOriginalSiteEmbed('https://framing-blocked.example/post');
      const blocked = vi.fn();
      embed.addEventListener('original-embed-blocked', blocked);

      embed.contentWindow = { location: { href: 'about:blank' } };
      navigateOriginalSiteEmbed(embed, 'https://framing-blocked.example/post');
      embed.dispatchEvent(new StubEvent('load'));
      await vi.advanceTimersByTimeAsync(600);

      expect(blocked).toHaveBeenCalledTimes(1);
      expect(blocked.mock.calls[0][0].detail.url).toBe('https://framing-blocked.example/post');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fire blocked when the iframe loaded real cross-origin content', async () => {
    vi.useFakeTimers();
    try {
      const { createOriginalSiteEmbed, navigateOriginalSiteEmbed } = await import(
        '../../src/lib/original-embed.js'
      );
      const embed = createOriginalSiteEmbed('https://example.com/post');
      const blocked = vi.fn();
      embed.addEventListener('original-embed-blocked', blocked);
      embed.contentWindow = {
        location: {
          get href() {
            throw new Error('SecurityError');
          },
        },
      };
      navigateOriginalSiteEmbed(embed, 'https://example.com/post');
      embed.dispatchEvent(new StubEvent('load'));
      await vi.advanceTimersByTimeAsync(600);

      expect(blocked).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires blocked when a navigated iframe lands back on the app origin', async () => {
    vi.useFakeTimers();
    try {
      const { createOriginalSiteEmbed, navigateOriginalSiteEmbed } = await import(
        '../../src/lib/original-embed.js'
      );
      const embed = createOriginalSiteEmbed('https://example.com/post');
      const blocked = vi.fn();
      embed.addEventListener('original-embed-blocked', blocked);

      // A site (or proxy) bouncing the frame back to the app origin is
      // as useless as a blank frame — treated as blocked.
      embed.contentWindow = { location: { href: 'http://localhost:3456/' } };
      navigateOriginalSiteEmbed(embed, 'https://example.com/post');
      embed.dispatchEvent(new StubEvent('load'));
      await vi.advanceTimersByTimeAsync(600);

      expect(blocked).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires blocked on main-frame webview load failures but not on ERR_ABORTED churn', async () => {
    electronUserAgent = true;
    const { createOriginalSiteEmbed, navigateOriginalSiteEmbed } = await import(
      '../../src/lib/original-embed.js'
    );
    const embed = createOriginalSiteEmbed('https://example.com/post');
    const blocked = vi.fn();
    embed.addEventListener('original-embed-blocked', blocked);

    navigateOriginalSiteEmbed(embed, 'https://example.com/post');
    const handler = embed.listeners.get('did-fail-load');
    handler({ isMainFrame: true, errorCode: -105 }); // real failure
    handler({ isMainFrame: true, errorCode: -3 }); // navigation churn
    handler({ isMainFrame: false, errorCode: -105 }); // subframe

    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it('ignores webview failures before the embed was navigated', async () => {
    electronUserAgent = true;
    const { createOriginalSiteEmbed } = await import('../../src/lib/original-embed.js');
    const embed = createOriginalSiteEmbed('https://example.com/post');
    const blocked = vi.fn();
    embed.addEventListener('original-embed-blocked', blocked);

    // No navigation yet: spurious attach-time failures must be ignored.
    const handler = embed.listeners.get('did-fail-load');
    handler({ isMainFrame: true, errorCode: -105 });

    expect(blocked).not.toHaveBeenCalled();
  });

  it('navigating sets the flag and points the embed at the URL', async () => {
    const { createOriginalSiteEmbed, navigateOriginalSiteEmbed } = await import(
      '../../src/lib/original-embed.js'
    );
    const embed = createOriginalSiteEmbed('https://example.com/post');
    navigateOriginalSiteEmbed(embed, 'https://example.com/post');

    expect(embed.__originalEmbedNavigated).toBe(true);
    expect(embed.src).toBe('https://example.com/post');
  });
});
