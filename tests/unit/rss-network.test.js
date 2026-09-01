/**
 * RSS Network fetchBytes Unit Tests
 *
 * Verifies the binary fetch helper uses the Electron preload bridge
 * when available and falls back to renderer fetch() otherwise.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('fetchBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the Electron bridge in Electron and forwards its result', async () => {
    const buffer = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla Electron' });
    vi.stubGlobal('window', {
      electron: {
        fetchBytes: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          buffer,
          contentType: 'image/png',
        }),
      },
    });

    // Fresh import so the module sees the stubbed globals.
    const { fetchBytes } = await import('../../src/lib/rss-network.js');
    const response = await fetchBytes('https://example.com/img.png');

    expect(window.electron.fetchBytes).toHaveBeenCalledWith('https://example.com/img.png');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.buffer).toBe(buffer);
    expect(response.contentType).toBe('image/png');
  });

  it('falls back to renderer fetch outside Electron', async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([9, 8]).buffer,
      headers: { get: () => 'image/jpeg' },
    };
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Chrome' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse));

    const { fetchBytes } = await import('../../src/lib/rss-network.js');
    const response = await fetchBytes('https://example.com/photo.jpg');

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/photo.jpg');
    expect(response.ok).toBe(true);
    expect(new Uint8Array(response.buffer)).toEqual(new Uint8Array([9, 8]));
    expect(response.contentType).toBe('image/jpeg');
  });

  it('returns a failed response instead of throwing on network errors', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Chrome' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const { fetchBytes } = await import('../../src/lib/rss-network.js');
    const response = await fetchBytes('https://example.com/broken');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(0);
  });

  it('normalizes scheme-less URLs before fetching', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Chrome' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<rss></rss>',
      headers: { get: () => 'text/xml' },
    }));

    const { fetchText } = await import('../../src/lib/rss-network.js');
    await fetchText('example.com/feed');

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/feed');
  });
});

describe('fetchText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the Electron bridge in Electron and forwards its result', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla Electron' });
    vi.stubGlobal('window', {
      electron: {
        fetchText: vi.fn().mockResolvedValue({ ok: true, status: 200, text: '<rss/>', contentType: 'text/xml' }),
      },
    });

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/rss');

    expect(window.electron.fetchText).toHaveBeenCalledWith('https://example.com/rss');
    expect(response.ok).toBe(true);
    expect(response.text).toBe('<rss/>');
    expect(response.contentType).toBe('text/xml');
  });

  it('falls back to renderer fetch outside Electron and reports the content type', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Chrome' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not found',
      headers: { get: () => 'application/json' },
    }));

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/missing');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    expect(response.contentType).toBe('application/json');
  });

  it('returns a failed response instead of throwing on network errors', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Chrome' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const { fetchText } = await import('../../src/lib/rss-network.js');
    const response = await fetchText('https://example.com/broken');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(0);
    expect(response.contentType).toBe('');
  });
});
