/**
 * File Storage Unit Tests
 *
 * Unit tests for src/lib/file-storage.js — the File System Access API
 * wrappers used for database export/import.
 *
 * The picker APIs (window.showSaveFilePicker / window.showOpenFilePicker)
 * are stubbed per-test with fake handles, so these tests pin down how
 * our code drives the dialogs without needing a browser.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  isFileSystemAccessSupported,
  isUserCancellation,
  saveBytesToDisk,
  saveTextToDisk,
  saveCSSToDisk,
  saveOPMLToDisk,
  pickFileFromDisk,
  pickTextFileFromDisk,
  pickCSSTextFileFromDisk,
  pickOPMLFileFromDisk,
} from '../../src/lib/file-storage.js';

// Controllable in-memory stand-in for the IndexedDB handle store so we
// can pin how saveTextToDisk remembers and reuses last-save locations.
const fakeHandleStore = { stored: new Map() };
vi.mock('../../src/lib/handle-store.js', () => ({
  rememberHandle: async (key, handle) => {
    fakeHandleStore.stored.set(key, handle);
  },
  recallHandle: async (key) => fakeHandleStore.stored.get(key) ?? null,
}));

describe('file-storage', () => {
  beforeEach(() => {
    fakeHandleStore.stored.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isFileSystemAccessSupported', () => {
    it('returns false when no window exists (Node)', () => {
      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('returns false when the pickers are missing', () => {
      vi.stubGlobal('window', {});
      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('returns false when the pickers are shadowed with undefined', () => {
      vi.stubGlobal('window', {
        showSaveFilePicker: undefined,
        showOpenFilePicker: undefined,
      });
      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('returns true when both pickers are functions', () => {
      vi.stubGlobal('window', {
        showSaveFilePicker() {},
        showOpenFilePicker() {},
      });
      expect(isFileSystemAccessSupported()).toBe(true);
    });
  });

  describe('isUserCancellation', () => {
    it('recognizes AbortError as a user cancellation', () => {
      const error = new DOMException('The user aborted a request.', 'AbortError');
      expect(isUserCancellation(error)).toBe(true);
    });

    it('does not treat other errors as cancellations', () => {
      expect(isUserCancellation(new Error('disk full'))).toBe(false);
      expect(isUserCancellation(new DOMException('nope', 'NotAllowedError'))).toBe(false);
    });

    it('handles null and undefined', () => {
      expect(isUserCancellation(null)).toBe(false);
      expect(isUserCancellation(undefined)).toBe(false);
    });
  });

  describe('saveBytesToDisk', () => {
    it('opens the save dialog with the suggested name and sqlite types', async () => {
      let pickerOptions = null;
      const written = [];
      let closed = false;

      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({
              write: async (data) => { written.push(data); },
              close: async () => { closed = true; },
            }),
          };
        },
      });

      const bytes = new Uint8Array([1, 2, 3, 4]);
      const name = await saveBytesToDisk('app.sqlite3', bytes);

      expect(pickerOptions.suggestedName).toBe('app.sqlite3');
      expect(pickerOptions.types).toEqual([
        {
          description: 'SQLite database',
          accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
        },
      ]);
      expect(written).toEqual([bytes]);
      expect(closed).toBe(true);
      expect(name).toBe('app.sqlite3');
    });

    it('propagates picker rejection (e.g. user cancellation) to the caller', async () => {
      const abort = new DOMException('The user aborted a request.', 'AbortError');
      vi.stubGlobal('window', {
        showSaveFilePicker: async () => { throw abort; },
      });

      await expect(saveBytesToDisk('app.sqlite3', new Uint8Array())).rejects.toBe(abort);
    });
  });

  describe('pickFileFromDisk', () => {
    it('returns the picked file name and bytes', async () => {
      const contents = new Uint8Array([5, 6, 7, 8]);
      let pickerOptions = null;

      vi.stubGlobal('window', {
        showOpenFilePicker: async (options) => {
          pickerOptions = options;
          return [{
            getFile: async () => ({
              name: 'backup.sqlite3',
              arrayBuffer: async () => contents.buffer,
            }),
          }];
        },
      });

      const { name, bytes } = await pickFileFromDisk();

      expect(pickerOptions.multiple).toBe(false);
      expect(pickerOptions.types).toEqual([
        {
          description: 'SQLite database',
          accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
        },
      ]);
      expect(name).toBe('backup.sqlite3');
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([5, 6, 7, 8]);
    });

    it('propagates picker rejection (e.g. user cancellation) to the caller', async () => {
      const abort = new DOMException('The user aborted a request.', 'AbortError');
      vi.stubGlobal('window', {
        showOpenFilePicker: async () => { throw abort; },
      });

      await expect(pickFileFromDisk()).rejects.toBe(abort);
    });
  });

  describe('saveTextToDisk', () => {
    it('opens the save dialog for Markdown files by default', async () => {
      let pickerOptions = null;
      const written = [];

      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({
              write: async (data) => { written.push(data); },
              close: async () => {},
            }),
          };
        },
      });

      const name = await saveTextToDisk('article.md', '# Hello');

      expect(name).toBe('article.md');
      expect(pickerOptions.suggestedName).toBe('article.md');
      expect(pickerOptions.types).toEqual([
        {
          description: 'Markdown file',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        },
      ]);
      expect(written).toEqual(['# Hello']);
    });

    it('allows custom file types', async () => {
      let pickerOptions = null;

      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({
              write: async () => {},
              close: async () => {},
            }),
          };
        },
      });

      const types = [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }];
      await saveTextToDisk('article.txt', 'content', types);

      expect(pickerOptions.types).toBe(types);
    });

    it('passes the remembered handle as startIn when rememberKey is given', async () => {
      const previousHandle = { kind: 'file', name: 'old.md' };
      fakeHandleStore.stored.set('markdown-export', previousHandle);

      let pickerOptions = null;
      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({ write: async () => {}, close: async () => {} }),
          };
        },
      });

      await saveTextToDisk('article.md', '# Hello', undefined, {
        rememberKey: 'markdown-export',
      });

      // Chromium opens the dialog in the parent directory of a file handle.
      expect(pickerOptions.startIn).toBe(previousHandle);
    });

    it('remembers the newly saved handle under the rememberKey', async () => {
      let savedHandle;
      vi.stubGlobal('window', {
        showSaveFilePicker: async () => {
          savedHandle = {
            name: 'article.md',
            createWritable: async () => ({ write: async () => {}, close: async () => {} }),
          };
          return savedHandle;
        },
      });

      await saveTextToDisk('article.md', '# Hello', undefined, {
        rememberKey: 'markdown-export',
      });

      expect(fakeHandleStore.stored.get('markdown-export')).toBe(savedHandle);
    });

    it('retries without startIn when the remembered handle is unusable', async () => {
      fakeHandleStore.stored.set('markdown-export', { kind: 'file', name: 'gone.md' });

      const attempts = [];
      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          attempts.push(options.startIn ?? null);
          if (options.startIn) {
            throw new DOMException('Permission denied.', 'SecurityError');
          }
          return {
            name: 'article.md',
            createWritable: async () => ({ write: async () => {}, close: async () => {} }),
          };
        },
      });

      await expect(
        saveTextToDisk('article.md', '# Hello', undefined, { rememberKey: 'markdown-export' })
      ).resolves.toBe('article.md');

      // First attempt used the stale handle, second fell back to none.
      expect(attempts).toEqual([{ kind: 'file', name: 'gone.md' }, null]);
    });

    it('does not touch the handle store without a rememberKey', async () => {
      let sawStartIn = false;
      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          sawStartIn = 'startIn' in options;
          return {
            name: 'theme.css',
            createWritable: async () => ({ write: async () => {}, close: async () => {} }),
          };
        },
      });

      await saveCSSToDisk('theme.css', ':root { --x: 1; }');

      expect(sawStartIn).toBe(false);
      expect(fakeHandleStore.stored.size).toBe(0);
    });
  });

  describe('saveCSSToDisk', () => {
    it('opens the save dialog with CSS file types', async () => {
      let pickerOptions = null;
      const written = [];

      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({
              write: async (data) => { written.push(data); },
              close: async () => {},
            }),
          };
        },
      });

      const name = await saveCSSToDisk('theme.css', ':root { --x: 1; }');

      expect(name).toBe('theme.css');
      expect(pickerOptions.suggestedName).toBe('theme.css');
      expect(pickerOptions.types).toEqual([
        {
          description: 'CSS theme file',
          accept: { 'text/css': ['.css'] },
        },
      ]);
      expect(written).toEqual([':root { --x: 1; }']);
    });
  });

  describe('pickTextFileFromDisk', () => {
    it('returns the picked text file name and contents', async () => {
      let pickerOptions = null;

      vi.stubGlobal('window', {
        showOpenFilePicker: async (options) => {
          pickerOptions = options;
          return [{
            getFile: async () => ({
              name: 'notes.txt',
              text: async () => 'hello world',
            }),
          }];
        },
      });

      const { name, text } = await pickTextFileFromDisk();

      expect(pickerOptions.multiple).toBe(false);
      expect(pickerOptions.types).toEqual([
        {
          description: 'Text file',
          accept: { 'text/plain': ['.txt'] },
        },
      ]);
      expect(name).toBe('notes.txt');
      expect(text).toBe('hello world');
    });

    it('allows custom file types', async () => {
      let pickerOptions = null;
      const types = [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }];

      vi.stubGlobal('window', {
        showOpenFilePicker: async (options) => {
          pickerOptions = options;
          return [{
            getFile: async () => ({
              name: 'data.json',
              text: async () => '{}',
            }),
          }];
        },
      });

      await pickTextFileFromDisk(types);

      expect(pickerOptions.types).toBe(types);
    });
  });

  describe('pickCSSTextFileFromDisk', () => {
    it('returns the picked CSS file name and contents', async () => {
      let pickerOptions = null;

      vi.stubGlobal('window', {
        showOpenFilePicker: async (options) => {
          pickerOptions = options;
          return [{
            getFile: async () => ({
              name: 'theme.css',
              text: async () => ':root { --y: 2; }',
            }),
          }];
        },
      });

      const { name, text } = await pickCSSTextFileFromDisk();

      expect(pickerOptions.multiple).toBe(false);
      expect(pickerOptions.types).toEqual([
        {
          description: 'CSS theme file',
          accept: { 'text/css': ['.css'] },
        },
      ]);
      expect(name).toBe('theme.css');
      expect(text).toBe(':root { --y: 2; }');
    });
  });

  describe('saveOPMLToDisk', () => {
    it('opens the save dialog with OPML file types', async () => {
      let pickerOptions = null;
      const written = [];

      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({
              write: async (data) => { written.push(data); },
              close: async () => {},
            }),
          };
        },
      });

      const name = await saveOPMLToDisk('subscriptions.opml', '<opml/>');

      expect(name).toBe('subscriptions.opml');
      expect(pickerOptions.suggestedName).toBe('subscriptions.opml');
      expect(pickerOptions.types).toEqual([
        {
          description: 'OPML subscription list',
          accept: { 'text/x-opml': ['.opml'] },
        },
      ]);
      expect(written).toEqual(['<opml/>']);
    });
  });

  describe('pickOPMLFileFromDisk', () => {
    it('returns the picked OPML file name and contents', async () => {
      let pickerOptions = null;

      vi.stubGlobal('window', {
        showOpenFilePicker: async (options) => {
          pickerOptions = options;
          return [{
            getFile: async () => ({
              name: 'subscriptions.opml',
              text: async () => '<opml><body/></opml>',
            }),
          }];
        },
      });

      const { name, text } = await pickOPMLFileFromDisk();

      expect(pickerOptions.multiple).toBe(false);
      expect(pickerOptions.types).toEqual([
        {
          description: 'OPML subscription list',
          accept: { 'text/x-opml': ['.opml'] },
        },
      ]);
      expect(name).toBe('subscriptions.opml');
      expect(text).toBe('<opml><body/></opml>');
    });
  });
});
