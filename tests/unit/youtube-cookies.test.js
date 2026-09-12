/**
 * YouTube Cookie Configuration and Bot-Check Retry Unit Tests
 *
 * YouTube serves some videos only after sign-in: yt-dlp exits with
 * "Sign in to confirm you're not a bot". The app now (a) lets the user
 * configure cookies for yt-dlp (--cookies-from-browser or a cookies.txt
 * file) from the Settings modal, validated here on the main-process
 * side, and (b) automatically retries a bot-checked download once with
 * the cookie-free tv player client.
 *
 * Electron, fs, child_process, and yt-dlp-wrap-plus are fully mocked so
 * the tests run in plain Node (same approach as youtube-download.test.js).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockGetPath = vi.fn();
const mockAccess = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockMkdir = vi.fn();
const mockReaddir = vi.fn();
const mockChmod = vi.fn();
const mockRm = vi.fn();
const mockExecFile = vi.fn();
const mockFetch = vi.fn();

/** Queue of behaviors for yt-dlp-wrap exec(); each entry gets the args array. */
const execBehaviors = [];
/** Args of every exec() call, in order. */
const execCalls = [];

/** yt-dlp metadata returned by execPromise (--dump-json). */
let dumpJsonResponse = { id: 'abc123', title: 'Test Video' };

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
    readdir: (...args) => mockReaddir(...args),
    chmod: (...args) => mockChmod(...args),
    rm: (...args) => mockRm(...args),
  },
}));

vi.mock('node:child_process', () => ({
  execFile: (command, args, callback) => {
    Promise.resolve().then(() => mockExecFile(command, args)).then(
      () => callback(null, '', ''),
      (error) => callback(error)
    );
  },
}));

function makeExecEmitter(behavior) {
  const emitter = new EventEmitter();
  queueMicrotask(() => {
    try {
      behavior(emitter);
    } catch (error) {
      emitter.emit('error', error);
    }
  });
  return emitter;
}

vi.mock('yt-dlp-wrap-plus', () => ({
  default: class MockYTDlpWrap {
    constructor() {
      this.getVersion = vi.fn(async () => '2025.01.01');
      this.execPromise = vi.fn(async () => JSON.stringify(dumpJsonResponse));
    }

    exec(args) {
      execCalls.push(args);
      const behavior = execBehaviors.shift();
      if (!behavior) {
        return makeExecEmitter((emitter) => emitter.emit('close', 0));
      }
      return makeExecEmitter(behavior);
    }

    static downloadFromGithub() {
      return Promise.resolve();
    }
  },
}));

/** The error yt-dlp-wrap-plus builds from a nonzero exit: stderr embedded. */
const BOT_CHECK_ERROR = new Error(
  '\nError code: 1\n\nStderr:\n' +
    'WARNING: [youtube] No title found in player responses; falling back to title from initial data.\n' +
    "ERROR: [youtube] tGLKHc6N-_M: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication."
);

async function importYoutubeDownload() {
  return await import('../../electron/youtube-download.js');
}

