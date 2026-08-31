/**
 * Electron Main Process
 *
 * Launches the app as an Electron desktop application.
 *
 * Two load modes:
 *   1. Development: if a webpack dev server answers at ELECTRON_DEV_URL
 *      (default http://localhost:3456, started with `npm start`), the
 *      window loads that URL for hot-reload development.
 *   2. Production: the bundled dist/ directory is served over a custom
 *      privileged `app://` protocol registered below.
 *
 * Why a custom protocol instead of loadFile()? The app relies on web
 * platform features that need a real origin: module web workers,
 * fetching .wasm binaries, and OPFS (Origin Private File System)
 * persistence for the SQLite database. Serving dist/ over a standard,
 * secure scheme makes all of them behave exactly like they do on the
 * web — no special Electron-only code paths.
 *
 * For LLMs: this file runs in Node.js (Electron main), NOT in a browser.
 * Renderer code lives in src/ and index.js. Keep Node/Electron APIs here
 * and web APIs there; the renderer has contextIsolation enabled and no
 * nodeIntegration.
 */

import { app, BrowserWindow, Menu, protocol, net, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initializeAdBlocker } from './adblocker.js';
import {
  downloadYouTubeVideo,
  deleteDownloadedVideo,
  checkForYTDlpUpdate,
  getDownloadDirectory,
} from './youtube-download.js';
import { createMediaRequestHandler } from './media-protocol.js';

/**
 * Content-Security-Policy for production builds served over app://.
 *
 * - WebAssembly is allowed via 'wasm-unsafe-eval' instead of full
 *   'unsafe-eval', which keeps the Electron security warning away.
 * - No inline scripts are permitted in the production bundle.
 * - Inline styles are allowed so that article content extracted from
 *   external pages (which may carry inline style attributes) renders
 *   without CSP violations.
 * - Images may load from external feed URLs (https:/http:/data:).
 * - Workers and wasm fetches are limited to the app's own origin.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https: http: data:",
  "media-src 'self' media:",
  "frame-src https: http:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
].join('; ');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:3456';

/**
 * Dev-server CSP used when Electron loads the webpack dev server.
 * Webpack HMR relies on eval() and inline styles, so this is looser.
 * Google Fonts are allowed so the theme typography stays unchanged.
 *
 * The connect-src directive is derived from the actual dev server URL so
 * a custom ELECTRON_DEV_URL or PORT is still covered.
 */
const devServerOrigin = new URL(DEV_SERVER_URL).origin;
const devServerWsScheme = new URL(DEV_SERVER_URL).protocol === 'https:' ? 'wss' : 'ws';
const devServerHost = new URL(DEV_SERVER_URL).host;
const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https: http: data:",
  "media-src 'self' media:",
  "frame-src https: http:",
  "worker-src 'self' blob:",
  `connect-src 'self' ${devServerOrigin} ${devServerWsScheme}://${devServerHost}`,
  "font-src 'self' https://fonts.gstatic.com",
].join('; ');

/**
 * Path to the application icon used for the window/taskbar/dock.
 *
 * In development the icon lives in the repo's assets/ directory. In a
 * packaged build webpack has copied assets/ into dist/, so point there.
 */
const ICON_PATH = app.isPackaged
  ? path.resolve(DIST_DIR, 'assets', 'logo.png')
  : path.resolve(__dirname, '..', 'assets', 'logo.png');

/** Minimal MIME table for the static files webpack emits into dist/. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Register `app://` as a privileged scheme.
 * Must run before the app is ready. `standard` + `secure` make the
 * scheme behave like https: for URL parsing and web platform features
 * (workers, OPFS, File System Access API).
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    // Serves downloaded YouTube videos from disk so <video> elements
    // in the renderer can play files without file:// access.
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

/**
 * Serve files from dist/ over the app:// protocol.
 *
 * @param {Request} request - The incoming protocol request
 * @returns {Promise<Response>} The file contents or an error response
 */
