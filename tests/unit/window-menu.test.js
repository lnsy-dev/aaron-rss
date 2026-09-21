/**
 * Window Menu Unit Tests
 *
 * Tests electron/window-menu.js — the macOS Window menu template that
 * adds the "Float on Top" checkbox on top of the standard windowMenu
 * role items.
 */

import { describe, it, expect } from 'vitest';

import { buildWindowMenu } from '../../electron/window-menu.js';

describe('buildWindowMenu', () => {
  it('labels the menu "Window" with a submenu', () => {
    const menu = buildWindowMenu({ floatOnTop: false, onToggleFloatOnTop: () => {} });
    expect(menu.label).toBe('Window');
    expect(Array.isArray(menu.submenu)).toBe(true);
  });

  it('carries the Float on Top checkbox reflecting the current state', () => {
    const off = buildWindowMenu({ floatOnTop: false, onToggleFloatOnTop: () => {} });
    expect(off.submenu[0]).toMatchObject({
      id: 'float-on-top',
      label: 'Float on Top',
      type: 'checkbox',
      checked: false,
    });

    const on = buildWindowMenu({ floatOnTop: true, onToggleFloatOnTop: () => {} });
    expect(on.submenu[0].checked).toBe(true);
  });

  it("forwards the checkbox's toggled state to the click handler", () => {
    const received = [];
    const menu = buildWindowMenu({
      floatOnTop: false,
      onToggleFloatOnTop: (enabled) => received.push(enabled),
    });
    const checkbox = menu.submenu[0];

    // Electron flips a checkbox's state before running its click
    // handler, so the handler receives an object whose checked value is
    // the state the user asked for.
    checkbox.click({ checked: true });
    checkbox.click({ checked: false });

    expect(received).toEqual([true, false]);
  });

  it('keeps the standard windowMenu role items after the checkbox', () => {
    const menu = buildWindowMenu({ floatOnTop: false, onToggleFloatOnTop: () => {} });

    expect(menu.submenu[1]).toEqual({ type: 'separator' });
    expect(menu.submenu[2].role).toBe('minimize');
    expect(menu.submenu[3].role).toBe('zoom');
    expect(menu.submenu[4]).toEqual({ type: 'separator' });
    expect(menu.submenu[5].role).toBe('front');
  });
});
