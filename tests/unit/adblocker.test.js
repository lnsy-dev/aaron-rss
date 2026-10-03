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

  /** A session stub whose webRequest records registered listeners. */
  const makeSession = (id) => ({
    id,
    webRequest: {
      onBeforeRequest: vi.fn(),
      onHeadersReceived: vi.fn(),
    },
  });

  const defaultSession = makeSession('default-session');
  const originalSitesSession = makeSession('original-sites-session');

  return {
    enableBlockingInSession,
    onBeforeRequest,
    fromPrebuiltAdsAndTracking: vi.fn().mockResolvedValue({
      enableBlockingInSession,
      onBeforeRequest,
    }),
    getPath: vi.fn(() => '/fake/user-data'),
    defaultSession,
    originalSitesSession,
    fromPartition: vi.fn(() => originalSitesSession),
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
    fromPartition: mocks.fromPartition,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

import { initializeAdBlocker, ORIGINAL_SITES_PARTITION } from '../../electron/adblocker.js';

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

  it("registers network filtering on the 'Open Original' viewer's partition session", async () => {
    await initializeAdBlocker(vi.fn());

    // The viewer's <webview> opts into this exact partition (see
    // src/lib/original-embed.js); the session is separate from the default
    // session, so it needs its own request listeners.
    expect(mocks.fromPartition).toHaveBeenCalledWith(ORIGINAL_SITES_PARTITION);
    expect(mocks.originalSitesSession.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['<all_urls>'] },
      expect.any(Function),
    );
    expect(mocks.originalSitesSession.webRequest.onHeadersReceived).toHaveBeenCalledWith(
      { urls: ['<all_urls>'] },
      expect.any(Function),
    );
  });

  it('does not use enableBlockingInSession for the partition session', async () => {
    // enableBlockingInSession registers GLOBAL ipcMain handlers, which throws
    // on the second session and aborts before its webRequest listeners are
    // attached. Only the default session may go through it.
    await initializeAdBlocker(vi.fn());

    expect(mocks.enableBlockingInSession).toHaveBeenCalledTimes(1);
    expect(mocks.enableBlockingInSession).toHaveBeenCalledWith(mocks.defaultSession);
  });

  it('routes partition-session requests through the YouTube bypass', async () => {
    const blocker = await initializeAdBlocker(vi.fn());
    const registered = mocks.originalSitesSession.webRequest.onBeforeRequest.mock.calls[0][1];
    const callback = vi.fn();

    registered({ url: 'https://i.ytimg.com/vi/abc/default.jpg' }, callback);

    expect(callback).toHaveBeenCalledWith({});
    expect(mocks.onBeforeRequest).not.toHaveBeenCalled();
  });

  it('filters partition-session requests through the blocker', async () => {
    const blocker = await initializeAdBlocker(vi.fn());
    const registered = mocks.originalSitesSession.webRequest.onBeforeRequest.mock.calls[0][1];
    const callback = vi.fn();

    registered({ url: 'https://ads.example.com/tracker.js' }, callback);

    expect(mocks.onBeforeRequest).toHaveBeenCalledWith(
      { url: 'https://ads.example.com/tracker.js' },
      callback,
    );
  });
});