async function handleAppRequest(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname || pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.normalize(path.join(DIST_DIR, pathname));

  // Guard against path traversal outside dist/
  if (!filePath.startsWith(DIST_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

/**
 * Decide what the window should load.
 *
 * Pings the webpack dev server; if it answers, load it (development
 * with hot reload). Otherwise load the production build over app://.
 *
 * @returns {Promise<string>} The URL to load in the main window
 */
async function resolveStartUrl() {
  try {
    const response = await Promise.race([
      net.fetch(DEV_SERVER_URL, { method: 'HEAD' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    const isOurDevServer = response.headers.get('X-Aaron-RSS') === 'dev-server';
    if (response.ok && isOurDevServer) {
      console.log(`[electron] Dev server detected at ${DEV_SERVER_URL} — loading with hot reload`);
      return DEV_SERVER_URL;
    }
    if (response.ok && !isOurDevServer) {
      console.log(`[electron] Server answered at ${DEV_SERVER_URL} but is not this app's dev server; ignoring it`);
    }
  } catch {
    // Dev server not running; fall through to the production build.
  }
  console.log('[electron] Loading production build from dist/ via app://');
  return 'app://./index.html';
}

/**
 * Decide whether a URL belongs to the application itself.
 *
 * Allows relative URLs, the custom app:// protocol, the dev server
 * origin, and about:blank. Everything else is treated as external and
 * should be handed to the user's default browser.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
function isInternalUrl(urlString) {
  if (!urlString) {
    return true;
  }
  try {
    const url = new URL(urlString);
    if (url.protocol === 'about:') {
      return true;
    }
    if (url.protocol === 'app:') {
      return true;
    }
    if (url.origin === DEV_SERVER_URL) {
      return true;
    }
    return false;
  } catch {
    // Relative or malformed URLs are considered part of the app.
    return true;
  }
}

/**
 * Re-open the main application window from the menu.
 *
 * If no window exists (the user closed it but the app kept running,
 * e.g. on macOS), a fresh one is created. If one exists but is hidden
 * or minimized, it is restored and focused instead.
 */
function reopenWindow() {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    createWindow().catch((error) => {
      console.error('[electron] Failed to re-open window:', error);
    });
    return;
  }
  const win = BrowserWindow.getFocusedWindow() || windows[0];
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

/**
 * Build and install the application menu.
 *
 * Keeps the standard role-based menus (File/Edit/Window/Help) and adds
 * a "Reopen Window" item to the View menu so there is always a way to
 * get the main window back after closing it.
 */
function createAppMenu() {
  const template = [
    // macOS requires an app menu for keyboard shortcuts to work fully.
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reopen Window',
          click: () => reopenWindow(),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Create the main application window.
 *
 * @returns {Promise<void>}
 */
async function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    icon: ICON_PATH,
    // Match the window chrome (title bar / menu bar area) to the app's
    // body background color defined in styles/variables.css as
    // --background-color: #f2ece2.
    backgroundColor: '#f2ece2',
    // macOS: use a transparent title bar that lets the page background
    // show through, with the traffic-light buttons inset from the edge.
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      // Secure defaults: the renderer is plain web code, no Node access.
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.resolve(__dirname, 'preload.cjs'),
      // Allow the renderer to throttle timers while hidden. The RSS
      // component pauses auto-refresh on visibilitychange, so the app
      // does not keep churning memory while idle.
      backgroundThrottling: true,
    },
  });

  const startUrl = await resolveStartUrl();
  win.loadURL(startUrl);

  // Keep the user from being navigated away from the app. External links
  // open in the system's default browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on('will-frame-navigate', (event, details) => {
    if (details.isMainFrame) {
      return; // Main-frame navigation is handled by will-navigate.
    }
    const currentUrl = details.frame?.url || '';
    if (currentUrl === 'about:blank' || currentUrl === '') {
      return; // Allow the initial iframe load (e.g. the "Open Original" viewer).
    }
    if (isInternalUrl(details.url)) {
      return;
    }
    event.preventDefault();
    shell.openExternal(details.url);
  });

  // Forward Escape presses over IPC so the renderer can act on them even
  // when keyboard focus sits inside a cross-origin iframe (e.g. the
  // "Open Original" website viewer), where document keydown events never
  // arrive. The event is NOT prevented here so in-page handlers (command
  // panel, modal inputs) still see it; the renderer deduplicates via a
  // timestamp guard in _runEscapeAction().
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') {
      return;
    }
    win.webContents.send('escape-pressed');
  });
}

