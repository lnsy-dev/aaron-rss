# Aaron RSS

A vanilla JS, CSS and HTML project that runs both as an **Electron desktop app** and as a **static front-end-only web app**, with SQLite local persistence (sqlite-wasm), Chrome file APIs, Custom HTML Elements, and optional C++/Rust WebAssembly.

Releases are published at <https://github.com/lnsy-dev/aaron-rss/releases>.

## Features

- **RSS/Atom feed reader** — subscribe to feeds, fetch articles, and read them in a clean built-in reader with defuddle extraction and markdown rendering.
- **Auto-download YouTube videos** — when a feed item links to a YouTube video, the app can automatically download it in the background (via yt-dlp in the Electron main process), with a live progress toast and built-in playback of the downloaded file.
- **Bluesky integration** — paste a `bsky.app` profile URL and the app discovers the profile's RSS feed automatically; post links are opened through Bluesky's public API so original posts, embedded quote posts, and replies render natively (no iframes).
- **Mastodon integration** — the same works for Mastodon: profile URLs resolve to their Atom feeds, and post links are fetched through instance public APIs and rendered as native posts, including reply threads.
- **Local-first storage** — feeds, articles, and settings persist in SQLite (compiled to WebAssembly) in OPFS, entirely on your own machine. No accounts, no cloud.
- **OPML import/export** — bring your subscription list from any other reader, and take it with you when you leave.
- **Database export/import** — snapshot the whole SQLite database to a file on disk and restore it later, via Chrome's File System Access API.

## Getting Started

Install dependencies:

```bash
npm install
```

## Running the Project (Web)

```bash
npm start
```

Starts a development server on port 3456 (configurable via `.env`). Open `http://localhost:3456` in Chrome.

## Running the Project (Electron)

```bash
npm run electron
```

When the dev server is running, Electron loads it (hot reload). Otherwise it loads the production build from `dist/` — run `npm run build` first.

## Building the Web App

```bash
npm run build
```

Creates a `dist` folder with the bundled and optimized files — a static site you can deploy to any web host. No special HTTP headers are required: the SQLite database persists in OPFS via sqlite-wasm's "opfs-sahpool" VFS, which works in any modern browser without cross-origin isolation.

## Packaging the Desktop App

```bash
npm run electron:build
```

Builds the web app and packages it with electron-builder into `release/` (macOS, Windows NSIS, Linux AppImage). Packaging identity (`appId`, `productName`) lives in the `build` field of `package.json`.

## Testing

End-to-end tests (Playwright) cover the full app in a real browser — database reads/writes, OPFS persistence across reloads, the WASM demos, and the File System Access dialog flows (the native pickers are stubbed via `page.addInitScript`, since automation cannot click OS dialogs):

```bash
npx playwright install chromium   # first run only
npm test
```

Unit tests (Vitest) cover the libraries in `src/lib/` and the sqlite worker's message protocol against a real in-memory SQLite:

```bash
npm run test:unit
```

Debug e2e tests interactively with `npm run test:ui`.

## Local Storage Architecture

- `src/sqlite-worker.js` runs SQLite (compiled to WebAssembly) in a module web worker. It persists the database in OPFS (Origin Private File System) via sqlite-wasm's "opfs-sahpool" VFS, which works in any modern browser without special HTTP headers; if OPFS is unavailable it falls back to a transient in-memory database.
- `src/lib/database.js` is the main-thread API: `initSchema()`, `addNote()`, `listNotes()`, `deleteNote()`, `createNotesIndex()`, `listIndexes()`, `exportDatabase()`, `importDatabase()`, `getStatus()`. All SQL goes through here — always use bound parameters (`?`) for user input.
- `src/lib/file-storage.js` wraps the File System Access API: `saveBytesToDisk()` and `pickFileFromDisk()` implement database export/import to real files on disk, and `saveOPMLToDisk()` / `pickOPMLFileFromDisk()` handle OPML subscription lists.
- `src/db-component.js` and `src/file-storage-component.js` are the demo UIs built on these libraries.

## Customizing the Build

Create a `.env` file in the project root (see `.env.example`):

```
OUTPUT_FILE_NAME=my-custom-filename.js   # default: main.min.js
PORT=8080                                 # default: 3456
SEPARATE_CSS=true                         # default: false
```

## Project Structure

- `src/` - JavaScript source files and custom elements
- `src/lib/` - Framework-free libraries (database client, file storage)
- `src/sqlite-worker.js` - The sqlite-wasm web worker
- `src/wasm/` - WebAssembly source files (C++ and Rust), if selected at scaffolding time
- `electron/` - Electron main process
- `styles/` - CSS files
- `tests/` - Test files (`tests/e2e/` Playwright, `tests/unit/` Vitest)
- `scripts/` - Build scripts (including classic Web Worker transformation)
- `assets/` - Static files (images, fonts, etc.)
- `index.html` - Main HTML file
- `index.js` - Main JavaScript entry point
- `index.css` - Main CSS file
- `webpack.config.js` - Webpack configuration
- `playwright.config.js` - Playwright e2e configuration
- `vitest.config.js` - Vitest unit test configuration

## WebAssembly

If you selected C++ and/or Rust support when scaffolding, the template includes pre-built WebAssembly examples:

- **C++ (Emscripten)**: `src/wasm/cpp/fibonacci.cpp` compiled to `fibonacci.js` + `fibonacci.wasm`
- **Rust (wasm-pack)**: `src/wasm/rust/fibonacci/src/lib.rs` compiled to `pkg/fibonacci.js` + `fibonacci_bg.wasm`

To rebuild them (requires Emscripten SDK / wasm-pack):

```bash
npm run build:wasm:cpp
npm run build:wasm:rust
```

See `src/wasm-cpp-component.js` and `src/wasm-rust-component.js` for how to load wasm modules in dataroom-js components.

## Technologies

- **Electron** - Desktop app runtime and packaging (electron-builder)
- **sqlite-wasm** - SQLite compiled to WebAssembly, with OPFS persistence
- **File System Access API** - Chrome's API for reading/writing local files
- **Webpack** - Bundler for development and production
- **dataroom-js** - Custom HTML elements framework
- **WebAssembly** - High-performance compute (C++ and Rust)
- **PostCSS / SWC** - CSS processing and fast JS transpilation

## Publishing to npm

This project is configured for publishing to npm (`npm pack --dry-run` to preview, `npm publish` to publish). Development files are excluded via `.npmignore`.
