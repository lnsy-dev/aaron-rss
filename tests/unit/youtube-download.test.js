/**
 * YouTube Download Backend Unit Tests
 *
 * Tests the yt-dlp update/check logic in electron/youtube-download.js.
 * Electron and yt-dlp-wrap-plus are fully mocked so the tests run in Node.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

const mockGetPath = vi.fn();
const mockAccess = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockMkdir = vi.fn();
const mockUnlink = vi.fn();
const mockReaddir = vi.fn();
const mockChmod = vi.fn();
const mockCopyFile = vi.fn();
const mockRm = vi.fn();
const mockExecFile = vi.fn();
const mockFetch = vi.fn();

const mockGetVersion = vi.fn();
const mockExecPromise = vi.fn();
const mockExec = vi.fn();
const mockGetVideoInfo = vi.fn();
const mockDownloadFromGithub = vi.fn();
const mockGetGithubReleases = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: (...args) => mockGetPath(...args),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: (...args) => mockAccess(...args),
    writeFile: (...args) => mockWriteFile(...args),
    readFile: (...args) => mockReadFile(...args),
    mkdir: (...args) => mockMkdir(...args),
    unlink: (...args) => mockUnlink(...args),
    readdir: (...args) => mockReaddir(...args),
    chmod: (...args) => mockChmod(...args),
    copyFile: (...args) => mockCopyFile(...args),
    rm: (...args) => mockRm(...args),
  },
}));

vi.mock('node:child_process', () => ({
  execFile: (command, args, callback) => {
    Promise.resolve()
      .then(() => mockExecFile(command, args))
      .then(
        () => callback(null, '', ''),
        (error) => callback(error)
      );
  },
}));

vi.mock('yt-dlp-wrap-plus', () => ({
  default: class MockYTDlpWrap {
    constructor() {
      this.getVersion = (...args) => mockGetVersion(...args);
      this.execPromise = (...args) => mockExecPromise(...args);
      this.getVideoInfo = (...args) => mockGetVideoInfo(...args);
      // The download step uses the event-emitter form so progress can be
      // streamed; emit one progress tick then a clean close by default.
      this.exec = (...args) => {
        mockExec(...args);
        const emitter = new EventEmitter();
        queueMicrotask(() => {
          emitter.emit('progress', { percent: 42.5, totalSize: '1.00MiB', currentSpeed: '1.00MiB/s', eta: '00:01' });
          emitter.emit('close', 0);
        });
        return emitter;
      };
    }

    static downloadFromGithub(...args) {
      return mockDownloadFromGithub(...args);
    }

    static getGithubReleases(...args) {
      return mockGetGithubReleases(...args);
    }
  },
}));

async function importYoutubeDownload() {
  return await import('../../electron/youtube-download.js');
}

describe('youtube download backend', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockGetPath.mockImplementation((name) => `/mock/${name}`);
    mockAccess.mockRejectedValue(new Error('not found'));
    mockReadFile.mockRejectedValue(new Error('not found'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockDownloadFromGithub.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.06');
    mockGetGithubReleases.mockResolvedValue([{ tag_name: '2023.07.06' }]);
    mockCopyFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
    // Default to network failures so provisioning is skipped unless a test
    // explicitly provides GitHub responses.
    mockFetch.mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checkForYTDlpUpdate downloads the binary when it is missing', async () => {
    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(mockDownloadFromGithub).toHaveBeenCalledWith('/mock/userData/yt-dlp', undefined);
    expect(result.updated).toBe(true);
  });

  it('checkForYTDlpUpdate updates when a newer version is available', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.05');
    mockGetGithubReleases.mockResolvedValue([{ tag_name: '2023.07.06' }]);

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(mockDownloadFromGithub).toHaveBeenCalledWith('/mock/userData/yt-dlp', '2023.07.06');
    expect(result.updated).toBe(true);
    expect(result.version).toBe('2023.07.06');
  });

  it('checkForYTDlpUpdate does nothing when already up to date', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.06');
    mockGetGithubReleases.mockResolvedValue([{ tag_name: '2023.07.06' }]);

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(mockDownloadFromGithub).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
    expect(result.version).toBe('2023.07.06');
  });

  it('checkForYTDlpUpdate handles a newer installed version than the latest release', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.07');
    mockGetGithubReleases.mockResolvedValue([{ tag_name: '2023.07.06' }]);

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(mockDownloadFromGithub).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
  });

  it('checkForYTDlpUpdate ignores non-date version prefixes when comparing', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.05');
    mockGetGithubReleases.mockResolvedValue([{ tag_name: 'yt-dlp-2023.07.06' }]);

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(mockDownloadFromGithub).toHaveBeenCalledWith('/mock/userData/yt-dlp', 'yt-dlp-2023.07.06');
    expect(result.updated).toBe(true);
  });

  it('checkForYTDlpUpdate returns an error when the version check fails', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockRejectedValue(new Error('spawn error'));

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(result.updated).toBe(false);
    expect(result.error).toContain('Could not determine installed yt-dlp version');
  });

  it('checkForYTDlpUpdate returns an error when GitHub releases cannot be fetched', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.06');
    mockGetGithubReleases.mockRejectedValue(new Error('network error'));

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    const result = await checkForYTDlpUpdate();

    expect(result.updated).toBe(false);
    expect(result.error).toContain('Could not fetch latest yt-dlp version');
  });

  it('persists the update check timestamp after a successful check', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('2023.07.06');
    mockGetGithubReleases.mockResolvedValue([{ tag_name: '2023.07.06' }]);

    const { checkForYTDlpUpdate } = await importYoutubeDownload();
    await checkForYTDlpUpdate();

    expect(mockWriteFile).toHaveBeenCalled();
    const [, stateJson] = mockWriteFile.mock.calls[0];
    const state = JSON.parse(stateJson);
    expect(state.lastCheck).toBeDefined();
    expect(state.lastKnownVersion).toBe('2023.07.06');
  });

  describe('downloadYouTubeVideo', () => {
    const originalPath = process.env.PATH;

    beforeEach(() => {
      // Binary present and update check not due.
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockImplementation(async (file) => {
        if (String(file).endsWith('yt-dlp-update-state.json')) {
          return JSON.stringify({ lastCheck: new Date().toISOString(), lastKnownVersion: '2023.07.06' });
        }
        throw new Error('not found');
      });
    });

    afterEach(() => {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    });

    /** Args of the (single) yt-dlp download invocation, via exec(). */
    function downloadCallArgs() {
      return mockExec.mock.calls.find((call) => !call[0].includes('--dump-json'))[0];
    }

    function setupSuccessfulDownload() {
      mockExecPromise.mockImplementation(async (args) => {
        if (args.includes('--dump-json')) {
          return JSON.stringify({ id: 'abc123' });
        }
        return '';
      });
      mockReaddir.mockResolvedValue(['abc123.mp4']);
    }

    /** Build a fetch Response-like object returning JSON. */
    function jsonResponse(payload) {
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      };
    }

    /** Build a fetch Response-like object streaming a small gzip payload. */
    function binaryResponse() {
      const gzipped = gzipSync(Buffer.from([0x01, 0x02]));
      const body = Readable.toWeb(Readable.from([new Uint8Array(gzipped)]));
      return {
        ok: true,
        status: 200,
        body,
        arrayBuffer: async () => gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength),
      };
    }

    it('prefers quickjs over deno and node when available', async () => {
      process.env.PATH = '';
      mockAccess.mockImplementation(async (candidate) => {
        if (
          String(candidate) === '/opt/homebrew/bin/qjs' ||
          String(candidate) === '/opt/homebrew/bin/deno'
        ) {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const downloadArgs = downloadCallArgs();
      expect(downloadArgs).toContain('--js-runtimes');
      expect(downloadArgs).toContain('quickjs:/opt/homebrew/bin/qjs');
    });

    it('falls back to deno when no quickjs is installed', async () => {
      process.env.PATH = '';
      mockAccess.mockImplementation(async (candidate) => {
        if (String(candidate) === '/opt/homebrew/bin/deno') {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const downloadArgs = downloadCallArgs();
      expect(downloadArgs).toContain('deno:/opt/homebrew/bin/deno');
    });

    it('falls back to node when neither quickjs nor deno is installed', async () => {
      process.env.PATH = '';
      mockAccess.mockImplementation(async (candidate) => {
        if (String(candidate) === '/usr/local/bin/node') {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const downloadArgs = downloadCallArgs();
      expect(downloadArgs).toContain('node:/usr/local/bin/node');
    });

    it('uses a merge format selector only when ffmpeg is available', async () => {
      process.env.PATH = '';
      // No runtime and no ffmpeg found.
      mockAccess.mockRejectedValue(new Error('not found'));
      setupSuccessfulDownload();

      let { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const legacyArgs = downloadCallArgs();
      expect(legacyArgs).not.toContain('--ffmpeg-location');
      const legacyFormatIndex = legacyArgs.indexOf('-f');
      expect(legacyFormatIndex).toBeGreaterThan(-1);
      expect(legacyArgs[legacyFormatIndex + 1]).toBe('best[ext=mp4]/best');
      // No ffmpeg means no merging, so no merge-output-format flag.
      expect(legacyArgs).not.toContain('--merge-output-format');
    });

    it('passes an explicit --ffmpeg-location when ffmpeg is outside PATH', async () => {
      process.env.PATH = '';
      mockAccess.mockImplementation(async (candidate) => {
        if (String(candidate) === '/opt/homebrew/bin/ffmpeg') {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const downloadArgs = downloadCallArgs();
      const idx = downloadArgs.indexOf('--ffmpeg-location');
      expect(idx).toBeGreaterThan(-1);
      expect(downloadArgs[idx + 1]).toBe('/opt/homebrew/bin/ffmpeg');
      const formatIndex = downloadArgs.indexOf('-f');
      expect(downloadArgs[formatIndex + 1]).toBe(
        'bv*[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b[ext=mp4]/bv*+ba/b'
      );
      const mergeIdx = downloadArgs.indexOf('--merge-output-format');
      expect(mergeIdx).toBeGreaterThan(-1);
      expect(downloadArgs[mergeIdx + 1]).toBe('mp4');
    });

    it('omits the --js-runtimes flag when no runtime can be found', async () => {
      process.env.PATH = '';
      mockAccess.mockRejectedValue(new Error('not found'));
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const downloadArgs = downloadCallArgs();
      expect(downloadArgs).not.toContain('--js-runtimes');
    });

    it('includes the JS runtime arguments in metadata (--dump-json) calls too', async () => {
      process.env.PATH = '';
      mockAccess.mockImplementation(async (candidate) => {
        if (String(candidate) === '/opt/homebrew/bin/qjs') {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      const infoCall = mockExecPromise.mock.calls.find((call) => call[0].includes('--dump-json'));
      expect(infoCall).toBeDefined();
      expect(infoCall[0]).toContain('quickjs:/opt/homebrew/bin/qjs');
    });

    it('rejects live stream URLs before invoking yt-dlp', async () => {
      const { downloadYouTubeVideo } = await importYoutubeDownload();
      const result = await downloadYouTubeVideo('https://www.youtube.com/live/abc12345678');

      expect(result.error).toBe('Live streams are not downloaded');
      expect(mockExecPromise).not.toHaveBeenCalled();
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('auto-downloads deno when no JS runtime is available on the machine', async () => {
      process.env.PATH = '';
      mockAccess.mockRejectedValue(new Error('not found'));
      setupSuccessfulDownload();
      // Provisioning: readdir inside the extraction dir finds deno, then the
      // post-download readdir finds the video file.
      mockReaddir.mockReset();
      mockReaddir
        .mockResolvedValueOnce([{ name: 'deno-aarch64-apple-darwin', isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: 'deno', isDirectory: () => false }])
        .mockResolvedValue(['abc123.mp4']);
      mockFetch.mockImplementation(async (url) => {
        if (String(url).includes('api.github.com/repos/denoland/deno')) {
          return jsonResponse({
            assets: [
              { name: 'deno-aarch64-apple-darwin.zip', browser_download_url: 'https://example.com/deno.zip' },
              { name: 'deno-x86_64-unknown-linux-gnu.zip', browser_download_url: 'https://example.com/other.zip' },
            ],
          });
        }
        return binaryResponse();
      });

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      expect(result.filePath).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/denoland/deno/releases/latest',
        expect.anything()
      );
      expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('.zip'), expect.any(Buffer));
      expect(mockCopyFile).toHaveBeenCalledWith(
        expect.stringContaining('deno'),
        '/mock/userData/provisioned-binaries/deno'
      );
      const downloadArgs = downloadCallArgs();
      expect(downloadArgs).toContain('--js-runtimes');
      expect(downloadArgs).toContain('deno:/mock/userData/provisioned-binaries/deno');
    });

    it('auto-downloads ffmpeg when none is installed and switches to merge mode', async () => {
      process.env.PATH = '';
      // A system deno exists so only ffmpeg needs provisioning.
      mockAccess.mockImplementation(async (candidate) => {
        if (String(candidate) === '/opt/homebrew/bin/deno') {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();
      mockFetch.mockImplementation(async (url) => {
        if (String(url).includes('api.github.com/repos/eugeneware/ffmpeg-static')) {
          return jsonResponse({
            assets: [
              { name: 'ffmpeg-darwin-arm64.gz', browser_download_url: 'https://example.com/ffmpeg.gz' },
              { name: 'ffprobe-darwin-arm64.gz', browser_download_url: 'https://example.com/ffprobe.gz' },
            ],
          });
        }
        return binaryResponse();
      });

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/mock/userData/provisioned-binaries/ffmpeg',
        expect.any(Buffer)
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/mock/userData/provisioned-binaries/ffprobe',
        expect.any(Buffer)
      );
      const downloadArgs = downloadCallArgs();
      const idx = downloadArgs.indexOf('--ffmpeg-location');
      expect(idx).toBeGreaterThan(-1);
      expect(downloadArgs[idx + 1]).toBe('/mock/userData/provisioned-binaries/ffmpeg');
      const formatIndex = downloadArgs.indexOf('-f');
      expect(downloadArgs[formatIndex + 1]).toBe(
        'bv*[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b[ext=mp4]/bv*+ba/b'
      );
    });

    it('reuses previously provisioned binaries without downloading again', async () => {
      process.env.PATH = '';
      mockAccess.mockImplementation(async (candidate) => {
        if (
          String(candidate) === '/mock/userData/provisioned-binaries/qjs' ||
          String(candidate) === '/mock/userData/provisioned-binaries/ffmpeg'
        ) {
          return undefined;
        }
        throw new Error('not found');
      });
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc12345678');

      expect(mockFetch).not.toHaveBeenCalled();
      const downloadArgs = downloadCallArgs();
      expect(downloadArgs).toContain('quickjs:/mock/userData/provisioned-binaries/qjs');
    });

    it('reports download progress through the optional callback', async () => {
      process.env.PATH = '';
      mockAccess.mockRejectedValue(new Error('not found'));
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      const events = [];
      const result = await downloadYouTubeVideo(
        'https://www.youtube.com/watch?v=abc12345678',
        (progress) => events.push(progress)
      );

      expect(result.filePath).toBeDefined();
      // Starts indeterminate, streams a percent tick, then processing.
      expect(events[0]).toMatchObject({ stage: 'starting', percent: null });
      expect(events).toContainEqual(
        expect.objectContaining({ stage: 'downloading', percent: 42.5 })
      );
      expect(events[events.length - 1]).toMatchObject({ stage: 'processing', percent: 100 });
    });

    it('survives a progress callback that throws', async () => {
      process.env.PATH = '';
      mockAccess.mockRejectedValue(new Error('not found'));
      setupSuccessfulDownload();

      const { downloadYouTubeVideo } = await importYoutubeDownload();
      const result = await downloadYouTubeVideo(
        'https://www.youtube.com/watch?v=abc12345678',
        () => {
          throw new Error('listener blew up');
        }
      );

      // A broken UI listener must not abort the download itself.
      expect(result.filePath).toBeDefined();
    });
  });

  describe('deleteDownloadedVideo', () => {
    it('deletes an existing file and returns true', async () => {
      mockUnlink.mockResolvedValue(undefined);

      const { deleteDownloadedVideo } = await importYoutubeDownload();
      const result = await deleteDownloadedVideo('/downloads/Aaron-RSS-YouTube/video.mp4');

      expect(result).toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith('/downloads/Aaron-RSS-YouTube/video.mp4');
    });

    it('returns true when the file has already been removed', async () => {
      const notFound = new Error('no such file');
      notFound.code = 'ENOENT';
      mockUnlink.mockRejectedValue(notFound);

      const { deleteDownloadedVideo } = await importYoutubeDownload();
      const result = await deleteDownloadedVideo('/downloads/Aaron-RSS-YouTube/missing.mp4');

      expect(result).toBe(true);
    });

    it('returns false when deletion fails for a reason other than ENOENT', async () => {
      const permissionDenied = new Error('permission denied');
      permissionDenied.code = 'EACCES';
      mockUnlink.mockRejectedValue(permissionDenied);

      const { deleteDownloadedVideo } = await importYoutubeDownload();
      const result = await deleteDownloadedVideo('/downloads/Aaron-RSS-YouTube/locked.mp4');

      expect(result).toBe(false);
    });

    it('returns true early when no path is provided', async () => {
      const { deleteDownloadedVideo } = await importYoutubeDownload();
      const result = await deleteDownloadedVideo('');

      expect(result).toBe(true);
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe('static build provisioning helpers', () => {
    it('platformTriple maps platform/arch pairs to asset triples', async () => {
      const { platformTriple } = await importYoutubeDownload();

      expect(platformTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
      expect(platformTriple('darwin', 'x64')).toBe('x86_64-apple-darwin');
      expect(platformTriple('win32', 'arm64')).toBe('aarch64-pc-windows-msvc');
      expect(platformTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
      expect(platformTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-gnu');
      expect(platformTriple('linux', 'x64')).toBe('x86_64-unknown-linux-gnu');
      expect(platformTriple('freebsd', 'x64')).toBeNull();
    });

    it('pickAsset requires every pattern to match the asset name', async () => {
      const { pickAsset } = await importYoutubeDownload();
      const assets = [
        { name: 'ffmpeg-master-latest-macos64-gpl.zip' },
        { name: 'ffmpeg-master-latest-macos64-shared.zip' },
      ];

      expect(pickAsset(assets, ['macos64-gpl'])?.name).toBe('ffmpeg-master-latest-macos64-gpl.zip');
      expect(pickAsset(assets, ['macos64', '.zip'])?.name).toBe('ffmpeg-master-latest-macos64-gpl.zip');
      expect(pickAsset(assets, ['windows64'])).toBeNull();
      expect(pickAsset(null, ['macos64'])).toBeNull();
    });
  });
});
