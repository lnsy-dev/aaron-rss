/**
 * Unit tests for scripts/update-docs-version.js
 *
 * Verifies that applyVersion() rewrites both the .dmg download URL and the
 * visible "Version x.y.z" label in docs/index.html.
 */

import { describe, it, expect } from 'vitest';
import { applyVersion } from '../../scripts/update-docs-version.js';

const SAMPLE_HTML = [
  '<!DOCTYPE html>',
  '<html><head><title>Aaron RSS</title></head>',
  '<body>',
  '  <a class="download-button" id="dmg-download"',
  '     href="https://github.com/lnsy-dev/aaron-rss/releases/latest/download/Aaron%20RSS-1.0.0-arm64.dmg"',
  '     download>Download for Mac</a>',
  '  <p class="download-meta">Version 1.0.0 &middot; macOS (Apple Silicon) &middot; .dmg</p>',
  '</body></html>',
].join('\n');

describe('applyVersion', () => {
  it('rewrites the version in the latest/download dmg URL', () => {
    const out = applyVersion(SAMPLE_HTML, '0.6.1');
    expect(out).toContain(
      'releases/latest/download/Aaron%20RSS-0.6.1-arm64.dmg'
    );
  });

  it('rewrites the visible version label', () => {
    const out = applyVersion(SAMPLE_HTML, '0.6.1');
    expect(out).toContain('Version 0.6.1');
  });

  it('leaves the rest of the document untouched', () => {
    const out = applyVersion(SAMPLE_HTML, '0.6.1');
    expect(out).toBe(
      SAMPLE_HTML
        .replace('Aaron%20RSS-1.0.0-arm64.dmg', 'Aaron%20RSS-0.6.1-arm64.dmg')
        .replace('Version 1.0.0', 'Version 0.6.1')
    );
  });

  it('is idempotent when run with the same version', () => {
    const once = applyVersion(SAMPLE_HTML, '2.3.4');
    expect(applyVersion(once, '2.3.4')).toBe(once);
  });

  it('handles arbitrary semver versions including prerelease tags', () => {
    const out = applyVersion(SAMPLE_HTML, '1.0.0-beta.2');
    expect(out).toContain('Aaron%20RSS-1.0.0-beta.2-arm64.dmg');
    expect(out).toContain('Version 1.0.0-beta.2');
  });

  it('does nothing when no version-bearing markup is present', () => {
    const plain = '<html><body>No downloads here.</body></html>';
    expect(applyVersion(plain, '9.9.9')).toBe(plain);
  });
});
