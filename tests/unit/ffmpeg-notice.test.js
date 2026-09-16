import { describe, it, expect } from 'vitest';
import {
  FFMPEG_INSTALL_URL,
  FFMPEG_MISSING_HINT,
  annotateFFmpegMissing,
} from '../../src/lib/ffmpeg-notice.js';

describe('ffmpeg-notice', () => {
  describe('FFMPEG_INSTALL_URL', () => {
    it('points at the official FFmpeg download instructions', () => {
      expect(FFMPEG_INSTALL_URL).toBe('https://ffmpeg.org/download.html');
    });
  });

  describe('annotateFFmpegMissing', () => {
    it('leaves results untouched when FFmpeg was available', () => {
      const result = { filePath: '/tmp/a.mp4', videoID: 'v1' };
      expect(annotateFFmpegMissing(result, false)).toBe(result);

      const failed = { error: 'boom' };
      expect(annotateFFmpegMissing(failed, false)).toBe(failed);
    });

    it('flags successful downloads that ran without FFmpeg', () => {
      const annotated = annotateFFmpegMissing(
        { filePath: '/tmp/a.mp4', videoID: 'v1', title: 'A' },
        true
      );
      expect(annotated.ffmpegMissing).toBe(true);
      expect(annotated.error).toBeUndefined();
      expect(annotated.filePath).toBe('/tmp/a.mp4');
    });

    it('prefixes the hint on failures that ran without FFmpeg', () => {
      const annotated = annotateFFmpegMissing(
        { error: 'Requested format is not available' },
        true
      );
      expect(annotated.ffmpegMissing).toBe(true);
      expect(annotated.error).toBe(
        `${FFMPEG_MISSING_HINT} — Requested format is not available`
      );
    });

    it('keeps other result fields when annotating an error', () => {
      const annotated = annotateFFmpegMissing(
        { error: 'boom', filePath: '/tmp/partial.mp4' },
        true
      );
      expect(annotated.filePath).toBe('/tmp/partial.mp4');
    });
  });
});
