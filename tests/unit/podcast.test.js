/**
 * Podcast Detection Unit Tests
 *
 * Tests the podcast helpers in src/lib/podcast.js: audio enclosure
 * extraction from RSS-style items, JSON Feed attachments, and
 * normalized articles, plus download file-name suggestion.
 */

import { describe, it, expect } from 'vitest';
import {
  isAudioMIMEType,
  isAudioURLExtension,
  extractAudioEnclosure,
  isPodcastEpisode,
  suggestPodcastFileName,
} from '../../src/lib/podcast.js';

describe('isAudioMIMEType', () => {
  it('accepts audio/* types case-insensitively', () => {
    expect(isAudioMIMEType('audio/mpeg')).toBe(true);
    expect(isAudioMIMEType('Audio/MP4')).toBe(true);
    expect(isAudioMIMEType('audio/x-m4a')).toBe(true);
  });

  it('rejects non-audio and missing types', () => {
    expect(isAudioMIMEType('image/jpeg')).toBe(false);
    expect(isAudioMIMEType('video/mp4')).toBe(false);
    expect(isAudioMIMEType('text/html')).toBe(false);
    expect(isAudioMIMEType(undefined)).toBe(false);
    expect(isAudioMIMEType('')).toBe(false);
  });
});

describe('isAudioURLExtension', () => {
  it('accepts common audio extensions, including with query strings', () => {
    expect(isAudioURLExtension('https://cdn.example.com/ep1.mp3')).toBe(true);
    expect(isAudioURLExtension('https://cdn.example.com/ep1.M4A')).toBe(true);
    expect(isAudioURLExtension('https://cdn.example.com/ep1.ogg?token=1')).toBe(true);
    expect(isAudioURLExtension('https://cdn.example.com/ep1.flac')).toBe(true);
  });

  it('rejects non-audio paths and junk input', () => {
    expect(isAudioURLExtension('https://cdn.example.com/ep1.html')).toBe(false);
    expect(isAudioURLExtension('https://cdn.example.com/')).toBe(false);
    expect(isAudioURLExtension('')).toBe(false);
    expect(isAudioURLExtension(undefined)).toBe(false);
  });
});

describe('extractAudioEnclosure', () => {
  it('extracts an audio RSS enclosure with type and length', () => {
    const item = {
      enclosure: { url: 'https://cdn.example.com/ep1.mp3', type: 'audio/mpeg', length: '12345678' },
    };

    expect(extractAudioEnclosure(item)).toEqual({
      url: 'https://cdn.example.com/ep1.mp3',
      type: 'audio/mpeg',
      length: 12345678,
    });
  });

  it('accepts an enclosure with no MIME type when the URL is audio', () => {
    const item = { enclosure: { url: 'https://cdn.example.com/ep1.m4a' } };

    expect(extractAudioEnclosure(item)?.url).toBe('https://cdn.example.com/ep1.m4a');
  });

  it('rejects image and video enclosures', () => {
    expect(extractAudioEnclosure({
      enclosure: { url: 'https://cdn.example.com/cover.jpg', type: 'image/jpeg' },
    })).toBeNull();
    expect(extractAudioEnclosure({
      enclosure: { url: 'https://cdn.example.com/clip.mp4', type: 'video/mp4' },
    })).toBeNull();
  });

  it('rejects a non-audio enclosure even with an audio-ish query-free URL', () => {
    expect(extractAudioEnclosure({
      enclosure: { url: 'https://cdn.example.com/page.html', type: 'text/html' },
    })).toBeNull();
  });

  it('extracts the first audio JSON Feed attachment', () => {
    const item = {
      attachments: [
        { url: 'https://cdn.example.com/cover.jpg', mime_type: 'image/jpeg' },
        { url: 'https://cdn.example.com/ep1.mp3', mime_type: 'audio/mpeg', size_in_bytes: '999' },
      ],
    };

    expect(extractAudioEnclosure(item)).toEqual({
      url: 'https://cdn.example.com/ep1.mp3',
      type: 'audio/mpeg',
      length: 999,
    });
  });

  it('extracts an Atom link rel="enclosure" audio item', () => {
    const item = {
      links: [
        { href: 'https://example.com/ep3', rel: 'alternate', type: 'text/html' },
        { href: 'https://cdn.example.com/ep3.m4a', rel: 'enclosure', type: 'audio/x-m4a', length: '42' },
      ],
    };

    expect(extractAudioEnclosure(item)).toEqual({
      url: 'https://cdn.example.com/ep3.m4a',
      type: 'audio/x-m4a',
      length: 42,
    });
  });

  it('returns already-normalized article fields untouched', () => {
    const article = {
      enclosureURL: 'https://cdn.example.com/ep1.mp3',
      enclosureType: 'audio/mpeg',
      enclosureLength: 5,
    };

    expect(extractAudioEnclosure(article)).toEqual({
      url: 'https://cdn.example.com/ep1.mp3',
      type: 'audio/mpeg',
      length: 5,
    });
  });

  it('returns null for items without any enclosure', () => {
    expect(extractAudioEnclosure({ title: 'Plain blog post' })).toBeNull();
    expect(extractAudioEnclosure(null)).toBeNull();
    expect(extractAudioEnclosure(undefined)).toBeNull();
  });
});

describe('isPodcastEpisode', () => {
  it('is true when the article carries an enclosure URL', () => {
    expect(isPodcastEpisode({ enclosureURL: 'https://cdn.example.com/ep1.mp3' })).toBe(true);
  });

  it('is false for plain articles and nullish input', () => {
    expect(isPodcastEpisode({ title: 'Post' })).toBe(false);
    expect(isPodcastEpisode(null)).toBe(false);
    expect(isPodcastEpisode(undefined)).toBe(false);
  });
});

describe('suggestPodcastFileName', () => {
  it('uses the sanitized title with the enclosure extension', () => {
    expect(suggestPodcastFileName({
      title: 'Episode 42: The Best / Episode "Ever"?',
      enclosureURL: 'https://cdn.example.com/ep42.mp3',
    })).toBe('Episode 42 The Best Episode Ever.mp3');
  });

  it('falls back to the URL basename when there is no title', () => {
    expect(suggestPodcastFileName({
      enclosureURL: 'https://cdn.example.com/audio/episode-9.ogg',
    })).toBe('episode-9.ogg');
  });

  it('defaults to .mp3 when the URL has no recognizable extension', () => {
    expect(suggestPodcastFileName({
      title: 'Episode 7',
      enclosureURL: 'https://cdn.example.com/episodes/7',
    })).toBe('Episode 7.mp3');
  });

  it('caps very long titles', () => {
    const name = suggestPodcastFileName({
      title: 'x'.repeat(500),
      enclosureURL: 'https://cdn.example.com/ep.mp3',
    });
    expect(name.length).toBeLessThanOrEqual(154);
    expect(name.endsWith('.mp3')).toBe(true);
  });

  it('survives a totally empty article', () => {
    expect(suggestPodcastFileName({})).toBe('podcast-episode.mp3');
  });
});
