/**
 * Video Download Toast Unit Tests
 *
 * Tests the renderer-side toast in src/lib/video-download-toast.js
 * against a minimal fake DOM. All DOM and styling live in the central
 * toast system (src/lib/toast.js), so the toasts use the shared
 * app-toast-* classes. The Electron progress bridge is mocked so
 * progress routing can be simulated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockSubscribe = vi.fn();

vi.mock('../../src/lib/youtube-bridge.js', () => ({
  onDownloadProgress: (...args) => mockSubscribe(...args),
}));

import {
  showVideoDownloadToast,
  resetVideoDownloadToasts,
} from '../../src/lib/video-download-toast.js';

/** Minimal fake DOM element with just what the toast module touches. */
class FakeElement extends EventEmitter {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this._classes = new Set();
    this._styles = {};
    this.textContent = '';
    this.classList = {
      add: (...names) => {
        for (const name of names) {
          this._classes.add(name);
        }
      },
      remove: (...names) => {
        for (const name of names) {
          this._classes.delete(name);
        }
      },
      contains: (name) => this._classes.has(name),
    };
    this.style = {
      setProperty: (name, value) => {
        this._styles[name] = value;
      },
      removeProperty: (name) => {
        delete this._styles[name];
      },
    };
  }

  /** Setting className mirrors the real DOM by resetting the class set. */
  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this._classes].join(' ');
  }

  get _classListSet() {
    return this._classes;
  }

  appendChild(child) {
    this.children.push(child);
    child._parent = this;
    return child;
  }

  remove() {
    if (this._parent) {
      const siblings = this._parent.children;
      const index = siblings.indexOf(this);
      if (index !== -1) {
        siblings.splice(index, 1);
      }
    }
    this.emit('removed');
  }

  /** Depth-first search for a descendant matching a `.class` selector. */
  querySelector(selector) {
    const className = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (child.classList?.contains(className)) {
        return child;
      }
      const found = child.querySelector?.(selector);
      if (found) {
        return found;
      }
    }
    return null;
  }
}

const fakeBody = new FakeElement('body');

vi.stubGlobal('document', {
  body: fakeBody,
  querySelector: (selector) => fakeBody.querySelector(selector),
  createElement: (tag) => new FakeElement(tag),
});

function findToasts() {
  const container = fakeBody.querySelector('app-toast-container');
  return container ? container.children : [];
}

function findToastsByClass(className) {
  const container = fakeBody.querySelector('app-toast-container');
  if (!container) {
    return [];
  }
  const matches = [];
  const walk = (element) => {
    for (const child of element.children) {
      if (child.classList?.contains(className)) {
        matches.push(child);
      }
      walk(child);
    }
  };
  walk(container);
  return matches;
}

function findProgressFill(toastRoot) {
  return toastRoot.querySelector('app-toast-progress-fill');
}

function findText(toastRoot) {
  return toastRoot.querySelector('app-toast-text');
}

describe('video download toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSubscribe.mockReset();
    // Capture the progress callback so tests can simulate IPC events.
    let captured = null;
    mockSubscribe.mockImplementation((callback) => {
      captured = callback;
      return () => {};
    });
    mockSubscribe.captured = () => captured;
    // Clear leftover DOM from prior tests (completed toasts linger until
    // their fade timers fire, which fake timers may never advance).
    fakeBody.children.length = 0;
    resetVideoDownloadToasts();
  });

  afterEach(() => {
    resetVideoDownloadToasts();
    vi.useRealTimers();
  });

  it('creates a bottom-right toast with text and an indeterminate progress bar', () => {
    const toast = showVideoDownloadToast('https://youtu.be/abc123');

    const roots = findToastsByClass('app-toast');
    expect(roots).toHaveLength(1);
    expect(findText(roots[0]).textContent).toBe('Preparing download…');

    const fill = findProgressFill(roots[0]);
    expect(fill.classList.contains('app-toast-indeterminate')).toBe(true);
    expect(typeof toast.update).toBe('function');
  });

  it('routes IPC progress events by URL and shows the percent', () => {
    showVideoDownloadToast('https://youtu.be/abc123');

    const callback = mockSubscribe.captured();
    callback({ url: 'https://youtu.be/abc123', stage: 'downloading', percent: 42.5 });

    const root = findToastsByClass('app-toast')[0];
    expect(findText(root).textContent).toBe('Downloading… 43%');
    const fill = findProgressFill(root);
    expect(fill.classList.contains('app-toast-indeterminate')).toBe(false);
    expect(fill._styles['--app-toast-progress']).toBe('42.5%');
  });

  it('switches to 100% processing state and then completes', () => {
    const toast = showVideoDownloadToast('https://youtu.be/abc123');

    const callback = mockSubscribe.captured();
    callback({ url: 'https://youtu.be/abc123', stage: 'processing', percent: 100 });

    const root = findToastsByClass('app-toast')[0];
    expect(findText(root).textContent).toBe('Processing video…');
    expect(findProgressFill(root)._styles['--app-toast-progress']).toBe('100%');

    toast.complete();
    expect(findText(root).textContent).toBe('Video saved ✓');

    // The linger (1200ms) and fade (300ms) both elapse within 1500ms.
    vi.advanceTimersByTime(1500);
    expect(findToastsByClass('app-toast')).toHaveLength(0);
  });

  it('marks failures with the error styling and cleans up', () => {
    const toast = showVideoDownloadToast('https://youtu.be/abc123');

    toast.fail('Download failed: offline');

    const root = findToastsByClass('app-toast')[0];
    expect(findText(root).textContent).toBe('Download failed: offline');
    expect(root.classList.contains('app-toast-error')).toBe(true);

    vi.advanceTimersByTime(3300);
    expect(findToastsByClass('app-toast')).toHaveLength(0);
  });

  it('replaces a stale toast for the same URL on retry', () => {
    showVideoDownloadToast('https://youtu.be/abc123');
    showVideoDownloadToast('https://youtu.be/abc123');

    expect(findToastsByClass('app-toast')).toHaveLength(1);
  });

  it('ignores progress events for unknown URLs', () => {
    showVideoDownloadToast('https://youtu.be/abc123');

    const callback = mockSubscribe.captured();
    expect(() =>
      callback({ url: 'https://youtu.be/other', stage: 'downloading', percent: 10 })
    ).not.toThrow();

    const root = findToastsByClass('app-toast')[0];
    expect(findText(root).textContent).toBe('Preparing download…');
  });
});
