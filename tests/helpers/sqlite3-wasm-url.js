/**
 * sqlite3.wasm URL Stub (Vitest only)
 *
 * In the webpack build, `import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'`
 * resolves to the public URL of the emitted asset. Under Vitest, the
 * vitest.config.js alias points that import at this module instead,
 * which exports the absolute filesystem path of the real wasm binary
 * inside node_modules. The Node build of sqlite-wasm (dist/node.mjs)
 * loads the binary from disk via locateFile, so a plain path works.
 */

export default new URL(
  '../../node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm',
  import.meta.url
).pathname;
