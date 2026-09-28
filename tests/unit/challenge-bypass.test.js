/**
 * Cloudflare Challenge Bypass Unit Tests
 *
 * Exercises the challenge-solving flow (probe, hidden window, visible
 * fallback, settle verification, single-flight dedupe) with mocked
 * Electron BrowserWindow and net.fetch, without launching Electron.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const winInstances = [];

vi.mock('electron', () => {
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.isDestroyedValue = false;
      this.shown = false;
      this.loadURL = vi.fn().mockResolvedValue(undefined);
      this.webContents = {
        executeJavaScript: vi.fn().mockImplementation(async () => {
          const result = this.titleQueue && this.titleQueue.length ? this.titleQueue.shift() : 'Just a moment...';
          return result;
        }),
      };
      winInstances.push(this);
    }

    destroy() {
      this.isDestroyedValue = true;
    }

    isDestroyed() {
      return this.isDestroyedValue;
    }

    show() {
      this.shown = true;
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    net: {
      fetch: vi.fn(),
    },
  };
});

import { BrowserWindow, net } from 'electron';
import {
  resolveCloudflareChallenge,
  configureChallengeSolveTimeouts,
  __resetInFlightSolvesForTests,
} from '../../electron/challenge-bypass.js';

const HTML_HEADERS = { get: () => 'text/html; charset=UTF-8' };
const CHALLENGE = {
  status: 403,
  headers: HTML_HEADERS,
  text: async () => '<html><head><title>Just a moment...</title></head></html>',
};
const NORMAL = {
  status: 200,
  headers: HTML_HEADERS,
  text: async () => '<html><body>hello</body></html>',
};

/** Queue responses for successive net.fetch calls, then repeat the last. */
function queueNetResponses(...responses) {
  let call = 0;
  net.fetch.mockImplementation(async () => {
    const response = responses[Math.min(call, responses.length - 1)];
    call++;
    return response;
  });
}

/** Wait until the solve flow has opened its first window. */
async function firstWindow() {
  await vi.waitFor(() => {
    expect(winInstances.length).toBeGreaterThan(0);
  });
  return winInstances[0];
}

describe('resolveCloudflareChallenge', () => {
  beforeEach(() => {
    winInstances.length = 0;
    net.fetch.mockReset();
    __resetInFlightSolvesForTests();
    configureChallengeSolveTimeouts({
      hiddenMs: 500,
      visibleMs: 500,
      pollMs: 10,
      settleMs: 500,
      settlePollMs: 10,
      attempts: 1,
    });
  });

  afterEach(() => {
    configureChallengeSolveTimeouts({
      hiddenMs: 20000,
      visibleMs: 120000,
      pollMs: 1500,
      settleMs: 15000,
      settlePollMs: 2000,
      attempts: 3,
    });
    vi.restoreAllMocks();
  });

  it('clears the challenge with a hidden window and verifies with a real fetch', async () => {
    // Probe: challenged. Settle probe after the title clears: OK.
    queueNetResponses(CHALLENGE, NORMAL);
    const winPromise = resolveCloudflareChallenge('https://example.com/feed');
    const win = await firstWindow();

    // First poll sees the challenge, second sees the cleared page.
    win.titleQueue = ['Just a moment...', ''];

    expect(await winPromise).toBe(true);
    expect(winInstances).toHaveLength(1);
    expect(win.options.show).toBe(false);
    expect(win.shown).toBe(false);
    expect(win.loadURL).toHaveBeenCalledWith('https://example.com/feed');
    expect(win.isDestroyed()).toBe(true);
  });

  it('shows the window for a second attempt when the hidden solve times out', async () => {
    configureChallengeSolveTimeouts({
      hiddenMs: 200,
      visibleMs: 200,
      pollMs: 10,
      settleMs: 200,
      settlePollMs: 10,
      attempts: 2,
    });
    queueNetResponses(CHALLENGE);

    const winPromise = resolveCloudflareChallenge('https://example.com/feed');

    // Wait until both attempts have opened their windows.
    await vi.waitFor(() => expect(winInstances).toHaveLength(2));

    expect(await winPromise).toBe(false);
    expect(winInstances[0].options.show).toBe(false);
    expect(winInstances[1].options.show).toBe(true);
    expect(winInstances[1].isDestroyed()).toBe(true);
  });

  it('swallows loadURL failures and still verifies via the settle probe', async () => {
    queueNetResponses(CHALLENGE, NORMAL);
    const winPromise = resolveCloudflareChallenge('https://example.com/feed');
    const win = await firstWindow();
    win.loadURL.mockRejectedValueOnce(new Error('ERR_ABORTED'));
    win.titleQueue = ['Just a moment...', ''];

    expect(await winPromise).toBe(true);
    expect(win.isDestroyed()).toBe(true);
  });

  it('returns false when nothing clears the challenge', async () => {
    queueNetResponses(CHALLENGE);
    const winPromise = resolveCloudflareChallenge('https://example.com/feed');
    const win = await firstWindow();
    win.titleQueue = ['Just a moment...'];

    expect(await winPromise).toBe(false);
    expect(win.isDestroyed()).toBe(true);
  });

  it('treats a failed title poll as not cleared and keeps verifying', async () => {
    queueNetResponses(CHALLENGE);
    const winPromise = resolveCloudflareChallenge('https://example.com/feed');
    const win = await firstWindow();
    win.webContents.executeJavaScript.mockRejectedValue(new Error('page went away'));

    expect(await winPromise).toBe(false);
    expect(win.isDestroyed()).toBe(true);
  });

  it('returns true immediately when the URL is not challenged anymore', async () => {
    queueNetResponses(NORMAL);

    expect(await resolveCloudflareChallenge('https://example.com/feed')).toBe(true);
    expect(winInstances).toHaveLength(0);
  });

  it('shares one solve job between concurrent calls for the same origin', async () => {
    queueNetResponses(CHALLENGE, NORMAL);
    const winPromise = resolveCloudflareChallenge('https://example.com/feed');
    const second = resolveCloudflareChallenge('https://example.com/other-page');
    const win = await firstWindow();
    win.titleQueue = ['Just a moment...', ''];

    const [first, deduped] = await Promise.all([winPromise, second]);
    expect(first).toBe(true);
    expect(deduped).toBe(true);
    expect(winInstances).toHaveLength(1);
  });
});

describe('configureChallengeSolveTimeouts', () => {
  it('overrides the solve budgets', async () => {
    winInstances.length = 0;
    net.fetch.mockReset();
    __resetInFlightSolvesForTests();
    configureChallengeSolveTimeouts({ hiddenMs: 100, pollMs: 5, settleMs: 100, settlePollMs: 5, attempts: 1 });
    queueNetResponses(CHALLENGE);

    const outcome = await Promise.race([
      resolveCloudflareChallenge('https://example.com/feed'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 200)),
    ]);
    expect(outcome).toBe(false);
  });
});
