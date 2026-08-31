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
});
