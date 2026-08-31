/**
 * Ad Blocker Unit Tests
 *
 * Mocks the Electron main-process APIs and the Ghostery adblocker package
 * to verify that initializeAdBlocker() loads the filter engine with the
 * expected cache configuration and enables blocking on the default session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const enableBlockingInSession = vi.fn();
  const onBeforeRequest = vi.fn((_details, callback) => callback({}));

  return {
    enableBlockingInSession,
    onBeforeRequest,
    fromPrebuiltAdsAndTracking: vi.fn().mockResolvedValue({
      enableBlockingInSession,
      onBeforeRequest,
    }),
    getPath: vi.fn(() => '/fake/user-data'),
    defaultSession: { id: 'default-session' },
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

vi.mock('@ghostery/adblocker-electron', () => ({
  ElectronBlocker: {
    fromPrebuiltAdsAndTracking: mocks.fromPrebuiltAdsAndTracking,
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
  },
  session: {
    defaultSession: mocks.defaultSession,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

import { initializeAdBlocker } from '../../electron/adblocker.js';

describe('initializeAdBlocker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the prebuilt ads-and-tracking list with a user-data cache', async () => {
    const fetchImpl = vi.fn();

    await initializeAdBlocker(fetchImpl);

    expect(mocks.getPath).toHaveBeenCalledWith('userData');
    expect(mocks.fromPrebuiltAdsAndTracking).toHaveBeenCalledWith(
      fetchImpl,
      expect.objectContaining({
        path: '/fake/user-data/adblocker-engine.bin',
        read: mocks.readFile,
        write: mocks.writeFile,
      }),
    );

    // Ensure the named fs imports are the same references passed to the blocker.
    const { readFile, writeFile } = await import('node:fs/promises');
    expect(readFile).toBe(mocks.readFile);
    expect(writeFile).toBe(mocks.writeFile);
  });

  it('enables blocking on the default Electron session', async () => {
    await initializeAdBlocker(vi.fn());

    expect(mocks.enableBlockingInSession).toHaveBeenCalledTimes(1);
    expect(mocks.enableBlockingInSession).toHaveBeenCalledWith(mocks.defaultSession);
  });

  it('returns the configured blocker instance', async () => {
    const blocker = await initializeAdBlocker(vi.fn());

    expect(blocker).toHaveProperty('enableBlockingInSession', mocks.enableBlockingInSession);
  });

  it('allows YouTube API and media requests to bypass the blocker', async () => {
    const blocker = await initializeAdBlocker(vi.fn());
    const callback = vi.fn();

    blocker.onBeforeRequest({ url: 'https://www.youtube.com/youtubei/v1/log_event?alt=json' }, callback);

    expect(callback).toHaveBeenCalledWith({});
    expect(mocks.onBeforeRequest).not.toHaveBeenCalled();
  });

  it('allows YouTube media domains (ytimg, googlevideo) to bypass the blocker', async () => {
    const blocker = await initializeAdBlocker(vi.fn());

    const cases = [
      'https://i.ytimg.com/vi/abc123/default.jpg',
      'https://rr1---sn-abc.googlevideo.com/videoplayback?id=xyz',
      'https://youtu.be/dQw4w9WgXcQ',
    ];

    for (const url of cases) {
      const callback = vi.fn();
      blocker.onBeforeRequest({ url }, callback);
      expect(callback).toHaveBeenCalledWith({});
    }

    expect(mocks.onBeforeRequest).not.toHaveBeenCalled();
  });

  it('still blocks non-YouTube requests through the original handler', async () => {
    const blocker = await initializeAdBlocker(vi.fn());
    const callback = vi.fn();

    blocker.onBeforeRequest({ url: 'https://ads.example.com/tracker.js' }, callback);

    expect(mocks.onBeforeRequest).toHaveBeenCalledWith(
      { url: 'https://ads.example.com/tracker.js' },
      callback
    );
  });
});