/**
 * Fetch a URL from the main process on behalf of the renderer.
 *
 * Returns a plain object so it serializes cleanly through the
 * context-bridge IPC layer.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<{ok: boolean, status: number, text: string}>}
 */
async function fetchText(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: error.message };
  }
}

/**
 * Fetch a URL's raw bytes from the main process on behalf of the renderer.
 *
 * Used for things like saving or copying remote article images, which
 * cannot be fetched from the app:// origin because of missing CORS
 * headers. Returns a plain object with the body as a Uint8Array so it
 * serializes cleanly through the context-bridge IPC layer.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<{ok: boolean, status: number, buffer?: Uint8Array, text?: string}>}
 */
async function fetchBinary(url) {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      buffer: new Uint8Array(arrayBuffer),
      contentType: response.headers.get('content-type') || '',
    };
  } catch (error) {
    return { ok: false, status: 0, text: error.message };
  }
}

ipcMain.handle('fetch-text', async (_, url) => fetchText(url));
ipcMain.handle('fetch-binary', async (_, url) => fetchBinary(url));
ipcMain.handle('open-external', async (_, url) => shell.openExternal(url));
ipcMain.handle('download-youtube-video', async (event, url) => {
  // Stream download progress to the requesting window so the renderer
  // can render a live progress toast while yt-dlp runs.
  const sender = event.sender;
  return downloadYouTubeVideo(url, (progress) => {
    if (!sender.isDestroyed()) {
      sender.send('youtube-download-progress', { url, ...progress });
    }
  });
});
ipcMain.handle('delete-downloaded-video', async (_, filePath) => deleteDownloadedVideo(filePath));

app.whenReady().then(async () => {
  protocol.handle('app', handleAppRequest);
  // Downloaded videos live under Downloads/Aaron-RSS-YouTube; only
  // files inside that directory are exposed over media://.
  protocol.handle('media', createMediaRequestHandler(getDownloadDirectory()));

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = new URL(details.url);
    const isAppProtocol = url.protocol === 'app:';
    const isDevServer = url.origin === DEV_SERVER_URL;

    if (isAppProtocol || isDevServer) {
      const csp = isAppProtocol ? PRODUCTION_CSP : DEVELOPMENT_CSP;
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
      return;
    }

    callback({ responseHeaders: details.responseHeaders });
  });

  // Initialize the ad/tracker blocker before creating the window so the
  // very first navigation is already protected. A failure here is logged
  // but non-fatal — the app should still open even if filter lists fail
  // to download or the cache cannot be written.
  try {
    await initializeAdBlocker();
    console.log('[electron] Ad blocker initialized');
  } catch (error) {
    console.error('[electron] Ad blocker initialization failed:', error);
  }

  await createWindow();

  // Install the application menu (View > Reopen Window etc.) now that
  // the first window exists and createWindow() can be referenced.
  createAppMenu();

  // Check for yt-dlp updates on startup and then every 24 hours so
  // YouTube downloads keep working as the site changes.
  checkForYTDlpUpdate().then((result) => {
    if (result.updated) {
      console.log(`[electron] yt-dlp updated to ${result.version}`);
    } else if (result.error) {
      console.error('[electron] yt-dlp update check failed:', result.error);
    } else {
      console.log(`[electron] yt-dlp is up to date (${result.version})`);
    }
  });
  setInterval(() => {
    checkForYTDlpUpdate().catch((error) => {
      console.error('[electron] Periodic yt-dlp update check failed:', error);
    });
  }, 24 * 60 * 60 * 1000);

  // macOS: re-create the window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
