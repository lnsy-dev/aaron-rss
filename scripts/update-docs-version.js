#!/usr/bin/env node
/**
 * Syncs the version number in docs/index.html with package.json.
 *
 * Updates two places in the landing page:
 *   1. The "latest/download" .dmg URL (GitHub resolves this to the newest
 *      matching release asset, so only the filename's version needs to change).
 *   2. The human-readable "Version x.y.z" line under the download button.
 *
 * Usage: node scripts/update-docs-version.js [--check]
 *   --check  Exit with code 1 (and print a diff hint) if docs are out of
 *            sync, without writing anything. Useful in CI.
 *
 * Exits with code 0 when docs are (or become) in sync.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_PATH = join(ROOT, 'docs', 'index.html');
const PACKAGE_PATH = join(ROOT, 'package.json');

/**
 * Rewrites all version-bearing spots in the docs HTML.
 *
 * @param {string} html Current contents of docs/index.html
 * @param {string} version Version string, e.g. "0.6.1"
 * @returns {string} Updated HTML
 */
export function applyVersion(html, version) {
  // 1. Download link: .../releases/latest/download/Aaron%20RSS-<v>-arm64.dmg
  let out = html.replace(
    /(releases\/latest\/download\/Aaron%20RSS-)([^"']+)(-arm64\.dmg)/g,
    `$1${version}$3`
  );

  // 2. Visible version label: ">Version x.y.z · ..."
  out = out.replace(
    /(class="download-meta">\s*Version\s*)([^<&\s]+)/g,
    `$1${version}`
  );

  return out;
}

/**
 * Reads the current version from package.json.
 *
 * @returns {string} The semver version string
 */
function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
  if (!pkg.version) {
    throw new Error('No "version" field found in package.json');
  }
  return pkg.version;
}

// --- CLI entry point -------------------------------------------------------

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  const version = readPackageVersion();
  const html = readFileSync(DOCS_PATH, 'utf8');
  const updated = applyVersion(html, version);

  if (updated === html) {
    console.log(`✓ docs/index.html already in sync with v${version}`);
    process.exit(0);
  }

  if (checkOnly) {
    console.error(
      `✗ docs/index.html is out of sync with package.json (expected v${version}).\n` +
        '  Run: npm run docs:version'
    );
    process.exit(1);
  }

  writeFileSync(DOCS_PATH, updated, 'utf8');
  console.log(`✓ Updated docs/index.html to v${version}`);
}
