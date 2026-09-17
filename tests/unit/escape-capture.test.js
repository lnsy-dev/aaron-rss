/**
 * Escape Capture Unit Tests
 *
 * Tests src/lib/escape-capture.js against fake navigator.keyboard
 * objects: shouldCaptureEscape gates capture on Distraction Free Mode
 * plus full screen, and syncEscapeCapture locks/unlocks Escape only
 * when the state actually changes, degrading to "not capturing" when
 * the Keyboard Lock API is missing or refuses.
 */

import { describe, it, expect } from 'vitest';

import { shouldCaptureEscape, syncEscapeCapture } from '../../src/lib/escape-capture.js';

/**
 * Build a navigator.keyboard-like fake recording lock/unlock calls.
 *
 * @param {{rejectLock?: boolean, throwUnlock?: boolean, omitLock?: boolean}} [options]
 * @returns {object} Fake keyboard with call logs
 */
function makeFakeKeyboard({ rejectLock = false, throwUnlock = false, omitLock = false } = {}) {
  const keyboard = {
    lockedKeys: null,
    lockCalls: 0,
    unlockCalls: 0,
  };
  if (!omitLock) {
    keyboard.lock = async (keys) => {
      keyboard.lockCalls += 1;
      if (rejectLock) {
        throw new Error('Permissions check failed');
      }
      keyboard.lockedKeys = keys;
    };
  }
  keyboard.unlock = () => {
    keyboard.unlockCalls += 1;
    if (throwUnlock) {
      throw new Error('already unlocked');
    }
    keyboard.lockedKeys = null;
  };
  return keyboard;
}

describe('shouldCaptureEscape', () => {
  it('captures Escape only in Distraction Free Mode while full screen', () => {
    expect(shouldCaptureEscape({ distractionFree: true, fullScreen: true })).toBe(true);
  });

  it('does not capture outside Distraction Free Mode', () => {
    expect(shouldCaptureEscape({ distractionFree: false, fullScreen: true })).toBe(false);
  });

  it('does not capture when not full screen', () => {
    expect(shouldCaptureEscape({ distractionFree: true, fullScreen: false })).toBe(false);
  });

  it('does not capture when neither applies', () => {
    expect(shouldCaptureEscape({ distractionFree: false, fullScreen: false })).toBe(false);
  });
});

describe('syncEscapeCapture', () => {
  it('locks Escape when capture is wanted', async () => {
    const keyboard = makeFakeKeyboard();

    await expect(syncEscapeCapture(keyboard, true, false)).resolves.toBe(true);
    expect(keyboard.lockCalls).toBe(1);
    expect(keyboard.lockedKeys).toEqual(['Escape']);
  });

  it('unlocks Escape when capture is no longer wanted', async () => {
    const keyboard = makeFakeKeyboard();
    keyboard.lockedKeys = ['Escape'];

    await expect(syncEscapeCapture(keyboard, false, true)).resolves.toBe(false);
    expect(keyboard.unlockCalls).toBe(1);
    expect(keyboard.lockedKeys).toBeNull();
  });

  it('keeps the current state without touching the API when nothing changes', async () => {
    const locked = makeFakeKeyboard();
    await expect(syncEscapeCapture(locked, true, true)).resolves.toBe(true);
    expect(locked.lockCalls).toBe(0);
    expect(locked.unlockCalls).toBe(0);

    const unlocked = makeFakeKeyboard();
    await expect(syncEscapeCapture(unlocked, false, false)).resolves.toBe(false);
    expect(unlocked.lockCalls).toBe(0);
    expect(unlocked.unlockCalls).toBe(0);
  });

  it('reports not capturing when the Keyboard Lock API is missing', async () => {
    await expect(syncEscapeCapture(undefined, true, false)).resolves.toBe(false);
  });

  it('reports not capturing when keyboard lacks the lock function', async () => {
    const keyboard = makeFakeKeyboard({ omitLock: true });

    await expect(syncEscapeCapture(keyboard, true, false)).resolves.toBe(false);
    expect(keyboard.unlockCalls).toBe(0);
  });

  it('reports not capturing when the lock request is refused', async () => {
    const keyboard = makeFakeKeyboard({ rejectLock: true });

    await expect(syncEscapeCapture(keyboard, true, false)).resolves.toBe(false);
    expect(keyboard.lockCalls).toBe(1);
  });

  it('reports not capturing when unlock throws', async () => {
    const keyboard = makeFakeKeyboard({ throwUnlock: true });

    await expect(syncEscapeCapture(keyboard, false, true)).resolves.toBe(false);
  });
});