describe('youtube cookie configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    execBehaviors.length = 0;
    execCalls.length = 0;
    dumpJsonResponse = { id: 'abc123', title: 'Test Video' };

    mockGetPath.mockImplementation((name) => `/mock/${name}`);
    mockAccess.mockRejectedValue(new Error('not found'));
    mockReadFile.mockRejectedValue(new Error('not found'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(['abc123.mp4']);
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
    mockRm.mockResolvedValue(undefined);
    // Binary provisioning (ffmpeg / JS runtimes) must fail fast instead
    // of attempting real network downloads.
    mockFetch.mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('cookieArgsFromConfig', () => {
    it('maps a browser name to --cookies-from-browser', async () => {
      const { cookieArgsFromConfig } = await importYoutubeDownload();
      expect(cookieArgsFromConfig({ cookiesFromBrowser: 'safari' })).toEqual([
        '--cookies-from-browser',
        'safari',
      ]);
    });

    it('maps a file path to --cookies', async () => {
      const { cookieArgsFromConfig } = await importYoutubeDownload();
      expect(cookieArgsFromConfig({ cookiesFile: '/tmp/cookies.txt' })).toEqual([
        '--cookies',
        '/tmp/cookies.txt',
      ]);
    });

    it('returns no arguments for an empty config', async () => {
      const { cookieArgsFromConfig } = await importYoutubeDownload();
      expect(cookieArgsFromConfig({})).toEqual([]);
      expect(cookieArgsFromConfig(null)).toEqual([]);
    });
  });

  describe('writeCookieConfig', () => {
    it('persists a validated browser choice', async () => {
      const { writeCookieConfig } = await importYoutubeDownload();
      const saved = await writeCookieConfig({ cookiesFromBrowser: 'firefox' });

      expect(saved).toEqual({ cookiesFromBrowser: 'firefox' });
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/mock/userData/youtube-cookies.json',
        JSON.stringify({ cookiesFromBrowser: 'firefox' }),
        'utf-8'
      );
    });

    it('rejects browsers outside the allowlist', async () => {
      const { writeCookieConfig } = await importYoutubeDownload();
      await expect(writeCookieConfig({ cookiesFromBrowser: 'netscape' })).rejects.toThrow(
        /Unsupported browser/
      );
    });

    it('rejects setting both a browser and a file', async () => {
      const { writeCookieConfig } = await importYoutubeDownload();
      await expect(
        writeCookieConfig({ cookiesFromBrowser: 'safari', cookiesFile: '/tmp/c.txt' })
      ).rejects.toThrow(/not both/);
    });

    it('rejects non-object configs and empty file paths', async () => {
      const { writeCookieConfig } = await importYoutubeDownload();
      await expect(writeCookieConfig('safari')).rejects.toThrow(/must be an object/);
      await expect(writeCookieConfig({ cookiesFile: '   ' })).rejects.toThrow(/non-empty path/);
    });
  });

  describe('readCookieConfig', () => {
    it('returns an empty config when the file is missing', async () => {
      const { readCookieConfig } = await importYoutubeDownload();
      await expect(readCookieConfig()).resolves.toEqual({});
    });

    it('parses a stored config', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ cookiesFile: '/tmp/c.txt' }));
      const { readCookieConfig } = await importYoutubeDownload();
      await expect(readCookieConfig()).resolves.toEqual({ cookiesFile: '/tmp/c.txt' });
    });

    it('treats corrupt JSON as no configuration', async () => {
      mockReadFile.mockResolvedValue('{not json');
      const { readCookieConfig } = await importYoutubeDownload();
      await expect(readCookieConfig()).resolves.toEqual({});
    });
  });

  describe('isBotCheckError', () => {
    it('matches the yt-dlp sign-in stderr', async () => {
      const { isBotCheckError } = await importYoutubeDownload();
      expect(isBotCheckError(BOT_CHECK_ERROR)).toBe(true);
    });

    it('ignores unrelated errors', async () => {
      const { isBotCheckError } = await importYoutubeDownload();
      expect(isBotCheckError(new Error('HTTP Error 404: Not Found'))).toBe(false);
      expect(isBotCheckError(null)).toBe(false);
    });
  });

  describe('downloadYouTubeVideo bot-check retry', () => {
    it('retries once with the tv player client and succeeds', async () => {
      execBehaviors.push(
        (emitter) => emitter.emit('error', BOT_CHECK_ERROR),
        (emitter) => emitter.emit('close', 0)
      );
      const { downloadYouTubeVideo } = await importYoutubeDownload();

      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc123');

      expect(result).toEqual({
        filePath: '/mock/downloads/Aaron-RSS-YouTube/abc123.mp4',
        videoID: 'abc123',
        title: 'Test Video',
      });
      expect(execCalls).toHaveLength(2);
      expect(execCalls[1]).toContain('--extractor-args');
      expect(execCalls[1]).toContain('youtube:player_client=tv');
    });

    it('returns an actionable error when the retry also hits the bot check', async () => {
      execBehaviors.push(
        (emitter) => emitter.emit('error', BOT_CHECK_ERROR),
        (emitter) => emitter.emit('error', BOT_CHECK_ERROR)
      );
      const { downloadYouTubeVideo } = await importYoutubeDownload();

      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc123');

      expect(result.error).toBeTruthy();
      // The raw stderr must not leak; the message points at Settings.
      expect(result.error).toMatch(/Settings/);
      expect(result.error).not.toMatch(/Sign in to confirm/);
      expect(execCalls).toHaveLength(2);
    });

    it('passes non-bot failures through without a retry', async () => {
      execBehaviors.push((emitter) =>
        emitter.emit('error', new Error('\nError code: 1\n\nStderr:\nERROR: Unsupported URL'))
      );
      const { downloadYouTubeVideo } = await importYoutubeDownload();

      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc123');

      expect(result.error).toMatch(/Unsupported URL/);
      expect(execCalls).toHaveLength(1);
    });

    it('includes configured cookie arguments in downloads and metadata lookups', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ cookiesFromBrowser: 'safari' }));
      const { downloadYouTubeVideo } = await importYoutubeDownload();

      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc123');

      expect(result.videoID).toBe('abc123');
      // No retry when cookies work: a single download exec, already
      // carrying the cookie arguments (after the JS runtime args the
      // provisioning probe produces).
      expect(execCalls).toHaveLength(1);
      const cookieIndex = execCalls[0].indexOf('--cookies-from-browser');
      expect(cookieIndex).toBeGreaterThan(-1);
      expect(execCalls[0][cookieIndex + 1]).toBe('safari');
    });
  });
});
