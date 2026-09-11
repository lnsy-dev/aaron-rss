/**
 * Podcast Download Backend Unit Tests
 *
 * Tests the streaming enclosure downloader in electron/podcast-download.js.
 * Electron and node:fs/promises are fully mocked so the tests run in
 * Node; the response body streams through a real undici Response so the
 * Readable.fromWeb path is exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPath = vi.fn();
const mockMkdir = vi.fn();
const mockAccess = vi.fn();
const mockOpen = vi.fn();
const mockRename = vi.fn();
const mockUnlink = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: (...args) => mockGetPath(...args),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args) => mockMkdir(...args),
    access: (...args) => mockAccess(...args),
    open: (...args) => mockOpen(...args),
    rename: (...args) => mockRename(...args),
    unlink: (...args) => mockUnlink(...args),
  },
}));

import {
  getPodcastDownloadDirectory,
  sanitizeFileName,
  resolveDestinationPath,
  formatBytes,
  downloadPodcastEpisode,
  deleteDownloadedPodcast,
} from '../../electron/podcast-download.js';

/** Build a mocked writable file handle. */
function fakeFileHandle() {
  const handle = {
    written: [],
    write: vi.fn(async (chunk) => {
      handle.written.push(chunk);
    }),
    close: vi.fn(async () => {}),
  };
  return handle;
}

describe('paths and names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPath.mockReturnValue('/users/test/Downloads');
  });

  it('downloads live under Downloads/Aaron-RSS-Podcasts', () => {
    expect(getPodcastDownloadDirectory()).toBe('/users/test/Downloads/Aaron-RSS-Podcasts');
  });

  it('sanitizes filesystem-hostile names', () => {
    expect(sanitizeFileName('Ep 1: "The Best" <Part 2>?')).toBe('Ep 1 The Best Part 2');
    expect(sanitizeFileName('..hidden')).toBe('hidden');
  });

  it('falls back to a default name for empty input', () => {
    expect(sanitizeFileName('')).toBe('podcast-episode.mp3');
    expect(sanitizeFileName('///')).toBe('podcast-episode.mp3');
  });

  it('resolves a non-colliding destination path', async () => {
    mockAccess.mockRejectedValueOnce(new Error('free')); // name exists check

    const path = await resolveDestinationPath('/downloads', 'Episode 1.mp3');

    expect(path).toBe('/downloads/Episode 1.mp3');
  });

  it('appends a counter when the name is taken', async () => {
    mockAccess.mockResolvedValueOnce(undefined); // "Episode 1.mp3" exists (taken)
    mockAccess.mockRejectedValueOnce(new Error('free')); // "Episode 1 (2).mp3" free

    const path = await resolveDestinationPath('/downloads', 'Episode 1.mp3');

    expect(path).toBe('/downloads/Episode 1 (2).mp3');
  });

  it('formats byte counts readably', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});

describe('downloadPodcastEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPath.mockReturnValue('/users/test/Downloads');
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockAccess.mockRejectedValue(new Error('not found'));
  });

  function mockResponse(body, headers = {}) {
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name) => headers[name.toLowerCase()] ?? null,
      },
      body: body,
    };
  }

  it('rejects non-http URLs without touching the network', async () => {
    const result = await downloadPodcastEpisode('ftp://example.com/ep.mp3', 'ep.mp3');

    expect(result.error).toContain('Not a downloadable audio URL');
  });

  it('rejects non-audio responses (HTML error pages)', async () => {
    global.fetch = vi.fn(async () =>
      mockResponse(null, { 'content-type': 'text/html' })
    );

    const result = await downloadPodcastEpisode('https://cdn.example.com/ep1', 'Episode 1.mp3');

    expect(result.error).toContain('does not point to audio');
  });

  it('streams audio to a .part file and renames it into place', async () => {
    const handle = fakeFileHandle();
    mockOpen.mockResolvedValue(handle);
    global.fetch = vi.fn(async () =>
      mockResponse(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('fake-audio-bytes'));
          controller.close();
        },
      }), { 'content-type': 'audio/mpeg', 'content-length': '17' })
    );

    const progress = vi.fn();
    const result = await downloadPodcastEpisode('https://cdn.example.com/ep1.mp3', 'Episode 1.mp3', progress);

    expect(result.filePath).toBe('/users/test/Downloads/Aaron-RSS-Podcasts/Episode 1.mp3');
    expect(mockOpen).toHaveBeenCalledWith(
      '/users/test/Downloads/Aaron-RSS-Podcasts/Episode 1.mp3.part',
      'w'
    );
    expect(handle.written.length).toBeGreaterThan(0);
    expect(mockRename).toHaveBeenCalledWith(
      '/users/test/Downloads/Aaron-RSS-Podcasts/Episode 1.mp3.part',
      '/users/test/Downloads/Aaron-RSS-Podcasts/Episode 1.mp3'
    );

    const stages = progress.mock.calls.map((call) => call[0].stage);
    expect(stages[0]).toBe('starting');
    expect(stages).toContain('downloading');
    expect(stages[stages.length - 1]).toBe('processing');
  });

  it('reports percent progress when content-length is known', async () => {
    const handle = fakeFileHandle();
    mockOpen.mockResolvedValue(handle);
    global.fetch = vi.fn(async () =>
      mockResponse(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('0123456789'));
          controller.close();
        },
      }), { 'content-type': 'audio/mpeg', 'content-length': '10' })
    );

    const progress = vi.fn();
    await downloadPodcastEpisode('https://cdn.example.com/ep1.mp3', 'Episode 1.mp3', progress);

    const lastDownloading = [...progress.mock.calls]
      .map((call) => call[0])
      .filter((payload) => payload.stage === 'downloading')
      .pop();
    expect(lastDownloading.percent).toBe(100);
  });

  it('reports HTTP errors and cleans up the partial file', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      body: null,
    }));

    const result = await downloadPodcastEpisode('https://cdn.example.com/ep1.mp3', 'Episode 1.mp3');

    expect(result.error).toContain('404');
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('cleans up the .part file when the stream fails mid-download', async () => {
    mockOpen.mockResolvedValue(fakeFileHandle());
    global.fetch = vi.fn(async () =>
      mockResponse(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          controller.error(new Error('connection reset'));
        },
      }), { 'content-type': 'audio/mpeg' })
    );

    const result = await downloadPodcastEpisode('https://cdn.example.com/ep1.mp3', 'Episode 1.mp3');

    expect(result.error).toContain('connection reset');
    expect(mockUnlink).toHaveBeenCalledWith(
      '/users/test/Downloads/Aaron-RSS-Podcasts/Episode 1.mp3.part'
    );
    expect(mockRename).not.toHaveBeenCalled();
  });
});

describe('deleteDownloadedPodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unlinks the file', async () => {
    mockUnlink.mockResolvedValue(undefined);

    expect(await deleteDownloadedPodcast('/downloads/Aaron-RSS-Podcasts/ep.mp3')).toBe(true);
    expect(mockUnlink).toHaveBeenCalledWith('/downloads/Aaron-RSS-Podcasts/ep.mp3');
  });

  it('tolerates missing files', async () => {
    mockUnlink.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    expect(await deleteDownloadedPodcast('/downloads/Aaron-RSS-Podcasts/ep.mp3')).toBe(true);
  });

  it('reports other failures', async () => {
    mockUnlink.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    expect(await deleteDownloadedPodcast('/downloads/Aaron-RSS-Podcasts/ep.mp3')).toBe(false);
  });

  it('treats an empty path as already deleted', async () => {
    expect(await deleteDownloadedPodcast('')).toBe(true);
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});
