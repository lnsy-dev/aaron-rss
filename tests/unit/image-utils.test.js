/**
 * Image Utils Unit Tests
 *
 * Covers the helpers used by the image context menu: resolving the URL
 * an image actually loaded from and deriving a save-file name from a
 * URL + MIME type.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getUsableImageURL,
  deriveImageFilename,
  buildImageAcceptTypes,
} from '../../src/lib/image-utils.js';

describe('getUsableImageURL', () => {
  it('returns an empty string for missing images', () => {
    expect(getUsableImageURL(null)).toBe('');
  });

  it('prefers currentSrc over src', () => {
    const image = { currentSrc: 'https://example.com/resolved.png', src: 'https://example.com/srcset-src.png' };
    expect(getUsableImageURL(image)).toBe('https://example.com/resolved.png');
  });

  it('falls back to src when currentSrc is empty', () => {
    const image = { currentSrc: '', src: 'https://example.com/plain.jpg' };
    expect(getUsableImageURL(image)).toBe('https://example.com/plain.jpg');
  });
});

describe('deriveImageFilename', () => {
  it('uses the last path segment when it has an extension', () => {
    expect(deriveImageFilename('https://example.com/photos/cat.jpg')).toBe('cat.jpg');
  });

  it('strips query strings and fragments', () => {
    expect(deriveImageFilename('https://example.com/dog.png?size=large#top')).toBe('dog.png');
  });

  it('decodes percent-encoded characters in the name', () => {
    expect(deriveImageFilename('https://example.com/my%20photo.webp')).toBe('my photo.webp');
  });

  it('falls back to the fallback name when the URL has no file-like segment', () => {
    expect(deriveImageFilename('https://example.com/images/')).toBe('image');
  });

  it('falls back to a plain name when given an empty URL', () => {
    expect(deriveImageFilename('', 'image/png', 'pic')).toBe('pic.png');
  });

  it('uses the last path segment even without an extension, adding one from the MIME type', () => {
    expect(deriveImageFilename('https://example.com/photo', 'image/jpeg')).toBe('photo.jpg');
  });

  it('does not append an extension when one already exists', () => {
    expect(deriveImageFilename('https://example.com/photo.png', 'image/png')).toBe('photo.png');
  });

  it('keeps the name untouched for unknown MIME types with extensions', () => {
    expect(deriveImageFilename('https://example.com/blob.bin', 'application/octet-stream')).toBe('blob.bin');
  });

  it('appends the canonical extension when the URL has no extension and no MIME type is known', () => {
    expect(deriveImageFilename('https://cdn.example.org/v1/media/pic1234')).toBe('pic1234');
  });

  it('handles relative URLs against the document base', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/feed/' } });
    expect(deriveImageFilename('/media/bird.avif')).toBe('bird.avif');
    vi.unstubAllGlobals();
  });
});

describe('buildImageAcceptTypes', () => {
  it('builds descriptors for known MIME types', () => {
    expect(buildImageAcceptTypes('image/jpeg')).toEqual([
      { description: 'Image', accept: { 'image/jpeg': ['.jpg'] } },
    ]);
  });

  it('defaults to PNG for unknown or missing MIME types', () => {
    expect(buildImageAcceptTypes()).toEqual([
      { description: 'Image', accept: { 'image/png': ['.png'] } },
    ]);
    expect(buildImageAcceptTypes('weird/type')).toEqual([
      { description: 'Image', accept: { 'image/png': ['.png'] } },
    ]);
  });
});
