/**
 * Unit tests for the article font size library (src/lib/article-font.js).
 *
 * The library is framework-free so shortcut detection, clamping, and
 * settings parsing are tested directly without a DOM or worker mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  ARTICLE_FONT_MIN_STEP,
  ARTICLE_FONT_MAX_STEP,
  ARTICLE_FONT_DEFAULT_STEP,
  articleFontStepAttrValue,
  clampArticleFontStep,
  getArticleFontAction,
  parseArticleFontStep,
} from '../../src/lib/article-font.js';

describe('constants', () => {
  it('uses -3..5 with 0 as default', () => {
    expect(ARTICLE_FONT_MIN_STEP).toBe(-3);
    expect(ARTICLE_FONT_MAX_STEP).toBe(5);
    expect(ARTICLE_FONT_DEFAULT_STEP).toBe(0);
  });
});

describe('articleFontStepAttrValue', () => {
  it('maps positive steps without a sign', () => {
    expect(articleFontStepAttrValue(2)).toBe('step2');
  });

  it('maps zero to step0', () => {
    expect(articleFontStepAttrValue(0)).toBe('step0');
  });

  it('maps negative steps with a sign', () => {
    expect(articleFontStepAttrValue(-3)).toBe('step-3');
  });
});

describe('clampArticleFontStep', () => {
  it('passes values inside the range through', () => {
    expect(clampArticleFontStep(-3)).toBe(-3);
    expect(clampArticleFontStep(0)).toBe(0);
    expect(clampArticleFontStep(5)).toBe(5);
  });

  it('clamps out-of-range values', () => {
    expect(clampArticleFontStep(6)).toBe(5);
    expect(clampArticleFontStep(100)).toBe(5);
    expect(clampArticleFontStep(-4)).toBe(-3);
  });

  it('rounds fractional input', () => {
    expect(clampArticleFontStep(1.4)).toBe(1);
    expect(clampArticleFontStep(1.6)).toBe(2);
  });

  it('falls back to the default for non-finite input, clamping infinities', () => {
    expect(clampArticleFontStep(NaN)).toBe(0);
    expect(clampArticleFontStep(Infinity)).toBe(5);
    expect(clampArticleFontStep(-Infinity)).toBe(-3);
  });
});

describe('getArticleFontAction', () => {
  const mod = { metaKey: true, ctrlKey: false };
  const ctrl = { metaKey: false, ctrlKey: true };

  it('treats Cmd/Ctrl+= and Cmd/Ctrl++ as increase', () => {
    expect(getArticleFontAction({ ...mod, key: '=' })).toBe('increase');
    expect(getArticleFontAction({ ...mod, key: '+', shiftKey: true })).toBe('increase');
    expect(getArticleFontAction({ ...ctrl, key: '=' })).toBe('increase');
  });

  it('treats Cmd/Ctrl+- as decrease', () => {
    expect(getArticleFontAction({ ...mod, key: '-' })).toBe('decrease');
    expect(getArticleFontAction({ ...ctrl, key: '-' })).toBe('decrease');
  });

  it('treats Cmd/Ctrl+0 as reset', () => {
    expect(getArticleFontAction({ ...mod, key: '0' })).toBe('reset');
    expect(getArticleFontAction({ ...ctrl, key: '0' })).toBe('reset');
  });

  it('ignores plain keys without a modifier', () => {
    expect(getArticleFontAction({ key: '=' })).toBeNull();
    expect(getArticleFontAction({ key: '-' })).toBeNull();
    expect(getArticleFontAction({ key: '0' })).toBeNull();
  });

  it('ignores Alt variants (they mean other shortcuts)', () => {
    expect(getArticleFontAction({ ...mod, key: '=', altKey: true })).toBeNull();
    expect(getArticleFontAction({ ...ctrl, key: '-', altKey: true })).toBeNull();
  });

  it('ignores unrelated keys and letters', () => {
    expect(getArticleFontAction({ ...mod, key: 'a' })).toBeNull();
    expect(getArticleFontAction({ ...mod, key: 'Enter' })).toBeNull();
    expect(getArticleFontAction({ ...mod, key: '?' })).toBeNull();
  });

  it('accepts code-only events from automation or odd layouts', () => {
    expect(getArticleFontAction({ ...mod, key: 'Dead', code: 'Equal' })).toBe('increase');
    expect(getArticleFontAction({ ...mod, key: 'Dead', code: 'Minus' })).toBe('decrease');
    expect(getArticleFontAction({ ...mod, key: 'Dead', code: 'Digit0' })).toBe('reset');
    expect(getArticleFontAction({ ...mod, key: '', code: 'Equal' })).toBe('increase');
    // code alone without a matching key shape still counts.
    expect(getArticleFontAction({ ...mod, key: '', code: 'Minus' })).toBe('decrease');
  });
});

describe('parseArticleFontStep', () => {
  it('parses numeric strings and clamps', () => {
    expect(parseArticleFontStep('2')).toBe(2);
    expect(parseArticleFontStep('-1')).toBe(-1);
    expect(parseArticleFontStep('99')).toBe(5);
    expect(parseArticleFontStep('-99')).toBe(-3);
  });

  it('passes numbers through', () => {
    expect(parseArticleFontStep(3)).toBe(3);
  });

  it('falls back to the default for missing or corrupt values', () => {
    expect(parseArticleFontStep(null)).toBe(0);
    expect(parseArticleFontStep(undefined)).toBe(0);
    expect(parseArticleFontStep('')).toBe(0);
    expect(parseArticleFontStep('abc')).toBe(0);
  });
});
