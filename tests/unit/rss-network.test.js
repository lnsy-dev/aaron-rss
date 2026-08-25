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
});
