/**
 * Preload Script
 *
 * Exposes a minimal, safe API to the renderer for network requests.
 * Because the app loads from the custom `app://` origin, renderer-side
 * fetch() is subject to CORS. Many RSS servers do not send CORS headers,
 * so feed discovery and parsing would fail. This preload bridge lets the
 * renderer ask the main process to fetch arbitrary URLs on its behalf.
 *
 * Only fetchText(url) is exposed; the renderer cannot execute arbitrary
 * Node code. contextIsolation is enabled, so the exposed object is isolated
 * from the page JavaScript.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  /**
   * Fetch the text body of a URL from the main process.
   *
   * @param {string} url - The URL to fetch
   * @returns {Promise<{ok: boolean, status: number, text: string}>} Response body and status
   */
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),

  /**
   * Fetch the raw bytes of a URL from the main process.
   *
   * @param {string} url - The URL to fetch
   * @returns {Promise<{ok: boolean, status: number, buffer?: Uint8Array, contentType?: string, text?: string}>}
   */
  fetchBytes: (url) => ipcRenderer.invoke('fetch-binary', url),

  /**
   * Open a URL in the user's default browser.
   *
   * @param {string} url - The URL to open
   * @returns {Promise<void>}
   */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /**
   * Subscribe to Escape presses forwarded from the main process.
   *
   * The main process intercepts Escape at the webContents level so the
   * shortcut keeps working while focus is inside a cross-origin iframe,
   * where document-level keydown listeners never fire.
   *
   * @param {() => void} callback - Invoked once per forwarded press
   * @returns {void}
   */
  onEscapePressed: (callback) => ipcRenderer.on('escape-pressed', () => callback()),

  /**
   * Download a YouTube video to disk from the main process.
   *
   * @param {string} url - The YouTube video URL
   * @returns {Promise<{filePath?: string, error?: string}>} Download result
   */
  downloadYouTubeVideo: (url) => ipcRenderer.invoke('download-youtube-video', url),

  /**
   * Delete a downloaded YouTube video file from disk.
   *
   * @param {string} filePath - Path to the downloaded file
   * @returns {Promise<boolean>} Whether the file was deleted or already absent
   */
  deleteDownloadedVideo: (filePath) => ipcRenderer.invoke('delete-downloaded-video', filePath),

  /**
   * Subscribe to YouTube download progress events forwarded from the
   * main process while a download-youtube-video call is in flight.
   *
   * @param {(progress: {url: string, stage: string, percent?: number|null, totalSize?: string, currentSpeed?: string, eta?: string}) => void} callback
   *   Invoked once per progress update
   * @returns {() => void} Function that removes the subscription
   */
  onYouTubeDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('youtube-download-progress', listener);
    return () => ipcRenderer.removeListener('youtube-download-progress', listener);
  },
});
