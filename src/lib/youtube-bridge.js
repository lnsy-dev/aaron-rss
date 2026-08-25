/**
 * YouTube Download Bridge (Renderer)
 *
 * Thin renderer-side wrapper around the Electron preload bridge for
 * downloading and deleting YouTube videos. Returns graceful error
 * objects when running outside Electron (e.g. unit tests or a browser).
 */

/**
 * Download a YouTube video through the Electron main process.
 *
 * @param {string} url
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
export async function downloadYouTubeVideo(url) {
  if (typeof window === 'undefined' || !window.electron?.downloadYouTubeVideo) {
    return { error: 'YouTube downloads are only available in the Electron app' };
  }

  return window.electron.downloadYouTubeVideo(url);
}

/**
 * Delete a downloaded YouTube video file through the Electron main process.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function deleteDownloadedVideo(filePath) {
  if (typeof window === 'undefined' || !window.electron?.deleteDownloadedVideo) {
    return false;
  }

  return window.electron.deleteDownloadedVideo(filePath);
}
