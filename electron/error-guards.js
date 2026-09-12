/**
 * Main-Process Crash Guards
 *
 * Node (and therefore the Electron main process) turns an uncaught
 * exception — including an unhandled promise rejection — into a fatal
 * error, and Electron surfaces it as the modal "Uncaught Exception"
 * dialog. This app's main process performs background network work
 * whose failures are transient and recoverable: the ad blocker and
 * yt-dlp binaries download over TLS on startup (read ETIMEDOUT is a
 * routine flake on flaky wifi), and feed/image fetches proxy through
 * undici keep-alive sockets that can surface errors outside any single
 * try/catch. None of that corrupts application state (the renderer and
 * its OPFS database are separate), so the right response is to log and
 * keep running rather than kill the app with a dialog.
 *
 * This module must only run in the Electron main process. It has no
 * electron imports so it stays unit-testable in plain Node.
 */

/**
 * The handlers installed by the most recent install call, so repeat
 * calls replace them instead of stacking duplicates. Third-party
 * listeners are never touched.
 *
 * @type {{onUnhandledRejection: Function, onUncaughtException: Function}|null}
 */
let installed = null;

/**
 * Default logger for the guards.
 *
 * @param {string} kind - Which guard fired ('uncaughtException' | 'unhandledRejection')
 * @param {unknown} error - The error or rejection reason
 * @returns {void}
 */
function defaultLog(kind, error) {
  const detail = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(`[electron] Suppressed ${kind} (app keeps running):`, detail);
}

/**
 * Install uncaughtException / unhandledRejection handlers.
 *
 * Installing a handler for either event prevents Electron's default
 * fatal-crash dialog for that event. Repeat calls replace the handlers
 * installed by the previous call (and only those).
 *
 * @param {object} [options]
 * @param {Function} [options.log=defaultLog] - Called as log(kind, error)
 *   whenever the process would otherwise crash.
 * @returns {boolean} true when the handlers were installed by this call
 */
export function installProcessErrorGuards({ log = defaultLog } = {}) {
  if (installed) {
    process.removeListener('unhandledRejection', installed.onUnhandledRejection);
    process.removeListener('uncaughtException', installed.onUncaughtException);
  }

  const onUnhandledRejection = (reason) => {
    log('unhandledRejection', reason);
  };
  const onUncaughtException = (error) => {
    log('uncaughtException', error);
  };

  installed = { onUnhandledRejection, onUncaughtException };
  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);
  return true;
}
