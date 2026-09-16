import { describe, it, expect } from 'vitest';
import {
  windowChromeOptions,
  usesApplicationMenu,
} from '../../electron/window-chrome.js';

describe('windowChromeOptions', () => {
  it('hides the title bar on macOS so the page provides the drag region', () => {
    expect(windowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
    });
  });

  it('keeps native decorations on Linux', () => {
    expect(windowChromeOptions('linux')).toEqual({});
  });

  it('keeps native decorations on Windows', () => {
    expect(windowChromeOptions('win32')).toEqual({});
  });
});

describe('usesApplicationMenu', () => {
  it('is true on macOS, where keyboard shortcuts require the app menu', () => {
    expect(usesApplicationMenu('darwin')).toBe(true);
  });

  it('is false on Linux and Windows so no in-window menu bar reserves client space', () => {
    expect(usesApplicationMenu('linux')).toBe(false);
    expect(usesApplicationMenu('win32')).toBe(false);
  });
});
