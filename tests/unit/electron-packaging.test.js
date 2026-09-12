/**
 * Electron Packaging Unit Tests
 *
 * electron-builder only packs the files listed in the "build.files" whitelist
 * in package.json. The Electron main process imports shared helpers from
 * src/lib/, so any new `../src/...` import in electron/ that is missing from
 * the whitelist crashes the packaged app with ERR_MODULE_NOT_FOUND (this
 * happened for youtube.js and podcast.js). These tests fail when an electron
 * file imports a src/ module that the whitelist does not include.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

/**
 * Extract every relative specifier pointing into src/ from an electron file.
 *
 * @param {string} source File contents
 * @returns {string[]} Normalized specifiers such as "src/lib/podcast.js"
 */
function extractSrcImports(source) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\(|require\()\s*['"](\.\.\/src\/[^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    // Normalize "../src/lib/foo.js" to the "src/lib/foo.js" form used in build.files
    specifiers.push(path.normalize(match[1]).replace(/^(\.\.\/)+/, ''));
  }
  return specifiers;
}

describe('electron packaging', () => {
  it('build.files includes every src/ module imported by the electron main process', () => {
    const files = pkg.build.files;
    const electronDir = path.join(repoRoot, 'electron');
    const electronFiles = readdirSync(electronDir).filter((name) => /\.(c|m)?js$/.test(name));

    const missing = [];
    for (const name of electronFiles) {
      const source = readFileSync(path.join(electronDir, name), 'utf8');
      for (const specifier of extractSrcImports(source)) {
        const packed = files.some(
          (entry) => entry === specifier || entry === `./${specifier}`,
        );
        if (!packed) {
          missing.push(`${name} imports ${specifier}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
