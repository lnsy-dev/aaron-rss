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
   * Toggle the window's native full screen state.
   *
   * The command panel's "Toggle Full Screen" command uses this instead
   * of the document Fullscreen API: Chromium reserves Escape for
   * leaving document full screen and never delivers that keydown to
   * the page, so Escape could not close an article while full screen.
   * Native window full screen keeps Escape in the page.
   *
   * @returns {Promise<boolean>} True when the window is full screen afterwards
   */
  toggleWindowFullScreen: () => ipcRenderer.invoke('toggle-full-screen'),

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
   * Subscribe to "Quick Keys" requests forwarded from the main process.
   *
   * The native Help menu carries the Cmd+? / Ctrl+? accelerator; Electron
   * consumes those keystrokes before the page sees them, so the menu asks
   * the renderer over IPC to open the quick keys reference dialog.
   *
   * @param {() => void} callback - Invoked once per request
   * @returns {void}
   */
  onShowQuickKeys: (callback) => ipcRenderer.on('show-quick-keys', () => callback()),

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

  /**
   * Read the YouTube cookie configuration used to authenticate yt-dlp
   * when YouTube demands sign-in.
   *
   * @returns {Promise<{cookiesFromBrowser?: string, cookiesFile?: string}>}
   */
  getYoutubeCookieConfig: () => ipcRenderer.invoke('youtube-get-cookie-config'),

  /**
   * Persist the YouTube cookie configuration.
   *
   * @param {{cookiesFromBrowser?: string, cookiesFile?: string}|null} config
   * @returns {Promise<{cookiesFromBrowser?: string, cookiesFile?: string}>} The saved config
   */
  setYoutubeCookieConfig: (config) => ipcRenderer.invoke('youtube-set-cookie-config', config),

  /**
   * Open a native file picker for a cookies.txt file.
   *
   * @returns {Promise<string|null>} The chosen path, or null when cancelled
   */
  chooseYoutubeCookiesFile: () => ipcRenderer.invoke('choose-youtube-cookies-file'),

  /**
   * Download a podcast audio enclosure to disk from the main process.
   *
   * @param {string} url - The audio enclosure URL
   * @param {string} suggestedName - File name proposed for the download
   * @returns {Promise<{filePath?: string, error?: string}>} Download result
   */
  downloadPodcastEpisode: (url, suggestedName) =>
    ipcRenderer.invoke('download-podcast-episode', url, suggestedName),

  /**
   * Delete a downloaded podcast file from disk.
   *
   * @param {string} filePath - Path to the downloaded file
   * @returns {Promise<boolean>} Whether the file was deleted or already absent
   */
  deleteDownloadedPodcast: (filePath) => ipcRenderer.invoke('delete-downloaded-podcast', filePath),

  /**
   * Subscribe to podcast download progress events forwarded from the
   * main process while a download-podcast-episode call is in flight.
   *
   * @param {(progress: {url: string, stage: string, percent?: number|null, totalSize?: string}) => void} callback
   *   Invoked once per progress update
   * @returns {() => void} Function that removes the subscription
   */
  onPodcastDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('podcast-download-progress', listener);
    return () => ipcRenderer.removeListener('podcast-download-progress', listener);
  },

  /**
   * Register the handler that answers the main process's Research
   * Topics watch-API queries. The database lives in the renderer, so
   * the main process forwards every API request here; the handler runs
   * in the page and resolves with the query result.
   *
   * @param {(query: {type: string, params: object}) => Promise<unknown>} handler
   * @returns {void}
   */
  onResearchApiQuery: (handler) => {
    ipcRenderer.on('research-api-query', async (_event, payload) => {
      let result = null;
      let error = null;
      try {
        result = await handler(payload.query);
      } catch (queryError) {
        error = queryError.message || String(queryError);
      }
      ipcRenderer.send('research-api-response', { id: payload.id, result, error });
    });
  },

  /**
   * Ask the main process for the watch API's location so the UI can
   * show the endpoint URLs users can watch from other applications.
   *
   * @returns {Promise<{baseUrl: string|null, endpoints: Array<{method: string, path: string, description: string}>}>}
   */
  getResearchApiInfo: () => ipcRenderer.invoke('research-api-info'),
});
