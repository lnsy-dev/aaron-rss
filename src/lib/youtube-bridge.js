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

/**
 * Subscribe to YouTube download progress events forwarded from the
 * Electron main process. Outside Electron (tests, plain browser) this
 * returns a no-op unsubscribe and never invokes the callback.
 *
 * @param {(progress: {url: string, stage: string, percent?: number|null, totalSize?: string, currentSpeed?: string, eta?: string}) => void} callback
 * @returns {() => void} Function that removes the subscription
 */
export function onDownloadProgress(callback) {
  if (typeof window === 'undefined' || !window.electron?.onYouTubeDownloadProgress) {
    return () => {};
  }

  return window.electron.onYouTubeDownloadProgress(callback);
}

/**
 * Whether the app is running inside Electron. Only Electron registers
 * the media:// protocol used to play downloaded video files, so the
 * renderer must not create media URLs elsewhere.
 *
 * @returns {boolean}
 */
export function isElectronAvailable() {
  return typeof window !== 'undefined' && !!window.electron;
}

/**
 * Build the media:// URL the Electron main process serves a downloaded
 * video file at. Mirrors buildMediaUrl() in electron/media-protocol.js
 * (kept renderer-side so src/ never imports from electron/).
 *
 * @param {string} filePath - Absolute path of the downloaded video
 * @returns {string} A media:// URL usable as a <video> source
 */
export function buildVideoMediaUrl(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`;
}
