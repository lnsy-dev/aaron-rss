/**
 * Full Screen Helpers Unit Tests
 *
 * Tests src/lib/fullscreen.js against a fake document: isFullScreen
 * reports the current state, and toggleFullScreen alternates between
 * entering and leaving, rejecting when the underlying API refuses.
 */

import { describe, it, expect } from 'vitest';

import { isFullScreen, toggleFullScreen } from '../../src/lib/fullscreen.js';

/**
 * Build a document-like fake exposing just the Fullscreen API surface
 * the module touches.
 *
 * @param {{rejectRequest?: boolean, rejectExit?: boolean}} [options]
 * @returns {Document} Fake document
 */
function makeFakeDocument({ rejectRequest = false, rejectExit = false } = {}) {
  const fake = {
    fullscreenElement: null,
    exitFullscreen: async () => {
      if (rejectExit) {
        throw new TypeError('API can only be initiated by a user gesture');
      }
      fake.fullscreenElement = null;
    },
  };
  fake.documentElement = {
    requestFullscreen: async () => {
      if (rejectRequest) {
        throw new TypeError('API can only be initiated by a user gesture');
      }
      fake.fullscreenElement = fake.documentElement;
    },
  };
  return fake;
}

describe('fullscreen helpers', () => {
  it('isFullScreen is false when no fullscreen element is active', () => {
    const doc = makeFakeDocument();
    expect(isFullScreen(doc)).toBe(false);
  });

  it('isFullScreen is true when a fullscreen element is active', () => {
    const doc = makeFakeDocument();
    doc.fullscreenElement = doc.documentElement;
    expect(isFullScreen(doc)).toBe(true);
  });

  it('toggleFullScreen enters full screen from a windowed document', async () => {
    const doc = makeFakeDocument();

    await expect(toggleFullScreen(doc)).resolves.toBe(true);
    expect(isFullScreen(doc)).toBe(true);
  });

  it('toggleFullScreen leaves full screen when already full screen', async () => {
    const doc = makeFakeDocument();
    doc.fullscreenElement = doc.documentElement;

    await expect(toggleFullScreen(doc)).resolves.toBe(false);
    expect(isFullScreen(doc)).toBe(false);
  });

  it('toggling twice returns to the windowed state', async () => {
    const doc = makeFakeDocument();

    await toggleFullScreen(doc);
    await toggleFullScreen(doc);

    expect(isFullScreen(doc)).toBe(false);
  });

  it('rejects when the environment refuses to enter full screen', async () => {
    const doc = makeFakeDocument({ rejectRequest: true });

    await expect(toggleFullScreen(doc)).rejects.toThrow('user gesture');
    expect(isFullScreen(doc)).toBe(false);
  });

  it('rejects when the environment refuses to leave full screen', async () => {
    const doc = makeFakeDocument({ rejectExit: true });
    doc.fullscreenElement = doc.documentElement;

    await expect(toggleFullScreen(doc)).rejects.toThrow('user gesture');
  });
});
