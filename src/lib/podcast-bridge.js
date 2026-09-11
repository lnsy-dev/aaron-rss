/**
 * Podcast Download Bridge (Renderer)
 *
 * Thin renderer-side wrapper for downloading podcast audio enclosures.
 * Inside Electron the download streams through the main process into
 * Downloads/Aaron-RSS-Podcasts. In a plain browser it falls back to the
 * File System Access API (showSaveFilePicker) and streams the fetch
 * body into the picked file. Returns graceful error objects when
 * neither path is available.
 */

import { isUserCancellation } from './file-storage.js';

/**
 * Whether podcast downloads can work in the current environment.
 *
 * True inside Electron (main-process download) and in browsers that
 * implement the File System Access API save picker.
 *
 * @returns {boolean}
 */
export function isPodcastDownloadAvailable() {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(window.electron?.downloadPodcastEpisode) ||
    typeof window.showSaveFilePicker === 'function';
}

/**
 * Download a podcast enclosure through the Electron main process.
 *
 * @param {string} url - Audio enclosure URL
 * @param {string} suggestedName - File name for the download
 * @param {Function} [onProgress] - Receives {stage, percent?, totalSize?}
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
async function downloadViaElectron(url, suggestedName, onProgress) {
  const unsubscribe = window.electron.onPodcastDownloadProgress((progress) => {
    if (progress?.url === url && typeof onProgress === 'function') {
      onProgress(progress);
    }
  });

  try {
    return await window.electron.downloadPodcastEpisode(url, suggestedName);
  } finally {
    unsubscribe();
  }
}

/**
 * Download a podcast enclosure through the File System Access API.
 *
 * The save picker is opened before any await so the call stays inside
 * the click handler's user-gesture window; the response body is then
 * streamed chunk-by-chunk into the chosen file.
 *
 * @param {string} url - Audio enclosure URL
 * @param {string} suggestedName - File name for the download
 * @param {Function} [onProgress] - Receives {stage, percent?, totalSize?}
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
async function downloadViaFileSystemAccess(url, suggestedName, onProgress) {
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'Podcast audio',
          accept: {
            'audio/mpeg': ['.mp3'],
            'audio/mp4': ['.m4a', '.m4b'],
            'audio/aac': ['.aac'],
            'audio/ogg': ['.ogg', '.oga', '.opus'],
            'audio/wav': ['.wav'],
            'audio/flac': ['.flac'],
          },
        },
      ],
    });
  } catch (error) {
    if (isUserCancellation(error)) {
      return { error: 'cancelled' };
    }
    return { error: error.message || String(error) };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { error: `Download failed with status ${response.status}` };
    }
    if (!response.body) {
      return { error: 'Download failed: empty response body' };
    }

    const totalBytes = Number(response.headers.get('content-length')) || null;
    const writable = await handle.createWritable();
    let receivedBytes = 0;

    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        await writable.write(value);
        receivedBytes += value.length;
        if (typeof onProgress === 'function') {
          onProgress({
            stage: 'downloading',
            percent: totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : null,
            totalSize: totalBytes ? `${Math.round((totalBytes / 1024 / 1024) * 10) / 10} MB` : '',
          });
        }
      }
    } finally {
      await writable.close();
    }

    return { filePath: handle.name };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

/**
 * Download a podcast audio file.
 *
 * Routes to the Electron main process when available, otherwise to the
 * File System Access API. The result filePath is an absolute path in
 * Electron and a bare file name in the browser fallback.
 *
 * @param {string} url - Audio enclosure URL
 * @param {string} suggestedName - File name for the download
 * @param {Function} [onProgress] - Receives {stage, percent?, totalSize?}
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
export async function downloadPodcastFile(url, suggestedName, onProgress = null) {
  if (typeof window === 'undefined') {
    return { error: 'Podcast downloads require a browser environment' };
  }

  if (window.electron?.downloadPodcastEpisode) {
    return downloadViaElectron(url, suggestedName, onProgress);
  }

  if (typeof window.showSaveFilePicker === 'function') {
    return downloadViaFileSystemAccess(url, suggestedName, onProgress);
  }

  return { error: 'Podcast downloads are not supported in this browser' };
}

/**
 * Delete a downloaded podcast file through the Electron main process.
 *
 * Only Electron can resolve the stored absolute path; the browser
 * fallback saves through the user's own file picker, so there is
 * nothing for us to delete there.
 *
 * @param {string} filePath - Absolute path of the downloaded file
 * @returns {Promise<boolean>} Whether the file was deleted or absent
 */
export async function deleteDownloadedPodcast(filePath) {
  if (typeof window === 'undefined' || !window.electron?.deleteDownloadedPodcast) {
    return false;
  }

  return window.electron.deleteDownloadedPodcast(filePath);
}
