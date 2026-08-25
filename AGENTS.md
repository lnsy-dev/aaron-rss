# Agent Conventions for Aaron RSS

This file governs all code in this directory and its subdirectories.

## Technology Stack

- **JavaScript**: Vanilla ES2020+ (no frameworks)
- **CSS**: Standard CSS with variables (no CSS-in-JS, no Shadow DOM)
- **Build Tool**: Webpack 5 with SWC transpilation
- **Custom Elements**: dataroom-js (extends HTMLElement)
- **Desktop**: Electron (main process in `electron/`, packaged with electron-builder)
- **Database**: `@sqlite.org/sqlite-wasm` in a module web worker, persisted in OPFS
- **Local Files**: Chrome's File System Access API (`showSaveFilePicker` / `showOpenFilePicker`)
- **Workers**: Web Workers (classic inline bundling, plus one native module worker for SQLite)
- **WebAssembly**: C++ via Emscripten, Rust via wasm-pack
- **Testing**: Playwright (e2e) and Vitest (unit) — see the Testing section below

## Code Style

### Comments

Use **DocBlock style comments** for all classes, methods, and exported functions:

```javascript
/**
 * Brief description.
 *
 * @param {string} paramName Description
 * @returns {number} Description
 */
```

Use inline `//` comments for implementation logic.

### Custom Elements

```javascript
import DataroomElement from 'dataroom-js';

class MyComponent extends DataroomElement {
  async initialize() {
    // Component setup
  }
}

if (!customElements.get('my-component')) {
  customElements.define('my-component', MyComponent);
}
```

Rules:
- Element names MUST contain a hyphen
- NEVER use Shadow DOM
- NEVER embed CSS in JavaScript
- Create CSS in `styles/<component-name>.css` and import in `index.css`
- `this.event(name, detail)` dispatches a non-bubbling CustomEvent on the element; to notify another component, call its methods directly (see `src/file-storage-component.js` calling `rss-feed-component.refreshFeeds()`)

### Database

- ALL SQL lives in `src/lib/database.js` — components never message the worker directly
- Always use bound parameters (`?`) for user input; never interpolate strings into SQL
- The worker protocol lives in `src/sqlite-worker.js` (`{ id, action, params }` → `{ id, ok, result|error }`)
- Persistence uses sqlite-wasm's "opfs-sahpool" VFS (`sqlite3.installOpfsSAHPoolVfs`) — OPFS storage with no cross-origin isolation requirement; do NOT switch to the classic `OpfsDb` (it needs COOP/COEP headers and a nested worker that bundlers break)
- If OPFS is unavailable the worker falls back to a transient in-memory DB — always handle both (check `getStatus().persistent`)
- Database export/import uses `sqlite3_js_db_export` / `sqlite3_deserialize` in the worker; subscription export/import uses OPML via `src/lib/opml.js` and the File System Access API wrappers in `src/lib/file-storage.js`
- File System Access pickers MUST be invoked from a user gesture (click handler)

### Electron

- `electron/main.js` is the ONLY file that runs in Node/Electron main; it serves `dist/` over the privileged `app://` protocol because module workers, .wasm fetching, and OPFS all need a real secure origin (do not replace with `loadFile`)
- The renderer is plain web code: `contextIsolation: true`, `nodeIntegration: false` — do not add Node APIs to renderer code
- When the webpack dev server answers at `ELECTRON_DEV_URL` (default `http://localhost:3456`), Electron loads it; otherwise it loads `app://./index.html`
- Packaging config (electron-builder) lives in the `build` field of `package.json`

### Web Workers

For classic (self-contained) workers, always use this exact syntax:

```javascript
const worker = new Worker(new URL('./my-worker.js', import.meta.url));
```

Never use string paths: `new Worker('./my-worker.js')` — bundlers cannot trace them.

For workers that import npm modules or `.wasm` files (like `src/sqlite-worker.js`), use webpack 5's native module-worker syntax instead:

```javascript
const worker = new Worker(new URL('./my-worker.js', import.meta.url), { type: 'module' });
```

### WebAssembly

#### C++ (Emscripten)

