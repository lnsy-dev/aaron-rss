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
 * Registry of in-flight downloads keyed by their final destination path.
 *
 * Each entry holds that download's AbortController and the `.part` path
 * it is currently writing, so application quit can abort the network
 * read (triggering each download's own cleanup) and the partial-file
 * sweep can skip files that are still actively being written.
 *
 * @type {Map<string, {controller: AbortController, partPath: string}>}
 */
const activeDownloads = new Map();

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
 * The fetch can be aborted with cancelPodcastDownloads() (used when
 * the application quits); an aborted download cleans up its `.part`
 * file like any other failure.
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
  // Each download gets its own controller so quit cancels exactly the
  // in-flight fetches, not unrelated work.
  const controller = new AbortController();

  try {
    reportDownloadProgress(onProgress, { stage: 'starting', percent: null });

    await ensureDownloadDirectory();
    const fileName = sanitizeFileName(suggestedName);
    destination = await resolveDestinationPath(getPodcastDownloadDirectory(), fileName);
    partPath = `${destination}${PARTIAL_SUFFIX}`;

    // Register before the fetch starts so quit can cancel this
    // download from the first byte onward.
    activeDownloads.set(destination, { controller, partPath });

    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      // Thrown so the shared catch unregisters the download; the
      // .part file is not created until later, so nothing to unlink.
      throw new Error(`Download failed with status ${response.status}`);
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
      throw new Error(`URL does not point to audio (${contentType || 'unknown type'})`);
    }

    const totalBytes = Number(response.headers.get('content-length')) || null;
    let receivedBytes = 0;

    const bodyStream = response.body;
    if (!bodyStream) {
      throw new Error('Download failed: empty response body');
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
    // first, keep both by re-resolving a free name. The registry entry
    // moves with it so cancellation and sweeps stay accurate.
    try {
      await fs.access(destination);
      activeDownloads.delete(destination);
      const ext = path.extname(destination);
      destination = await resolveDestinationPath(
        path.dirname(destination),
        `${path.basename(destination, ext)} (2)${ext}`
      );
      partPath = `${destination}${PARTIAL_SUFFIX}`;
      activeDownloads.set(destination, { controller, partPath });
    } catch {
      // Destination still free — proceed with the rename.
    }
    await fs.rename(partPath, destination);
    partPath = null;
    // Finished successfully — no longer eligible for cancellation.
    activeDownloads.delete(destination);

    reportDownloadProgress(onProgress, { stage: 'processing', percent: 100 });

    return { filePath: destination };
  } catch (error) {
    // This download is done regardless of how it ended.
    if (destination) {
      activeDownloads.delete(destination);
    }
    // Remove the partial file so aborted or failed downloads leave no
    // litter. An abort can land mid-stream, when the .part file is
    // already open on disk.
    if (partPath) {
      try {
        await fs.unlink(partPath);
      } catch {
        // Nothing to clean up (or already removed).
      }
    }
    // Abortions (application quit) are expected, not failures.
    if (error?.name === 'AbortError') {
      reportDownloadProgress(onProgress, { stage: 'cancelled', percent: null });
      return { error: 'Download cancelled' };
    }
    return { error: error.message || String(error) };
  }
}

/**
 * Cancel every in-flight podcast download.
 *
 * The only current caller is the application quit flow: aborting the
 * fetch makes each download's error handler remove its own `.part`
 * file, exactly like a mid-stream network failure. Cancel by error
 * name is used because the abort can surface either from the fetch
 * call itself or from the body stream iteration.
 *
 * @returns {number} Number of downloads that were cancelled
 */
export function cancelPodcastDownloads() {
  let count = 0;
  for (const { controller } of activeDownloads.values()) {
    try {
      controller.abort();
      count += 1;
    } catch {
      // Aborting cannot realistically throw; keep the loop resilient.
    }
  }
  return count;
}

/**
 * Delete orphaned `.part` files left in the download directory.
 *
 * Partial files survive the process only when the app is killed
 * faster than its cleanup runs (crash, force quit, power loss, or
 * a download aborted right at quit time). This sweep runs at startup
 * and after quitting to remove those leftovers. Files being written
 * by an in-flight download are skipped.
 *
 * @param {string} [dir] - Directory to sweep (defaults to the podcast folder)
 * @returns {Promise<number>} Number of partial files removed
 */
export async function cleanupPartialDownloads(dir = getPodcastDownloadDirectory()) {
  let removed = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Directory does not exist (or is unreadable) — nothing to sweep.
    return 0;
  }

  const activePartPaths = new Set(
    [...activeDownloads.values()].map((state) => state.partPath)
  );

  for (const entry of entries) {
    if (!entry.name.endsWith(PARTIAL_SUFFIX)) {
      continue;
    }
    const partPath = path.join(dir, entry.name);
    if (activePartPaths.has(partPath)) {
      // Still being written by an in-flight download — leave it.
      continue;
    }
    try {
      await fs.unlink(partPath);
      removed += 1;
    } catch {
      // Unreadable or already gone — skip rather than fail the sweep.
    }
  }
  return removed;
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
