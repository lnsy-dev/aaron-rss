/**
 * Unit tests for the Quick Keys reference library (src/lib/quick-keys.js).
 *
 * The library is framework-free so its data, formatting, and shortcut
 * matching logic are tested directly without a DOM or worker mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  detectKeyboardPlatform,
  formatKeyCombo,
  getQuickKeyGroups,
  isQuickKeysEvent,
} from '../../src/lib/quick-keys.js';

describe('detectKeyboardPlatform', () => {
  it('detects macOS from navigator.platform', () => {
    expect(detectKeyboardPlatform({ platform: 'MacIntel' })).toBe('mac');
  });

  it('detects Apple devices as mac', () => {
    expect(detectKeyboardPlatform({ platform: 'iPhone' })).toBe('mac');
    expect(detectKeyboardPlatform({ platform: 'iPad' })).toBe('mac');
  });

  it('detects Windows as pc', () => {
    expect(detectKeyboardPlatform({ platform: 'Win32' })).toBe('pc');
  });

  it('detects Linux as pc', () => {
    expect(detectKeyboardPlatform({ platform: 'Linux x86_64' })).toBe('pc');
  });

  it('falls back to the user agent when platform is empty', () => {
    expect(detectKeyboardPlatform({ platform: '', userAgent: 'Macintosh; Intel Mac OS X' })).toBe('mac');
    expect(detectKeyboardPlatform({ platform: '', userAgent: 'Windows NT 10.0' })).toBe('pc');
  });

  it('defaults to pc when nothing is recognizable', () => {
    expect(detectKeyboardPlatform({ platform: '', userAgent: '' })).toBe('pc');
  });
});

describe('formatKeyCombo', () => {
  it('renders the command key as Cmd symbol on mac', () => {
    expect(formatKeyCombo('Mod+F', 'mac')).toEqual(['⌘', 'F']);
  });

  it('renders the command key as Ctrl on pc', () => {
    expect(formatKeyCombo('Mod+F', 'pc')).toEqual(['Ctrl', 'F']);
  });

  it('renders modifiers per platform', () => {
    expect(formatKeyCombo('Shift+ArrowDown', 'mac')).toEqual(['⇧', '↓']);
    expect(formatKeyCombo('Shift+ArrowDown', 'pc')).toEqual(['Shift', '↓']);
    expect(formatKeyCombo('Alt+X', 'mac')).toEqual(['⌥', 'X']);
    expect(formatKeyCombo('Alt+X', 'pc')).toEqual(['Alt', 'X']);
  });

  it('renders named keys per platform', () => {
    expect(formatKeyCombo('Enter', 'mac')).toEqual(['↩']);
    expect(formatKeyCombo('Enter', 'pc')).toEqual(['Enter']);
    expect(formatKeyCombo('Escape', 'mac')).toEqual(['esc']);
    expect(formatKeyCombo('Escape', 'pc')).toEqual(['Esc']);
    expect(formatKeyCombo('ArrowUp', 'pc')).toEqual(['↑']);
  });

  it('passes single characters through uppercased', () => {
    expect(formatKeyCombo('m', 'mac')).toEqual(['M']);
    expect(formatKeyCombo('?', 'pc')).toEqual(['?']);
  });

  it('formats the quick keys shortcut itself', () => {
    expect(formatKeyCombo('Mod+?', 'mac')).toEqual(['⌘', '?']);
    expect(formatKeyCombo('Mod+?', 'pc')).toEqual(['Ctrl', '?']);
  });
});

describe('getQuickKeyGroups', () => {
  const groups = getQuickKeyGroups('mac');

  it('returns at least one group with a title and items', () => {
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(typeof group.title).toBe('string');
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('formats every item into key-cap labels', () => {
    for (const group of groups) {
      for (const item of group.items) {
        expect(Array.isArray(item.labels)).toBe(true);
        expect(item.labels.length).toBeGreaterThan(0);
        for (const label of item.labels) {
          // No canonical token should ever leak through unformatted.
          expect(label).not.toBe('Mod');
          expect(label).not.toBe('ArrowDown');
        }
      }
    }
  });

  it('documents every item with a description', () => {
    for (const group of groups) {
      for (const item of group.items) {
        expect(typeof item.description).toBe('string');
        expect(item.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('includes the quick keys shortcut itself', () => {
    const combos = groups.flatMap((group) => group.items.map((item) => item.combo));
    expect(combos).toContain('Mod+?');
  });

  it('includes the navigation, find, and command panel shortcuts', () => {
    const combos = groups.flatMap((group) => group.items.map((item) => item.combo));
    expect(combos).toContain('ArrowDown');
    expect(combos).toContain('Mod+F');
    expect(combos).toContain('Mod+P');
    expect(combos).toContain('Escape');
  });
});

describe('isQuickKeysEvent', () => {
  it('matches Cmd+? (macOS)', () => {
    expect(isQuickKeysEvent({ key: '?', metaKey: true })).toBe(true);
  });

  it('matches Ctrl+? (Windows/Linux)', () => {
    expect(isQuickKeysEvent({ key: '?', ctrlKey: true })).toBe(true);
  });

  it('matches with Shift held (how ? is produced on most layouts)', () => {
    expect(isQuickKeysEvent({ key: '?', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isQuickKeysEvent({ key: '?', metaKey: true, shiftKey: true })).toBe(true);
  });

  it('rejects plain ? without modifiers', () => {
    expect(isQuickKeysEvent({ key: '?' })).toBe(false);
  });

  it('rejects command/ctrl with a different key', () => {
    expect(isQuickKeysEvent({ key: '/', ctrlKey: true })).toBe(false);
    expect(isQuickKeysEvent({ key: 'f', metaKey: true })).toBe(false);
  });

  it('rejects shift-only ?', () => {
    expect(isQuickKeysEvent({ key: '?', shiftKey: true })).toBe(false);
  });

  it('rejects Alt+? (a different shortcut on many layouts)', () => {
    expect(isQuickKeysEvent({ key: '?', ctrlKey: true, altKey: true })).toBe(false);
    expect(isQuickKeysEvent({ key: '?', metaKey: true, altKey: true })).toBe(false);
  });

  it('matches the physical Shift+/ shape reported by automation environments', () => {
    expect(
      isQuickKeysEvent({ key: '/', code: 'Slash', metaKey: true, shiftKey: true })
    ).toBe(true);
    expect(
      isQuickKeysEvent({ key: '/', code: 'Slash', ctrlKey: true, shiftKey: true })
    ).toBe(true);
  });

  it('rejects unshifted physical / and / without command modifiers', () => {
    expect(isQuickKeysEvent({ key: '/', code: 'Slash', metaKey: true })).toBe(false);
    expect(isQuickKeysEvent({ key: '/', code: 'Slash', shiftKey: true })).toBe(false);
  });
});
