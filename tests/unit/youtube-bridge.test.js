/**
 * YouTube Bridge Unit Tests
 *
 * Tests the renderer-side wrapper in src/lib/youtube-bridge.js. It
 * delegates to window.electron when running inside Electron and returns
 * graceful fallbacks elsewhere.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  downloadYouTubeVideo,
  deleteDownloadedVideo,
  onDownloadProgress,
  isElectronAvailable,
  buildVideoMediaUrl,
} from '../../src/lib/youtube-bridge.js';

describe('youtube bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('downloadYouTubeVideo', () => {
    it('delegates to window.electron.downloadYouTubeVideo when available', async () => {
      const mockDownload = vi.fn().mockResolvedValue({ filePath: '/videos/abc.mp4' });
      vi.stubGlobal('window', {
        electron: { downloadYouTubeVideo: mockDownload },
      });

      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc123');

      expect(mockDownload).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abc123');
      expect(result.filePath).toBe('/videos/abc.mp4');
    });

    it('returns an error when the Electron bridge is unavailable', async () => {
      vi.stubGlobal('window', {});

      const result = await downloadYouTubeVideo('https://www.youtube.com/watch?v=abc123');

      expect(result.error).toContain('only available in the Electron app');
    });
  });

  describe('onDownloadProgress', () => {
    it('subscribes via window.electron.onYouTubeDownloadProgress when available', () => {
      const unsubscribe = vi.fn();
      const mockSubscribe = vi.fn().mockReturnValue(unsubscribe);
      const callback = vi.fn();
      vi.stubGlobal('window', {
        electron: { onYouTubeDownloadProgress: mockSubscribe },
      });

      const result = onDownloadProgress(callback);

      expect(mockSubscribe).toHaveBeenCalledWith(callback);
      expect(result).toBe(unsubscribe);
    });

    it('returns a no-op unsubscribe when the Electron bridge is unavailable', () => {
      vi.stubGlobal('window', {});
      const callback = vi.fn();

      const unsubscribe = onDownloadProgress(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('deleteDownloadedVideo', () => {
    it('delegates to window.electron.deleteDownloadedVideo when available', async () => {
      const mockDelete = vi.fn().mockResolvedValue(true);
      vi.stubGlobal('window', {
        electron: { deleteDownloadedVideo: mockDelete },
      });

      const result = await deleteDownloadedVideo('/videos/abc.mp4');

      expect(mockDelete).toHaveBeenCalledWith('/videos/abc.mp4');
      expect(result).toBe(true);
    });

    it('returns false when the Electron bridge is unavailable', async () => {
      vi.stubGlobal('window', {});

      const result = await deleteDownloadedVideo('/videos/abc.mp4');

      expect(result).toBe(false);
    });

    it('returns false when window is undefined', async () => {
      vi.stubGlobal('window', undefined);

      const result = await deleteDownloadedVideo('/videos/abc.mp4');

      expect(result).toBe(false);
    });
  });

  describe('isElectronAvailable', () => {
    it('returns true when window.electron exists', () => {
      vi.stubGlobal('window', { electron: {} });
      expect(isElectronAvailable()).toBe(true);
    });

    it('returns false when window.electron is missing', () => {
      vi.stubGlobal('window', {});
      expect(isElectronAvailable()).toBe(false);
    });

    it('returns false when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(isElectronAvailable()).toBe(false);
    });
  });

  describe('buildVideoMediaUrl', () => {
    it('encodes the file path into the media:// URL', () => {
      const filePath = '/downloads/Aaron-RSS-YouTube/dQw4w9WgXcQ.mp4';
      expect(buildVideoMediaUrl(filePath)).toBe(
        `media://local/${encodeURIComponent(filePath)}`
      );
    });

    it('encodes special characters safely', () => {
      expect(buildVideoMediaUrl('/v/my video.mp4')).toBe(
        'media://local/%2Fv%2Fmy%20video.mp4'
      );
    });
  });
});
