/**
 * Electron Main-Process Crash Guard Unit Tests
 *
 * The main process performs background TLS work (ad blocker filter
 * lists, yt-dlp binaries, undici keep-alive sockets for feed/image
 * fetches) whose failures — e.g. "Error: read ETIMEDOUT at
 * TLSWrap.onStreamRead" — surfaced as the fatal "Uncaught Exception"
 * dialog and killed the packaged app. installProcessErrorGuards()
 * converts those events into log calls instead.
 *
 * These tests register the guards against the real process object,
 * capture the handlers via the process.on spy, and invoke them
 * directly (throwing a real uncaughtException in a test would fail
 * the test run, so the handler is called as a function).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installProcessErrorGuards } from '../../electron/error-guards.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('installProcessErrorGuards', () => {
  let onSpy;
  let removeListenerSpy;
  let registered;

  beforeEach(() => {
    registered = { unhandledRejection: [], uncaughtException: [] };
    onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (registered[event]) {
        registered[event].push(handler);
      }
      return process;
    });
    removeListenerSpy = vi.spyOn(process, 'removeListener').mockImplementation((event, handler) => {
      if (registered[event]) {
        registered[event] = registered[event].filter((h) => h !== handler);
      }
      return process;
    });
  });

  afterEach(() => {
    onSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it('registers uncaughtException and unhandledRejection handlers', () => {
    const installed = installProcessErrorGuards();

    expect(installed).toBe(true);
    expect(registered.uncaughtException).toHaveLength(1);
    expect(registered.unhandledRejection).toHaveLength(1);
  });

  it('logs uncaught errors instead of crashing', () => {
    const log = vi.fn();
    installProcessErrorGuards({ log });

    const error = new Error('read ETIMEDOUT');
    registered.uncaughtException[0](error);
    registered.unhandledRejection[0](error);

    // Both events reach the logger; neither throws.
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('uncaughtException', error);
    expect(log).toHaveBeenCalledWith('unhandledRejection', error);
  });

  it('handles non-Error rejection reasons', () => {
    const log = vi.fn();
    installProcessErrorGuards({ log });

    registered.unhandledRejection[0]('just a string');

    expect(log).toHaveBeenCalledWith('unhandledRejection', 'just a string');
  });

  it('replaces previous install handlers instead of stacking duplicates', () => {
    installProcessErrorGuards();
    installProcessErrorGuards();

    expect(registered.uncaughtException).toHaveLength(1);
    expect(registered.unhandledRejection).toHaveLength(1);
  });

  it('default logging writes to console.error with a [electron] prefix', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      installProcessErrorGuards();

      registered.uncaughtException[0](new Error('boom'));
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('[electron] Suppressed uncaughtException'),
        expect.stringContaining('boom'),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('electron main crash guard wiring', () => {
  it('electron/main.js installs the process error guards', () => {
    const source = readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');
    expect(source).toContain('installProcessErrorGuards');
  });
});
