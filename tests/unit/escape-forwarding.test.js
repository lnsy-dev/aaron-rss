/**
 * Escape Forwarding Unit Tests
 *
 * The "Show Original" viewer embeds the article's real website as a
 * <webview> guest. Once that guest has keyboard focus, its key events
 * arrive at the guest's own webContents and never at the main window's
 * before-input-event listener, so electron/main.js relays Escape from
 * every webview guest over the 'escape-pressed' IPC channel. These
 * tests exercise the relay decision logic in
 * electron/escape-forwarding.js with a plain EventEmitter fake —
 * no Electron runtime needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  isEscapeKeyDown,
  attachGuestEscapeForwarding,
} from '../../electron/escape-forwarding.js';

/**
 * Build a fake webContents exposing just the event API the relay uses.
 *
 * @returns {EventEmitter} Emitter standing in for a WebContents
 */
function fakeWebContents() {
  return new EventEmitter();
}

describe('isEscapeKeyDown', () => {
  it('matches only Escape key-down presses', () => {
    expect(isEscapeKeyDown({ type: 'keyDown', key: 'Escape' })).toBe(true);
  });

  it('rejects other keys and other event types', () => {
    expect(isEscapeKeyDown({ type: 'keyDown', key: 'Enter' })).toBe(false);
    expect(isEscapeKeyDown({ type: 'keyDown', key: 'escape' })).toBe(false);
    expect(isEscapeKeyDown({ type: 'keyUp', key: 'Escape' })).toBe(false);
    expect(isEscapeKeyDown({ type: 'rawKeyDown', key: 'Escape' })).toBe(false);
  });

  it('rejects missing or malformed input', () => {
    expect(isEscapeKeyDown(null)).toBe(false);
    expect(isEscapeKeyDown(undefined)).toBe(false);
    expect(isEscapeKeyDown({})).toBe(false);
  });
});

describe('attachGuestEscapeForwarding', () => {
  it('calls send for each Escape key-down on the guest', () => {
    const webContents = fakeWebContents();
    const send = vi.fn();
    attachGuestEscapeForwarding(webContents, send);

    webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
    webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not call send for other keys', () => {
    const webContents = fakeWebContents();
    const send = vi.fn();
    attachGuestEscapeForwarding(webContents, send);

    for (const input of [
      { type: 'keyDown', key: 'ArrowDown' },
      { type: 'keyDown', key: 'Enter' },
      { type: 'keyUp', key: 'Escape' },
      { type: 'keyDown', key: '?' , modifiers: ['control'] },
    ]) {
      webContents.emit('before-input-event', {}, input);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it('never preventDefaults the event: the embedded site keeps its own Escape handling', () => {
    const webContents = fakeWebContents();
    attachGuestEscapeForwarding(webContents, vi.fn());

    const event = { preventDefault: vi.fn() };
    webContents.emit('before-input-event', event, { type: 'keyDown', key: 'Escape' });

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps forwarding across multiple presses (persistent listener)', () => {
    const webContents = fakeWebContents();
    const send = vi.fn();
    attachGuestEscapeForwarding(webContents, send);

    for (let press = 0; press < 5; press++) {
      webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
    }

    expect(send).toHaveBeenCalledTimes(5);
  });
});

describe('main.js wiring', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const mainSource = readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  it('relays Escape from webview guest webContents, not just the main window', () => {
    // The relay must be attached inside the webview branch of the
    // app-level web-contents-created handler; attaching it to the main
    // window alone does nothing once the guest holds keyboard focus.
    expect(mainSource).toContain("getType() !== 'webview'");
    expect(mainSource).toContain('attachGuestEscapeForwarding(webContents, forwardEscapeToMainWindow)');
  });

  it('reuses the same forwarding decision on the main window path', () => {
    expect(mainSource).toContain('if (isEscapeKeyDown(input)) {');
    expect(mainSource).toContain('forwardEscapeToMainWindow()');
  });
});
