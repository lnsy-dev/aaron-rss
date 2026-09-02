/**
 * Central Toast System Unit Tests
 *
 * Tests the shared toast module in src/lib/toast.js against a minimal
 * fake DOM: simple auto-dismissing toasts, progress toasts with
 * determinate/indeterminate bars, key-based dedupe, and lifecycle
 * timings for complete/fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  showToast,
  showProgressToast,
  resetToasts,
} from '../../src/lib/toast.js';

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

function findContainer() {
  return fakeBody.querySelector('app-toast-container');
}

function findToasts(className = 'app-toast') {
  const container = findContainer();
  if (!container) {
    return [];
  }
  return container.children.filter((child) => child.classList.contains(className));
}

function findText(toastRoot) {
  return toastRoot.querySelector('app-toast-text');
}

function findProgressFill(toastRoot) {
  return toastRoot.querySelector('app-toast-progress-fill');
}

describe('central toast system', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear leftover DOM from prior tests (fading toasts linger until
    // their timers fire, which fake timers may never advance).
    fakeBody.children.length = 0;
    resetToasts();
  });

  afterEach(() => {
    resetToasts();
    vi.useRealTimers();
  });

  describe('simple toasts', () => {
    it('shows a toast in the shared container and fades it out after 3s', () => {
      showToast('Settings saved');

      const toasts = findToasts();
      expect(toasts).toHaveLength(1);
      expect(findText(toasts[0]).textContent).toBe('Settings saved');

      // Still visible just before the duration elapses.
      vi.advanceTimersByTime(2900);
      expect(findToasts()).toHaveLength(1);

      // Duration (3000ms) plus fade (300ms) fully removes it.
      vi.advanceTimersByTime(500);
      expect(findToasts()).toHaveLength(0);
    });

    it('applies error styling for type error', () => {
      showToast('Refresh failed', { type: 'error' });

      const toasts = findToasts();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].classList.contains('app-toast-error')).toBe(true);
    });

    it('supports a custom duration', () => {
      showToast('Quick note', { duration: 500 });

      // Duration (500ms), the fade start tick, and the fade (300ms) fully
      // remove it; advance past the nested timer chain.
      vi.advanceTimersByTime(900);
      expect(findToasts()).toHaveLength(0);
    });
  });

  describe('progress toasts', () => {
    it('creates a toast with text and an indeterminate bar', () => {
      const toast = showProgressToast('feed-refresh', 'Refreshing feeds…');

      const toasts = findToasts();
      expect(toasts).toHaveLength(1);
      expect(findText(toasts[0]).textContent).toBe('Refreshing feeds…');
      expect(findProgressFill(toasts[0]).classList.contains('app-toast-indeterminate')).toBe(true);
      expect(typeof toast.update).toBe('function');
    });

    it('pins a determinate percent on update', () => {
      const toast = showProgressToast('feed-refresh', 'Refreshing feeds…');
      toast.update('Fetching Example…', 40);

      const root = findToasts()[0];
      expect(findText(root).textContent).toBe('Fetching Example…');
      const fill = findProgressFill(root);
      expect(fill.classList.contains('app-toast-indeterminate')).toBe(false);
      expect(fill._styles['--app-toast-progress']).toBe('40%');
    });

    it('clamps percents above 100', () => {
      const toast = showProgressToast('key', 'Working…');
      toast.update('Working…', 250);

      expect(findProgressFill(findToasts()[0])._styles['--app-toast-progress']).toBe('100%');
    });

    it('returns to the indeterminate sweep on a null percent', () => {
      const toast = showProgressToast('key', 'Working…');
      toast.update('Working…', 40);
      toast.update('Still working…', null);

      const fill = findProgressFill(findToasts()[0]);
      expect(fill.classList.contains('app-toast-indeterminate')).toBe(true);
      expect(fill._styles['--app-toast-progress']).toBeUndefined();
    });

    it('replaces a stale toast with the same key', () => {
      showProgressToast('feed-refresh', 'Refreshing feeds…');
      showProgressToast('feed-refresh', 'Refreshing feeds…');

      expect(findToasts()).toHaveLength(1);
    });

    it('keeps toasts with different keys separate', () => {
      showProgressToast('feed-refresh', 'Refreshing feeds…');
      showProgressToast('https://youtu.be/abc', 'Preparing download…');

      expect(findToasts()).toHaveLength(2);
    });

    it('complete() pins 100%, lingers 1200ms, then fades out', () => {
      const toast = showProgressToast('key', 'Working…');
      toast.complete('Refreshed 3/3 feeds');

      const root = findToasts()[0];
      expect(findText(root).textContent).toBe('Refreshed 3/3 feeds');
      expect(findProgressFill(root)._styles['--app-toast-progress']).toBe('100%');

      vi.advanceTimersByTime(1200);
      expect(findToasts()).toHaveLength(1);

      vi.advanceTimersByTime(300);
      expect(findToasts()).toHaveLength(0);
    });

    it('fail() applies error styling, lingers 3000ms, then fades out', () => {
      const toast = showProgressToast('key', 'Working…');
      toast.fail('Refresh failed: offline');

      const root = findToasts()[0];
      expect(findText(root).textContent).toBe('Refresh failed: offline');
      expect(root.classList.contains('app-toast-error')).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(findToasts()).toHaveLength(1);

      vi.advanceTimersByTime(300);
      expect(findToasts()).toHaveLength(0);
    });

    it('remove() dismisses immediately without a fade', () => {
      const toast = showProgressToast('key', 'Working…');
      toast.remove();

      expect(findToasts()).toHaveLength(0);
    });
  });
});
