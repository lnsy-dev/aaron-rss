/**
 * Podcast Download Backend
 *
 * Runs in the Electron main process. Streams podcast audio enclosures
 * to the user's Downloads/Aaron-RSS-Podcasts folder and deletes
 * downloaded files on request. Unlike YouTube downloads (yt-dlp), a
 * podcast episode is a direct audio URL, so a plain streaming fetch is
 * enough — no external binary required.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { isAudioMIMEType, isAudioURLExtension } from '../src/lib/podcast.js';

/** Subdirectory inside the user's Downloads folder where podcasts are saved. */
const DOWNLOAD_DIR_NAME = 'Aaron-RSS-Podcasts';

/** Suffix used while a download is still being written. */
const PARTIAL_SUFFIX = '.part';

/**
 * Return the directory where downloaded podcast episodes are stored.
 *
 * @returns {string}
 */
export function getPodcastDownloadDirectory() {
  return path.join(app.getPath('downloads'), DOWNLOAD_DIR_NAME);
}

/**
 * Ensure the podcast download directory exists.
 *
 * @returns {Promise<void>}
 */
async function ensureDownloadDirectory() {
  await fs.mkdir(getPodcastDownloadDirectory(), { recursive: true });
}

/**
 * Reduce a suggested file name to a safe cross-platform basename.
 *
 * @param {string} suggestedName - Name proposed by the renderer
 * @returns {string} Sanitized name (possibly a fallback)
 */
export function sanitizeFileName(suggestedName) {
  const base = String(suggestedName || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 150)
    .trim();
  return base || 'podcast-episode.mp3';
}

/**
 * Pick a destination path that does not collide with an existing file.
 *
 * Appends " (2)", " (3)", … before the extension until a free name is
 * found (checking the final file name, not the .part file).
 *
 * @param {string} dir - Destination directory
 * @param {string} fileName - Desired file name
 * @returns {Promise<string>} Absolute destination path
 */
export async function resolveDestinationPath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let counter = 2;

  // Loop bound is a paranoia guard; a directory with 10k same-named
  // podcasts is not a real scenario.
  while (counter < 10000) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${base} (${counter})${ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
  return candidate;
}

/**
 * Format a byte count as a short human-readable string.
 *
 * @param {number} bytes
 * @returns {string} e.g. "42.3 MB"
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * Report a download progress update to an optional listener.
 *
 * Listener failures are swallowed so a broken UI channel can never
 * abort an in-flight download.
 *
 * @param {Function|null} onProgress - Progress callback, if any
 * @param {object} payload - Progress payload
 * @returns {void}
 */
function reportDownloadProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') {
    return;
  }
  try {
    onProgress(payload);
  } catch {
    // Never let a listener error kill the download.
  }
}

/**
 * Download a podcast audio enclosure to disk.
 *
 * Streams the response body straight to a `.part` file and renames it
 * into place on completion, so partial downloads never look finished.
 * Progress is reported as { stage, percent?, totalSize? } updates.
 *
 * @param {string} url - Direct audio enclosure URL
 * @param {string} suggestedName - File name proposed by the renderer
 * @param {Function|null} [onProgress] - Optional progress callback
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
export async function downloadPodcastEpisode(url, suggestedName, onProgress = null) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { error: 'Not a downloadable audio URL' };
  }

  let destination = null;
  let partPath = null;

  try {
    reportDownloadProgress(onProgress, { stage: 'starting', percent: null });

    await ensureDownloadDirectory();
    const fileName = sanitizeFileName(suggestedName);
    destination = await resolveDestinationPath(getPodcastDownloadDirectory(), fileName);
    partPath = `${destination}${PARTIAL_SUFFIX}`;

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      return { error: `Download failed with status ${response.status}` };
    }

    // Reject obvious non-audio responses (e.g. HTML error pages that
    // return 200). Feeds with missing/broken metadata still pass when
    // the URL itself looks like audio.
    const contentType = response.headers.get('content-type') || '';
    const looksAudio =
      isAudioMIMEType(contentType) ||
      isAudioURLExtension(url) ||
      contentType === 'application/octet-stream';
    if (!looksAudio) {
      return { error: `URL does not point to audio (${contentType || 'unknown type'})` };
    }

    const totalBytes = Number(response.headers.get('content-length')) || null;
    let receivedBytes = 0;

    const bodyStream = response.body;
    if (!bodyStream) {
      return { error: 'Download failed: empty response body' };
    }

    const nodeStream = Readable.fromWeb(bodyStream);
    const chunks = [];
    // Write chunk-by-chunk through the promise API so memory stays at
    // one chunk instead of the whole (often 50-200 MB) episode.
    const fileHandle = await fs.open(partPath, 'w');
    try {
      for await (const chunk of nodeStream) {
        await fileHandle.write(chunk);
        receivedBytes += chunk.length;
        reportDownloadProgress(onProgress, {
          stage: 'downloading',
          percent: totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : null,
          totalSize: formatBytes(totalBytes ?? receivedBytes),
        });
      }
    } finally {
      await fileHandle.close();
    }

    // Never overwrite an existing file: if another download finished
    // first, keep both by re-resolving a free name.
    try {
      await fs.access(destination);
      const ext = path.extname(destination);
      destination = await resolveDestinationPath(
        path.dirname(destination),
        `${path.basename(destination, ext)} (2)${ext}`
      );
    } catch {
      // Destination still free — proceed with the rename.
    }
    await fs.rename(partPath, destination);
    partPath = null;

    reportDownloadProgress(onProgress, { stage: 'processing', percent: 100 });

    return { filePath: destination };
  } catch (error) {
    // Remove the partial file so failed downloads leave no litter.
    if (partPath) {
      try {
        await fs.unlink(partPath);
      } catch {
        // Nothing to clean up (or already removed).
      }
    }
    return { error: error.message || String(error) };
  }
}

/**
 * Delete a downloaded podcast file from disk.
 *
 * Tolerates missing files so callers can safely delete stale paths.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function deleteDownloadedPodcast(filePath) {
  if (!filePath) {
    return true;
  }

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    return false;
  }
}
