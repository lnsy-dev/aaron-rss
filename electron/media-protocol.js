/**
 * Media Protocol Handler
 *
 * Serves downloaded YouTube videos to the renderer over a custom
 * `media://` protocol. The renderer runs on the privileged `app://`
 * origin, which Chromium does not allow to read `file://` URLs, so
 * downloaded videos are exposed through a narrow protocol that only
 * ever resolves paths inside the app's video download directory.
 *
 * This module deliberately imports nothing from Electron so its pure
 * helpers (range parsing, path guarding, URL building) can be unit
 * tested in Node. main.js wires the handler into protocol.handle().
 */

import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';

/** MIME types for video/audio containers yt-dlp typically produces. */
const MEDIA_MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
};

/**
 * Build the media:// URL for a downloaded video file.
 *
 * The absolute file path is URL-encoded into the pathname; the host is
 * always `local`. Renderer code uses this to create <video> sources.
 *
 * @param {string} filePath - Absolute path to the downloaded video
 * @returns {string} A media:// URL for the file
 */
export function buildMediaUrl(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`;
}

/**
 * Extract the absolute file path from a media:// request URL.
 *
 * @param {URL} url - Parsed request URL
 * @returns {string|null} Decoded absolute path, or null if malformed
 */
export function mediaPathFromUrl(url) {
  if (url.hostname !== 'local') {
    return null;
  }
  const encoded = url.pathname.replace(/^\/+/, '');
  if (!encoded) {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Parse an HTTP Range header against a known resource size.
 *
 * Only single byte ranges of the form `bytes=start-end`, `bytes=start-`,
 * or `bytes=-suffix` are supported; anything else (multiple ranges,
 * other units, invalid numbers) yields null so the caller can fall back
 * to a 200 response with the whole file.
 *
 * @param {string|null} header - Raw Range header value
 * @param {number} size - Total resource size in bytes
 * @returns {{start: number, end: number}|null} Clamped byte range or null
 */
export function parseRangeHeader(header, size) {
  if (!header || !Number.isFinite(size) || size <= 0) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  let start;
  let end;
  if (match[1] === '') {
    // Suffix range: last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) {
      return null;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (start > end || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Decide whether a resolved path is allowed to be served.
 *
 * The path must live inside (or be) the allowed root and must not
 * attempt traversal via symlink-like `..` segments after resolution.
 *
 * @param {string} resolvedPath - path.resolve()d absolute file path
 * @param {string} allowedRoot - Absolute root directory
 * @returns {boolean} Whether the path may be served
 */
export function isPathAllowed(resolvedPath, allowedRoot) {
  const root = path.resolve(allowedRoot) + path.sep;
  const resolved = path.resolve(resolvedPath);
  return resolved === path.resolve(allowedRoot) || resolved.startsWith(root);
}

/**
 * Create the media:// protocol request handler.
 *
 * Supports HTTP range requests (needed for <video> seeking) and 404s
 * anything outside the allowed root.
 *
 * @param {string} allowedRoot - Directory whose files may be served
 * @returns {(request: Request) => Promise<Response>} Protocol handler
 */
export function createMediaRequestHandler(allowedRoot) {
  const root = path.resolve(allowedRoot);

  return async function handleMediaRequest(request) {
    const url = new URL(request.url);
    const filePath = mediaPathFromUrl(url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }

    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved, root)) {
      return new Response('Forbidden', { status: 403 });
    }

    let stat;
    try {
      stat = await fs.promises.stat(resolved);
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    if (!stat.isFile()) {
      return new Response('Not Found', { status: 404 });
    }

    const mime = MEDIA_MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    const baseHeaders = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(stat.size),
    };

    const range = parseRangeHeader(request.headers.get('Range'), stat.size);
    if (range) {
      const stream = fs.createReadStream(resolved, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      });
    }

    const stream = fs.createReadStream(resolved);
    return new Response(Readable.toWeb(stream), { status: 200, headers: baseHeaders });
  };
}
