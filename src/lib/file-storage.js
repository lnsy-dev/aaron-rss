/**
 * File Storage Library (File System Access API)
 *
 * Thin wrappers around Google Chrome's File System Access API
 * (showSaveFilePicker / showOpenFilePicker). These work in Chrome,
 * Edge, and Electron's Chromium renderer. In other browsers the API
 * is absent — call isFileSystemAccessSupported() first and degrade
 * gracefully.
 *
 * Used for saving/loading articles as Markdown, theme CSS files, and
 * OPML subscription lists.
 *
 * For LLMs: these functions must be called from a user gesture
 * (e.g. a click handler) or the pickers will be rejected.
 *
 * Save helpers accept an optional `options.rememberKey`. When given,
 * the chosen handle is persisted (via src/lib/handle-store.js) and
 * passed back as `startIn` on subsequent saves, so the dialog opens
 * in the same directory as the previous save.
 */

import { rememberHandle, recallHandle } from './handle-store.js';

/**
 * Check whether the File System Access API is available.
 *
 * Uses typeof-based detection: shadowing the globals with `undefined`
 * (as test mocks do) is correctly reported as unsupported.
 *
 * @returns {boolean} True if save/open pickers exist
 */
export function isFileSystemAccessSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showOpenFilePicker === 'function'
  );
}

/**
 * Check whether an error is the user cancelling a picker dialog.
 * Cancellation is normal flow, not a failure.
 *
 * @param {Error} error - The caught error
 * @returns {boolean} True if the user aborted the picker
 */
export function isUserCancellation(error) {
  return !!error && error.name === 'AbortError';
}

/**
 * Save bytes to a file on disk via the native save dialog.
 *
 * @param {string} suggestedName - Default file name in the dialog
 * @param {Uint8Array} bytes - File contents
 * @param {Array<object>} [types] - Optional file type descriptors for the picker
 * @returns {Promise<string>} The name of the saved file
 */
export async function saveBytesToDisk(suggestedName, bytes, types = [
  {
    description: 'SQLite database',
    accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
  },
]) {
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types,
  });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
  return handle.name;
}

/**
 * Save text to a file on disk via the native save dialog.
 *
 * @param {string} suggestedName - Default file name in the dialog
 * @param {string} text - File contents
 * @param {Array<object>} [types] - Optional file type descriptors
 * @param {object} [options] - Extra behaviour
 * @param {string} [options.rememberKey] - Persist and reuse the last
 *   saved location under this key (e.g. 'markdown-export')
 * @returns {Promise<string>} The name of the saved file
 */
export async function saveTextToDisk(
  suggestedName,
  text,
  types = [
    {
      description: 'Markdown file',
      accept: { 'text/markdown': ['.md', '.markdown'] },
    },
  ],
  options = {}
) {
  // Resume where the user last saved for this key. A stale handle can
  // make the picker throw, so fall back to opening without startIn.
  const rememberKey = options.rememberKey;
  let startIn = rememberKey ? await recallHandle(rememberKey) : null;

  const openPicker = async () => {
    const pickerOptions = { suggestedName, types };
    if (startIn) pickerOptions.startIn = startIn;
    return window.showSaveFilePicker(pickerOptions);
  };

  let handle;
  try {
    handle = await openPicker();
  } catch (error) {
    if (!startIn) throw error;
    // The remembered handle was unusable — retry from the default dir.
    startIn = null;
    handle = await openPicker();
  }

  if (rememberKey) {
    await rememberHandle(rememberKey, handle);
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return handle.name;
}

/**
 * Save CSS text to a file on disk via the native save dialog.
 *
 * @param {string} suggestedName - Default file name in the dialog
 * @param {string} css - CSS contents
 * @returns {Promise<string>} The name of the saved file
 */
export async function saveCSSToDisk(suggestedName, css) {
  return saveTextToDisk(suggestedName, css, [
    {
      description: 'CSS theme file',
      accept: { 'text/css': ['.css'] },
    },
  ]);
}

/**
 * Open a text file from disk via the native open dialog.
 *
 * @param {Array<object>} [types] - Optional file type descriptors
 * @returns {Promise<{name: string, text: string}>} File name and contents
 */
export async function pickTextFileFromDisk(
  types = [
    {
      description: 'Text file',
      accept: { 'text/plain': ['.txt'] },
    },
  ]
) {
  const [handle] = await window.showOpenFilePicker({
    types,
    multiple: false,
  });
  const file = await handle.getFile();
  const text = await file.text();
  return { name: file.name, text };
}

/**
 * Open a CSS file from disk via the native open dialog.
 *
 * @returns {Promise<{name: string, text: string}>} File name and CSS contents
 */
export async function pickCSSTextFileFromDisk() {
  return pickTextFileFromDisk([
    {
      description: 'CSS theme file',
      accept: { 'text/css': ['.css'] },
    },
  ]);
}

/**
 * Open a file from disk via the native open dialog.
 *
 * @returns {Promise<{name: string, bytes: Uint8Array}>} File name and contents
 */
export async function pickFileFromDisk() {
  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: 'SQLite database',
        accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
      },
    ],
    multiple: false,
  });
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, bytes };
}

/**
 * Save an OPML subscription list to a file on disk via the native save dialog.
 *
 * @param {string} suggestedName - Default file name in the dialog
 * @param {string} opml - OPML XML contents
 * @returns {Promise<string>} The name of the saved file
 */
export async function saveOPMLToDisk(suggestedName, opml) {
  return saveTextToDisk(suggestedName, opml, [
    {
      description: 'OPML subscription list',
      accept: { 'text/x-opml': ['.opml'] },
    },
  ]);
}

/**
 * Open an OPML file from disk via the native open dialog.
 *
 * @returns {Promise<{name: string, text: string}>} File name and OPML contents
 */
export async function pickOPMLFileFromDisk() {
  return pickTextFileFromDisk([
    {
      description: 'OPML subscription list',
      accept: { 'text/x-opml': ['.opml'] },
    },
  ]);
}
