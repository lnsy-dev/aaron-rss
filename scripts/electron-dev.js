#!/usr/bin/env node
/**
 * Electron development launcher.
 *
 * Runs a full production build, starts the webpack dev server (unless one
 * is already running), waits for it to answer, then launches Electron
 * pointed at the dev server URL. electron/main.js detects the dev server
 * via the `X-Aaron-RSS: dev-server` header and loads it with hot reload,
 * so editing any src/ file live-updates the running app.
 *
 * Process lifecycle:
 *   - When Electron exits, the dev server (if we started it) is killed.
 *   - Ctrl+C / SIGTERM tears down both child processes.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import 'dotenv/config';

/** URL where the webpack dev server is expected. */
const DEV_URL = process.env.ELECTRON_DEV_URL
  || `http://localhost:${process.env.PORT || 3456}`;

/** How long to wait for the dev server to come up before giving up. */
const SERVER_TIMEOUT_MS = Number(process.env.DEV_SERVER_TIMEOUT_MS || 90_000);

/** Interval between readiness probes. */
const POLL_INTERVAL_MS = 250;

/**
 * Spawn a command, resolving when it exits successfully.
 *
 * @param {string} command - Executable to run
 * @param {string[]} args - Command arguments
 * @param {object} [options]
 * @param {object} [options.env] - Extra environment variables
 * @param {boolean} [options.stdio='inherit'] - stdio config for the child
 * @returns {Promise<{code: number, child: import('node:child_process').ChildProcess}>}
 */
function run(command, args, { env = {}, stdio = 'inherit' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio,
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ code, child });
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

/**
 * Probe whether this project's webpack dev server is answering.
 *
 * Only accepts a server carrying the `X-Aaron-RSS: dev-server` header so
 * an unrelated HTTP server on the same port is not mistaken for ours.
 *
 * @param {string} url - URL to probe
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<boolean>} True when our dev server is up
 */
export async function isDevServerUp(url, { fetchImpl = fetch } = {}) {
  try {
    const response = await Promise.race([
      fetchImpl(url, { method: 'HEAD' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    return response.headers.get('X-Aaron-RSS') === 'dev-server';
  } catch {
    return false;
  }
}

/**
 * Poll the dev server URL until it answers or the timeout elapses.
 *
 * @param {string} url - URL to poll
 * @param {{timeoutMs?: number, intervalMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<void>} Resolves when the server is up
 * @throws {Error} If the server does not answer within the timeout
 */
export async function waitForServer(url, { timeoutMs = SERVER_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDevServerUp(url, { fetchImpl })) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Dev server at ${url} did not start within ${timeoutMs / 1000}s`);
}

const WEBPACK = 'npx';
const ELECTRON = 'npx';

/**
 * Entry point: build, ensure dev server, launch Electron.
 */
async function main() {
  // 1. Production build so dist/ is always fresh (used as the fallback
  //    target if the dev server is later closed, and keeps builds warm).
  console.log('[electron-dev] Building production bundle...');
  await run('npm', ['run', 'build']);

  // 2. Start the dev server unless one of ours is already listening
  //    (e.g. the user left `npm start` running in another terminal).
  let devServer = null;
  if (await isDevServerUp(DEV_URL)) {
    console.log(`[electron-dev] Reusing existing dev server at ${DEV_URL}`);
  } else {
    console.log('[electron-dev] Starting webpack dev server...');
    devServer = spawn(WEBPACK, ['webpack', 'serve'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }

  // 3. Wait until the dev server actually answers so Electron's single
  //    startup probe (resolveStartUrl in electron/main.js) sees it.
  try {
    await waitForServer(DEV_URL);
  } catch (error) {
    console.error(`[electron-dev] ${error.message}`);
    devServer?.kill('SIGTERM');
    process.exit(1);
  }

  // 4. Launch Electron. electron/main.js picks up ELECTRON_DEV_URL and
  //    loads the dev server with hot reload.
  try {
    console.log(`[electron-dev] Launching Electron against ${DEV_URL} (live reload enabled)`);
    const { child: electron } = await run(ELECTRON, ['electron', '.'], {
      env: { ELECTRON_DEV_URL: DEV_URL },
    });
    process.exitCode = electron.exitCode ?? 0;
  } finally {
    // 5. When Electron quits (or anything above fails), shut the dev
    //    server down with it so no orphaned webpack process is left.
    if (devServer) {
      devServer.kill('SIGTERM');
    }
  }
}

// Tear everything down on Ctrl+C or SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(1));
}

// Only run the launcher when executed directly (not when imported by
// the unit tests, which exercise the exported helpers).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`[electron-dev] ${error.message}`);
    process.exit(1);
  });
}
