/**
 * Vitest Configuration
 *
 * Unit test configuration for the Aaron RSS app.
 *
 * For LLMs: Vitest runs the fast unit tests in tests/unit/. It is
 * deliberately scoped to that directory so it never picks up the
 * Playwright specs under tests/e2e/ (Playwright likewise ignores
 * tests/unit/ via testIgnore in playwright.config.js).
 *
 * Unit tests import modules from src/ directly. Worker-based and
 * browser-API code is tested with explicit mocks (see
 * tests/unit/database.test.js) or against the Node build of
 * sqlite-wasm (see tests/unit/sqlite-worker.test.js).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      /**
       * src/sqlite-worker.js imports the wasm binary URL with:
       *   import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
       * In the browser build webpack turns that into an asset URL.
       * Under Vitest (Node), alias it to a stub module that exports the
       * real file path so the Node build of sqlite-wasm can load it
       * from disk.
       */
      {
        find: '@sqlite.org/sqlite-wasm/sqlite3.wasm',
        replacement: path.resolve(__dirname, 'tests/helpers/sqlite3-wasm-url.js'),
      },
    ],
  },
  test: {
    /**
     * Only run unit tests — never Playwright specs.
     */
    include: ['tests/unit/**/*.test.js'],

    /**
     * Unit tests run in Node. Browser APIs are stubbed per-test
     * (vi.stubGlobal) rather than pulling in a DOM emulation layer.
     */
    environment: 'node',
  },
});