- Place source in `src/wasm/cpp/<name>.cpp`
- Use `EMSCRIPTEN_KEEPALIVE` on exported functions
- Build with `npm run build:wasm:cpp`
- Load glue module with dynamic `import()`
- Use `cwrap()` to create typed JS functions

#### Rust (wasm-pack)

- Place crate in `src/wasm/rust/<crate-name>/`
- Use `#[wasm_bindgen]` on exported functions
- Build with `npm run build:wasm:rust`
- Load pkg module with dynamic `import()`
- Call `await module.default()` before using exports

### Testing

**Directive:** Write and run tests for every feature you add or change. Keep both suites green, and add a matching test whenever you introduce new behavior.

#### E2E Tests (Playwright)

- Use `@playwright/test`; place tests in `tests/e2e/*.spec.js`
- Run with `npm test`; debug with `npm run test:ui`; first run needs `npx playwright install chromium`
- Use `page.locator()` for element selection and `page.evaluate()` for custom events
- Use 15-second timeouts for wasm-dependent assertions
- The File System Access pickers (`showSaveFilePicker`/`showOpenFilePicker`) are native dialogs that automation cannot click — stub them with `page.addInitScript()` and assert how the app drives the API
- The wasm e2e specs (`wasm-cpp-component.spec.js`, `wasm-rust-component.spec.js`) exist only when the corresponding WASM option was selected at scaffolding time

#### Unit Tests (Vitest)

- Use `vitest`; place tests in `tests/unit/*.test.js`; run with `npm run test:unit`
- Unit tests run in Node with explicit mocks — no dev server, no DOM emulation layer
- `src/lib/database.js` is tested against a fake `Worker` global that captures messages (assert exact action names, SQL, and bound params)
- `src/sqlite-worker.js` is tested against the real Node build of sqlite-wasm (in-memory) by providing `self.onmessage`/`self.postMessage` globals; the `.wasm` import is aliased in `vitest.config.js`
- Browser API wrappers (`src/lib/file-storage.js`) are tested with `vi.stubGlobal('window', ...)` fakes
- New logic MUST ship with unit tests in the same change

### State Management

- Use component instance properties (`this.propertyName`)
- Emit custom events for cross-component communication via `this.event('name', detail)`
- Listen to events via `this.on('name', callback)` or `this.once('name', callback)`

### HTTP Requests

- Use `this.getJSON(url)` for simple GET requests to JSON endpoints
- Use `this.call(endpoint, body)` for POST requests with auth/timeout support
- Always wrap in `try/catch` for error handling

## Build & Release

- After every code change, run `npm run build` to produce the production bundle in `dist/`.
- Electron serves `dist/` over the `app://` protocol in production, so the app will not reflect source edits until the production build is regenerated.
- Tests run against the webpack dev server and do not replace the production build; always rebuild before packaging or running Electron from a fresh state.
- Keep the `version` field in `package.json` in sync with the change: bump it appropriately for every release-worthy change (e.g. patch for fixes, minor for new features, major for breaking changes).

## File Organization

| Directory | Purpose |
|-----------|---------|
| `src/` | JavaScript modules and components |
| `src/lib/` | Framework-free libraries (database client, file storage) |
| `src/sqlite-worker.js` | The sqlite-wasm module worker |
| `src/wasm/` | WebAssembly source files and binaries |
| `electron/` | Electron main process |
| `styles/` | CSS files (one per component or concern) |
| `tests/` | Test files (see Testing section) |
| `scripts/` | Build-time transformation scripts |
| `assets/` | Static files (images, fonts, etc.) |

## Prohibited Patterns

- ❌ TypeScript
- ❌ React/Vue/Angular/Svelte
- ❌ Shadow DOM
- ❌ CSS-in-JS (styled-components, emotion, etc.)
- ❌ Inline styles in JavaScript
- ❌ Framework-specific state managers (Redux, Pinia, etc.)
- ❌ jQuery or similar DOM wrappers
- ❌ `new Worker('./relative-path.js')` (use `new URL(..., import.meta.url)`)
- ❌ Node/Electron APIs in renderer code (`src/`, `index.js`) — keep them in `electron/`
- ❌ SQL string interpolation with user input — always use bound parameters
