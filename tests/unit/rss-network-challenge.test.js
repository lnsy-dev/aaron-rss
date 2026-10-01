/**
 * RSS Network Challenge Retry Unit Tests
 *
 * Verifies the renderer network helpers reuse the Electron bridge for
 * every fetch and retry through resolveFeedChallenge when the main
 * process reports a Cloudflare challenge.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></head><body>challenge</body></html>';
const FEED_XML = '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>';

function stubElectronBridge(overrides = {}) {
  const electron = {
    fetchText: vi.fn(),
    fetchBytes: vi.fn(),
    resolveFeedChallenge: vi.fn(),
    onResolveChallengeStatus: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
  vi.stubGlobal('navigator', { userAgent: 'Mozilla Electron' });
  vi.stubGlobal('window', { electron });
  return electron;
}

describe('rss-network challenge retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries through resolveFeedChallenge after clearing a challenge', async () => {
    const electron = stubElectronBridge({
      fetchText: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 403, text: CHALLENGE_PAGE, contentType: 'text/html' })
        .mockResolvedValueOnce({ ok: true, status: 200, text: FEED_XML, contentType: 'application/rss+xml' }),
      resolveFeedChallenge: vi.fn().mockResolvedValue({ cleared: true }),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/feed');

    expect(electron.resolveFeedChallenge).toHaveBeenCalledTimes(1);
    expect(electron.resolveFeedChallenge).toHaveBeenCalledWith('https://example.com/feed');
    expect(electron.fetchText).toHaveBeenCalledTimes(2);
    expect(response).toEqual({ ok: true, status: 200, text: FEED_XML, contentType: 'application/rss+xml' });
  });

  it('keeps the challenge response when the solver fails', async () => {
    const electron = stubElectronBridge({
      fetchText: vi.fn().mockResolvedValue({ ok: false, status: 403, text: CHALLENGE_PAGE, contentType: 'text/html' }),
      resolveFeedChallenge: vi.fn().mockResolvedValue({ cleared: false }),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/feed');

    expect(electron.resolveFeedChallenge).toHaveBeenCalledTimes(1);
    expect(electron.fetchText).toHaveBeenCalledTimes(1);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
  });

  it('forwards the challenge flag to the bridge by default', async () => {
    const electron = stubElectronBridge({
      fetchText: vi.fn().mockResolvedValue({ ok: true, status: 200, text: FEED_XML, contentType: 'application/rss+xml' }),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    await fetchText('https://example.com/feed');

    // The bridge reads this to decide whether its hidden auto-solve may
    // run; ordinary fetches keep it enabled.
    expect(electron.fetchText).toHaveBeenCalledWith('https://example.com/feed', { clearChallenges: true });
  });

  it('never invokes the solver when clearChallenges is false', async () => {
    // Article extraction fetches this way: a challenge must come back
    // as-is (so the viewer can show the website instead) with no hidden
    // stall and no visible window.
    const electron = stubElectronBridge({
      fetchText: vi.fn().mockResolvedValue({ ok: false, status: 403, text: CHALLENGE_PAGE, contentType: 'text/html' }),
      resolveFeedChallenge: vi.fn().mockResolvedValue({ cleared: true }),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/post', { clearChallenges: false });

    expect(electron.fetchText).toHaveBeenCalledTimes(1);
    expect(electron.fetchText).toHaveBeenCalledWith('https://example.com/post', { clearChallenges: false });
    expect(electron.resolveFeedChallenge).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(response.text).toBe(CHALLENGE_PAGE);
  });

  it('does not invoke the solver for normal responses', async () => {
    const electron = stubElectronBridge({
      fetchText: vi.fn().mockResolvedValue({ ok: true, status: 200, text: FEED_XML, contentType: 'application/rss+xml' }),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    await fetchText('https://example.com/feed');

    expect(electron.resolveFeedChallenge).not.toHaveBeenCalled();
    expect(electron.fetchText).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the solver for a bare 403 without challenge markers (parked domain)', async () => {
    const electron = stubElectronBridge({
      fetchText: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: '<html><head><title>Domain Auction</title></head><body>buy this domain</body></html>',
        contentType: 'text/html',
      }),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/feed');

    expect(electron.resolveFeedChallenge).not.toHaveBeenCalled();
    expect(electron.fetchText).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
  });

  it('retries fetchBytes for challenges too', async () => {
    const buffer = new Uint8Array([1, 2, 3]);
    const electron = stubElectronBridge({
      fetchBytes: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 403, text: CHALLENGE_PAGE, contentType: 'text/html' })
        .mockResolvedValueOnce({ ok: true, status: 200, buffer, contentType: 'image/png' }),
      resolveFeedChallenge: vi.fn().mockResolvedValue({ cleared: true }),
    });

    const { fetchBytes } = await import('../../src/lib/rss-network.js');
    const response = await fetchBytes('https://example.com/img.png');

    expect(electron.resolveFeedChallenge).toHaveBeenCalledTimes(1);
    expect(electron.fetchBytes).toHaveBeenCalledTimes(2);
    expect(response.buffer).toBe(buffer);
  });

  it('treats a thrown solver as no-clearance and surfaces the challenge response', async () => {
    const electron = stubElectronBridge({
      fetchText: vi.fn().mockResolvedValue({ ok: false, status: 503, text: CHALLENGE_PAGE, contentType: 'text/html' }),
      resolveFeedChallenge: vi.fn().mockRejectedValue(new Error('window failed')),
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/feed');

    expect(electron.fetchText).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });
});
