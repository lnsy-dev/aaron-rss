/**
 * Media cleanup unit tests.
 *
 * Closing a viewer must stop its media deterministically — detached
 * <video>/<audio> elements are not reliably paused on every platform
 * when they leave the DOM. These tests cover the teardown helpers in
 * src/lib/media-cleanup.js against plain fake elements, asserting the
 * exact calls the component relies on.
 */

import { describe, it, expect, vi } from 'vitest';
import { stopMediaElement, stopMediaPlayback } from '../../src/lib/media-cleanup.js';

/**
 * Build a fake HTMLMediaElement that records the teardown calls.
 *
 * @returns {object} Fake element with pause/removeAttribute/load spies
 */
function fakeMediaElement() {
  return {
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
}

/**
 * Build a fake root element whose querySelectorAll returns a fixed list.
 *
 * @param {Array<object>} elements Elements to hand out
 * @returns {object} Fake root
 */
function fakeRoot(elements) {
  return {
    querySelectorAll: vi.fn(() => elements),
  };
}

describe('stopMediaElement', () => {
  it('pauses the element, drops its source and resets it', () => {
    const media = fakeMediaElement();

    expect(stopMediaElement(media)).toBe(true);

    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(media.removeAttribute).toHaveBeenCalledWith('src');
    expect(media.load).toHaveBeenCalledTimes(1);
  });

  it('returns false and does nothing for null', () => {
    expect(stopMediaElement(null)).toBe(false);
  });

  it('returns false for an object without a pause method', () => {
    expect(stopMediaElement({})).toBe(false);
  });

  it('keeps resetting the element when pause throws', () => {
    const media = fakeMediaElement();
    media.pause.mockImplementation(() => {
      throw new Error('no playback state');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(stopMediaElement(media)).toBe(true);

    expect(media.removeAttribute).toHaveBeenCalledWith('src');
    expect(media.load).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('keeps the pause when load throws', () => {
    const media = fakeMediaElement();
    media.load.mockImplementation(() => {
      throw new Error('load refused');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(stopMediaElement(media)).toBe(true);

    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(media.removeAttribute).toHaveBeenCalledWith('src');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe('stopMediaPlayback', () => {
  it('stops every video and audio element under the root', () => {
    const videoA = fakeMediaElement();
    const videoB = fakeMediaElement();
    const audio = fakeMediaElement();
    const root = fakeRoot([videoA, videoB, audio]);

    expect(stopMediaPlayback(root)).toBe(3);

    expect(videoA.pause).toHaveBeenCalledTimes(1);
    expect(videoB.pause).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    for (const media of [videoA, videoB, audio]) {
      expect(media.removeAttribute).toHaveBeenCalledWith('src');
      expect(media.load).toHaveBeenCalledTimes(1);
    }
  });

  it('returns 0 for a root without media elements', () => {
    const root = fakeRoot([]);

    expect(stopMediaPlayback(root)).toBe(0);
    expect(root.querySelectorAll).toHaveBeenCalledWith('video, audio');
  });

  it('returns 0 for null and for non-element roots', () => {
    expect(stopMediaPlayback(null)).toBe(0);
    expect(stopMediaPlayback({})).toBe(0);
  });

  it('stops the remaining elements when one of them throws on pause', () => {
    const first = fakeMediaElement();
    first.pause.mockImplementation(() => {
      throw new Error('boom');
    });
    const second = fakeMediaElement();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(stopMediaPlayback(fakeRoot([first, second]))).toBe(2);

    expect(second.pause).toHaveBeenCalledTimes(1);
    expect(second.load).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
