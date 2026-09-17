/**
 * User theme lookup for the main process.
 *
 * The app picks up an optional user-authored theme from
 * ~/.config/theme.css. The file is plain CSS whose :root variable
 * definitions (colors, fonts, sizes — the same custom properties the
 * bundled styles/dataroom-theme.css defines) override the built-in
 * theme; see src/lib/user-theme.js for how the renderer applies it.
 *
 * A missing ~/.config folder or theme.css file is a normal situation,
 * not an error: the lookup resolves to null and the app keeps its
 * bundled theme without any notice ("exit quietly").
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Absolute path of the user theme stylesheet.
 *
 * @param {string} [homedir] - The user's home directory (defaults to os.homedir())
 * @returns {string} Path of the theme.css file inside ~/.config
 */
export function getUserThemeCssPath(homedir = os.homedir()) {
  return path.join(homedir, '.config', 'theme.css');
}

/**
 * Read the user theme stylesheet, or null when there is none.
 *
 * A missing folder or file (ENOENT) resolves to null silently. Any
 * other read failure (e.g. permission denied) is logged for
 * diagnosability but still resolves to null so an unreadable theme can
 * never keep the app from starting with its bundled theme.
 *
 * @param {object} [deps] - Injectable dependencies for testing.
 * @param {string} [deps.homedir] - The user's home directory.
 * @param {(path: string, encoding: string) => Promise<string>} [deps.readFile] - File reader.
 * @returns {Promise<string|null>} The stylesheet text, or null when absent/unreadable
 */
export async function readUserThemeCss({ homedir = os.homedir(), readFile = fs.readFile } = {}) {
  try {
    return await readFile(getUserThemeCssPath(homedir), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[electron] Could not read ${getUserThemeCssPath(homedir)}:`, error.message);
    }
    return null;
  }
}
