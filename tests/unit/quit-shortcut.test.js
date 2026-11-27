import { describe, it, expect } from 'vitest';
import { isQuitKeyDown } from '../../electron/quit-shortcut.js';

/**
 * Build a minimal before-input-event input descriptor.
 *
 * @param {object} [overrides] Fields to override on the descriptor
 * @returns {object} Input descriptor
 */
function keyInput(overrides = {}) {
  return {
    type: 'keyDown',
    key: 'q',
    control: true,
    ...overrides,
  };
}

describe('isQuitKeyDown', () => {
  it('matches a Ctrl+Q key-down on Linux', () => {
    expect(isQuitKeyDown(keyInput(), 'linux')).toBe(true);
  });

  it('matches a Ctrl+Q key-down on Windows', () => {
    expect(isQuitKeyDown(keyInput(), 'win32')).toBe(true);
  });

  it('matches regardless of the key case Electron reports', () => {
    expect(isQuitKeyDown(keyInput({ key: 'Q' }), 'linux')).toBe(true);
  });

  it('never matches on macOS, where the appMenu role already carries Cmd+Q', () => {
    expect(isQuitKeyDown(keyInput(), 'darwin')).toBe(false);
  });

  it('requires the Ctrl modifier', () => {
    expect(isQuitKeyDown(keyInput({ control: false }), 'linux')).toBe(false);
  });

  it('matches only the Q key', () => {
    expect(isQuitKeyDown(keyInput({ key: 'r' }), 'linux')).toBe(false);
    expect(isQuitKeyDown(keyInput({ key: 'Escape' }), 'linux')).toBe(false);
  });

  it('ignores key-up releases of Ctrl+Q', () => {
    expect(isQuitKeyDown(keyInput({ type: 'keyUp' }), 'linux')).toBe(false);
  });

  it('ignores null or missing input descriptors', () => {
    expect(isQuitKeyDown(null, 'linux')).toBe(false);
    expect(isQuitKeyDown(undefined, 'win32')).toBe(false);
  });
});
