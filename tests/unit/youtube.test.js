/**
 * YouTube URL Helper Unit Tests
 *
 * Tests src/lib/youtube.js for URL detection, video ID extraction,
 * embed URL generation, and stream filtering.
 */

import { describe, it, expect } from 'vitest';
import {
  isYouTubeURL,
  isYouTubeHostURL,
  isYouTubeStream,
  extractYouTubeVideoID,
  getYouTubeEmbedURL,
  buildYouTubeChannelFeedURL,
  extractYouTubeChannelFeedID,
} from '../../src/lib/youtube.js';

describe('youtube helpers', () => {
  describe('isYouTubeURL', () => {
    it('recognizes standard youtube.com/watch URLs', () => {
      expect(isYouTubeURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeURL('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeURL('http://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('recognizes youtu.be short links', () => {
      expect(isYouTubeURL('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('recognizes shorts, embed, and live URLs', () => {
      expect(isYouTubeURL('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeURL('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeURL('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe(true);
    });

    it('rejects gaming.youtube.com', () => {
      expect(isYouTubeURL('https://gaming.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    });

    it('rejects non-YouTube URLs', () => {
      expect(isYouTubeURL('https://example.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeURL('https://vimeo.com/12345')).toBe(false);
    });

    it('rejects malformed URLs', () => {
      expect(isYouTubeURL('')).toBe(false);
      expect(isYouTubeURL('not-a-url')).toBe(false);
      expect(isYouTubeURL(null)).toBe(false);
    });

    it('rejects watch URLs without a valid video ID', () => {
      expect(isYouTubeURL('https://www.youtube.com/watch?v=short')).toBe(false);
    });
  });

  describe('isYouTubeHostURL', () => {
    it('accepts every standard YouTube host regardless of path', () => {
      expect(isYouTubeHostURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeHostURL('https://youtube.com/feed/subscriptions')).toBe(true);
      expect(isYouTubeHostURL('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeHostURL('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeHostURL('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('accepts YouTube URL shapes without a valid video ID', () => {
      // Feeds can carry URLs the strict isYouTubeURL() check rejects —
      // attribution links, deleted-video redirects, malformed IDs. These
      // must still be routed to the YouTube viewer, not article
      // extraction (which 403s against youtube.com).
      expect(isYouTubeHostURL('https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DdQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeHostURL('https://www.youtube.com/watch?v=deleted')).toBe(true);
      expect(isYouTubeHostURL('https://www.youtube.com/watch_videos?video_ids=dQw4w9WgXcQ')).toBe(true);
    });

    it('rejects non-YouTube hosts and excluded subdomains', () => {
      expect(isYouTubeHostURL('https://example.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeHostURL('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeHostURL('https://gaming.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    });

    it('rejects non-http(s) schemes and malformed input', () => {
      expect(isYouTubeHostURL('ftp://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeHostURL('')).toBe(false);
      expect(isYouTubeHostURL('not-a-url')).toBe(false);
      expect(isYouTubeHostURL(null)).toBe(false);
    });
  });

  describe('isYouTubeStream', () => {
    it('identifies /live/ URLs as streams', () => {
      expect(isYouTubeStream('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe(true);
    });

    it('does not flag regular videos as streams', () => {
      expect(isYouTubeStream('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeStream('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
    });

    it('returns false for non-YouTube URLs', () => {
      expect(isYouTubeStream('https://example.com/live/stream')).toBe(false);
    });
  });

  describe('extractYouTubeVideoID', () => {
    it('extracts IDs from watch URLs', () => {
      expect(extractYouTubeVideoID('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts IDs from short links', () => {
      expect(extractYouTubeVideoID('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts IDs from shorts and embed URLs', () => {
      expect(extractYouTubeVideoID('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoID('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('returns null for non-YouTube URLs', () => {
      expect(extractYouTubeVideoID('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    });

    it('returns null for invalid IDs', () => {
      expect(extractYouTubeVideoID('https://www.youtube.com/watch?v=short')).toBeNull();
    });
  });

  describe('getYouTubeEmbedURL', () => {
    it('generates an embed URL with enablejsapi enabled', () => {
      const url = getYouTubeEmbedURL('dQw4w9WgXcQ');
      expect(url).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&rel=0&modestbranding=1');
    });

    it('throws for invalid video IDs', () => {
      expect(() => getYouTubeEmbedURL('short')).toThrow('Invalid YouTube video ID');
      expect(() => getYouTubeEmbedURL('')).toThrow('Invalid YouTube video ID');
    });
  });

  describe('channel feed URLs', () => {
    it('builds the canonical channel RSS feed URL', () => {
      expect(buildYouTubeChannelFeedURL('UCabc123def456')).toBe(
        'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123def456'
      );
    });

    it('extracts the channel id from a channel feed URL', () => {
      expect(
        extractYouTubeChannelFeedID(
          'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123def456'
        )
      ).toBe('UCabc123def456');
      expect(
        extractYouTubeChannelFeedID(
          'http://m.youtube.com/feeds/videos.xml?channel_id=UCabc123def456'
        )
      ).toBe('UCabc123def456');
    });

    it('rejects URLs that are not channel feeds', () => {
      expect(extractYouTubeChannelFeedID('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
      expect(extractYouTubeChannelFeedID('https://example.com/feeds/videos.xml?channel_id=UCabc123def456')).toBeNull();
      expect(extractYouTubeChannelFeedID('')).toBeNull();
      expect(extractYouTubeChannelFeedID(null)).toBeNull();
    });

    it('rejects playlist and user feeds that key on other ids', () => {
      expect(
        extractYouTubeChannelFeedID(
          'https://www.youtube.com/feeds/videos.xml?playlist_id=PL123'
        )
      ).toBeNull();
      expect(
        extractYouTubeChannelFeedID(
          'https://www.youtube.com/feeds/videos.xml?user=someuser'
        )
      ).toBeNull();
    });

    it('rejects malformed channel ids', () => {
      expect(
        extractYouTubeChannelFeedID('https://www.youtube.com/feeds/videos.xml?channel_id=short')
      ).toBeNull();
    });
  });
});
