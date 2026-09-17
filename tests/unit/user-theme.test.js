/**
 * User Theme Unit Tests
 *
 * Tests the ~/.config/theme.css lookup end to end at the unit level:
 * electron/user-theme.js resolves the path and reads the file quietly
 * (null on a missing folder/file, never a throw), and
 * src/lib/user-theme.js injects the stylesheet as the document's last
 * <style> element — or does nothing when there is no Electron bridge,
 * no theme file, or an empty stylesheet.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { getUserThemeCssPath, readUserThemeCss } from '../../electron/user-theme.js';
import {
  USER_THEME_STYLE_ID,
  applyUserTheme,
  initUserTheme,
} from '../../src/lib/user-theme.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Build a fake document recording created elements and head appends.
 *
 * @returns {object} Minimal document double for applyUserTheme
 */
function makeFakeDocument() {
  const byId = new Map();
  return {
    headChildren: [],
    head: {
      appendChild(element) {
        this.owner.headChildren.push(element);
        if (element.id) {
          byId.set(element.id, element);
        }
      },
      owner: null,
    },
    getElementById(id) {
      return byId.get(id) || null;
    },
    createElement(tag) {
      return { tagName: tag, id: '', textContent: '' };
    },
  };
}

describe('getUserThemeCssPath', () => {
  it('joins the home directory with .config/theme.css', () => {
    expect(getUserThemeCssPath('/home/aaron')).toBe('/home/aaron/.config/theme.css');
  });
});

describe('readUserThemeCss', () => {
  it('returns the stylesheet text when theme.css exists', async () => {
    const css = ':root { --background: #e7e3d6; }';
    const readFile = vi.fn().mockResolvedValue(css);

    await expect(
      readUserThemeCss({ homedir: '/home/aaron', readFile }),
    ).resolves.toBe(css);
    expect(readFile).toHaveBeenCalledWith('/home/aaron/.config/theme.css', 'utf8');
  });

  it('resolves to null quietly when theme.css does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readFile = vi.fn().mockRejectedValue(
      Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }),
    );

    await expect(
      readUserThemeCss({ homedir: '/home/aaron', readFile }),
    ).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves to null quietly when the .config folder does not exist', async () => {
    // A missing folder surfaces as ENOENT on the joined file path too.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readFile = vi.fn().mockRejectedValue(
      Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }),
    );

    await expect(
      readUserThemeCss({ homedir: '/home/aaron', readFile }),
    ).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves to null and warns when the file cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readFile = vi.fn().mockRejectedValue(
      Object.assign(new Error("permission denied, open '...'"), { code: 'EACCES' }),
    );

    await expect(
      readUserThemeCss({ homedir: '/home/aaron', readFile }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('applyUserTheme', () => {
  it('appends a user theme style element to the head', () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;

    const style = applyUserTheme(':root { --accent: #8e5345; }', doc);

    expect(style).not.toBeNull();
    expect(style.id).toBe(USER_THEME_STYLE_ID);
    expect(style.textContent).toBe(':root { --accent: #8e5345; }');
    expect(doc.headChildren).toEqual([style]);
  });

  it('reuses the existing style element on a second application', () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;

    applyUserTheme(':root { --accent: #8e5345; }', doc);
    const second = applyUserTheme(':root { --accent: #458e45; }', doc);

    expect(doc.headChildren).toHaveLength(1);
    expect(doc.headChildren[0].textContent).toBe(':root { --accent: #458e45; }');
    expect(second).toBe(doc.headChildren[0]);
  });

  it('ignores empty stylesheets', () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;

    expect(applyUserTheme('', doc)).toBeNull();
    expect(applyUserTheme('   \n  ', doc)).toBeNull();
    expect(doc.headChildren).toEqual([]);
  });

  it('returns null when there is no head to append to', () => {
    expect(applyUserTheme(':root {}', { getElementById: () => null })).toBeNull();
  });
});

describe('initUserTheme', () => {
  it('does nothing when there is no Electron bridge (plain web)', async () => {
    await expect(initUserTheme(undefined)).resolves.toBeNull();
  });

  it('does nothing when the bridge cannot serve themes', async () => {
    await expect(initUserTheme({})).resolves.toBeNull();
  });

  it('applies the theme served by the bridge', async () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;
    vi.stubGlobal('document', doc);

    const bridge = {
      getUserThemeCss: vi.fn().mockResolvedValue(':root { --background: #e7e3d6; }'),
    };

    const style = await initUserTheme(bridge);

    expect(bridge.getUserThemeCss).toHaveBeenCalledTimes(1);
    expect(style).not.toBeNull();
    expect(style.id).toBe(USER_THEME_STYLE_ID);
    expect(style.textContent).toBe(':root { --background: #e7e3d6; }');
  });

  it('falls back to window.electron when no bridge is passed', async () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', {
      electron: {
        getUserThemeCss: vi.fn().mockResolvedValue(':root { --muted: #6b6759; }'),
      },
    });

    const style = await initUserTheme();

    expect(style).not.toBeNull();
    expect(style.textContent).toBe(':root { --muted: #6b6759; }');
  });

  it('applies nothing when no theme.css exists on disk', async () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;
    vi.stubGlobal('document', doc);

    const bridge = { getUserThemeCss: vi.fn().mockResolvedValue(null) };

    await expect(initUserTheme(bridge)).resolves.toBeNull();
    expect(doc.headChildren).toEqual([]);
  });

  it('applies nothing for an empty theme.css', async () => {
    const doc = makeFakeDocument();
    doc.head.owner = doc;
    vi.stubGlobal('document', doc);

    const bridge = { getUserThemeCss: vi.fn().mockResolvedValue('  \n ') };

    await expect(initUserTheme(bridge)).resolves.toBeNull();
    expect(doc.headChildren).toEqual([]);
  });
});
