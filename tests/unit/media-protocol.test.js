/**
 * Unit Tests — electron/media-protocol.js
 *
 * The media:// protocol handler exposes downloaded YouTube videos to
 * the renderer. Only the pure helpers plus the request handler (driven
 * with WHATWG Request objects available in Node) are tested here;
 * protocol registration itself is covered by Electron manually.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildMediaUrl,
  mediaPathFromUrl,
  parseRangeHeader,
  isPathAllowed,
  createMediaRequestHandler,
} from '../../electron/media-protocol.js';

describe('buildMediaUrl / mediaPathFromUrl', () => {
  it('round-trips an absolute file path', () => {
    const filePath = '/Users/me/Downloads/Aaron-RSS-YouTube/dQw4w9WgXcQ.mp4';
    const url = new URL(buildMediaUrl(filePath));
    expect(url.hostname).toBe('local');
    expect(mediaPathFromUrl(url)).toBe(filePath);
  });

  it('round-trips paths containing spaces and unicode', () => {
    const filePath = '/tmp/Aaron-RSS-YouTube/My Video – épisode 1.webm';
    const url = new URL(buildMediaUrl(filePath));
    expect(mediaPathFromUrl(url)).toBe(filePath);
  });

  it('rejects non-local hosts', () => {
    const url = new URL('media://evil/..%2F..%2Fetc%2Fpasswd');
    expect(mediaPathFromUrl(url)).toBeNull();
  });

  it('rejects empty pathnames', () => {
    const url = new URL('media://local/');
    expect(mediaPathFromUrl(url)).toBeNull();
  });
});

describe('parseRangeHeader', () => {
  const size = 1000;

  it('parses a full start-end range', () => {
    expect(parseRangeHeader('bytes=0-999', size)).toEqual({ start: 0, end: 999 });
    expect(parseRangeHeader('bytes=100-199', size)).toEqual({ start: 100, end: 199 });
  });

  it('parses an open-ended range', () => {
    expect(parseRangeHeader('bytes=500-', size)).toEqual({ start: 500, end: 999 });
  });

  it('parses a suffix range (last N bytes)', () => {
    expect(parseRangeHeader('bytes=-200', size)).toEqual({ start: 800, end: 999 });
  });

  it('parses a single-byte range', () => {
    expect(parseRangeHeader('bytes=0-0', size)).toEqual({ start: 0, end: 0 });
  });

  it('clamps end beyond resource size', () => {
    expect(parseRangeHeader('bytes=900-5000', size)).toEqual({ start: 900, end: 999 });
  });

  it('returns null for invalid or unsupported ranges', () => {
    expect(parseRangeHeader(null, size)).toBeNull();
    expect(parseRangeHeader('', size)).toBeNull();
    expect(parseRangeHeader('bytes=', size)).toBeNull();
    expect(parseRangeHeader('bytes=-', size)).toBeNull();
    expect(parseRangeHeader('items=0-10', size)).toBeNull();
    expect(parseRangeHeader('bytes=0-100,200-300', size)).toBeNull();
    expect(parseRangeHeader('bytes=500-100', size)).toBeNull();
    expect(parseRangeHeader('bytes=1000-', size)).toBeNull();
    expect(parseRangeHeader('bytes=abc-def', size)).toBeNull();
  });

  it('returns null when size is zero or non-finite', () => {
    expect(parseRangeHeader('bytes=0-10', 0)).toBeNull();
    expect(parseRangeHeader('bytes=0-10', Number.NaN)).toBeNull();
  });
});

describe('isPathAllowed', () => {
  const root = '/Users/me/Downloads/Aaron-RSS-YouTube';

  it('allows files directly inside the root', () => {
    expect(isPathAllowed('/Users/me/Downloads/Aaron-RSS-YouTube/video.mp4', root)).toBe(true);
  });

  it('allows nested paths inside the root', () => {
    expect(isPathAllowed('/Users/me/Downloads/Aaron-RSS-YouTube/sub/video.mp4', root)).toBe(true);
  });

  it('allows the root itself', () => {
    expect(isPathAllowed(root, root)).toBe(true);
  });

  it('rejects siblings that merely share a prefix', () => {
    expect(isPathAllowed('/Users/me/Downloads/Aaron-RSS-YouTube2/video.mp4', root)).toBe(false);
  });

  it('rejects paths outside the root', () => {
    expect(isPathAllowed('/Users/me/Downloads/other.mp4', root)).toBe(false);
    expect(isPathAllowed('/etc/passwd', root)).toBe(false);
  });
});

describe('createMediaRequestHandler', () => {
  let root;
  let handler;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aaron-media-test-'));
    fs.writeFileSync(path.join(root, 'video.mp4'), '0123456789'.repeat(10));
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'clip.webm'), 'abcdef');
    handler = createMediaRequestHandler(root);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mediaRequest = (filePath, headers = {}) =>
    new Request(buildMediaUrl(path.join(root, filePath)), { headers });

  it('serves a file inside the root with correct MIME and body', async () => {
    const response = await handler(mediaRequest('video.mp4'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await response.text()).toBe('0123456789'.repeat(10));
  });

  it('serves nested files and non-default MIME types', async () => {
    const response = await handler(mediaRequest('nested/clip.webm'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/webm');
    expect(await response.text()).toBe('abcdef');
  });

  it('answers range requests with 206 and the requested slice', async () => {
    const response = await handler(mediaRequest('video.mp4', { Range: 'bytes=10-19' }));
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(await response.text()).toBe('0123456789');
  });

  it('answers an open-ended range request to the end of the file', async () => {
    const response = await handler(mediaRequest('video.mp4', { Range: 'bytes=95-' }));
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 95-99/100');
    expect(await response.text()).toBe('0123456789'.slice(5));
  });

  it('returns 404 for missing files', async () => {
    const response = await handler(mediaRequest('nope.mp4'));
    expect(response.status).toBe(404);
  });

  it('returns 403 for paths outside the allowed root', async () => {
    const response = await handler(
      new Request(buildMediaUrl(path.join(root, '..', 'secret.mp4')))
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 for malformed URLs', async () => {
    expect((await handler(new Request('media://evil/x'))).status).toBe(404);
    expect((await handler(new Request('media://local/'))).status).toBe(404);
  });
});
