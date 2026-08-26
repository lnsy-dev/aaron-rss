/**
 * Generate the application icon set from assets/logo.svg.
 *
 * Outputs (all written into assets/ so webpack's CopyWebpackPlugin and
 * electron-builder pick them up):
 * - logo.png            1024x1024 square master (Electron window icon,
 *                       electron-builder `build.icon`)
 * - favicon.svg         cleaned copy of the source SVG (no editor grid,
 *                       CSS variables resolved to their fallbacks)
 * - favicon-16x16.png   16x16 PNG fallback
 * - favicon-32x32.png   32x32 PNG fallback
 * - favicon.ico         multi-resolution ICO (16/32/48)
 * - apple-touch-icon.png 180x180 PNG
 *
 * Rasterization uses ImageMagick (`magick`), which must be on PATH.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SOURCE_SVG = path.join(ASSETS, 'logo.svg');

/** Master square size for logo.png. */
const MASTER_SIZE = 1024;
/** Logo content fills this much of the square canvas (rest is padding). */
const CONTENT_RATIO = 0.82;

/**
 * Clean the source SVG so it rasterizes identically everywhere:
 * strip the isometric-editor grid (class + inline background style) and
 * resolve CSS var() references to their inline fallback values, since
 * rasterizers do not evaluate CSS custom properties.
 *
 * @param {string} svg Raw SVG source
 * @returns {string} Cleaned SVG source
 */
export function cleanLogoSvg(svg) {
  let out = svg.replace(/\s+class="[^"]*"/, '');
  out = out.replace(/\s+style="[^"]*"/, '');
  out = out.replace(/var\(\s*(--[\w-]+)\s*,\s*([^)]+?)\)/g, '$2');
  return out;
}

/**
 * Run ImageMagick with the given arguments.
 *
 * @param {string[]} args Arguments passed to `magick`
 * @returns {void}
 */
function magick(args) {
  execFileSync('magick', args, { stdio: 'inherit' });
}

/**
 * Generate the icon set from assets/logo.svg.
 *
 * @returns {void}
 */
export function buildIcons() {
  const raw = fs.readFileSync(SOURCE_SVG, 'utf8');
  const cleaned = cleanLogoSvg(raw);

  // Cleaned SVG doubles as the scalable web favicon.
  fs.writeFileSync(path.join(ASSETS, 'favicon.svg'), cleaned);

  // Rasterize from a hi-res temp render so downscales stay crisp.
  // Use ImageMagick's internal MSVG renderer (prefix "msvg:") so the build
  // does not depend on an external Inkscape/librsvg delegate being configured.
  const tmpSvg = path.join(os.tmpdir(), 'aaron-rss-logo-clean.svg');
  fs.writeFileSync(tmpSvg, cleaned);
  const tmpRender = path.join(os.tmpdir(), 'aaron-rss-logo-hires.png');
  magick(['-background', 'none', '-density', '600', `msvg:${tmpSvg}`, tmpRender]);

  // Square master: hi-res render centered on a transparent canvas.
  const contentSize = Math.round(MASTER_SIZE * CONTENT_RATIO);
  magick([
    tmpRender,
    '-resize', `${contentSize}x${contentSize}`,
    '-gravity', 'center',
    '-background', 'none',
    '-extent', `${MASTER_SIZE}x${MASTER_SIZE}`,
    path.join(ASSETS, 'logo.png'),
  ]);

  // PNG favicons derived from the master.
  const appleTouch = path.join(ASSETS, 'apple-touch-icon.png');
  magick([path.join(ASSETS, 'logo.png'), '-resize', '180x180', appleTouch]);
  const f32 = path.join(ASSETS, 'favicon-32x32.png');
  const f16 = path.join(ASSETS, 'favicon-16x16.png');
  const f48 = path.join(os.tmpdir(), 'aaron-rss-favicon-48.png');
  magick([path.join(ASSETS, 'logo.png'), '-resize', '32x32', f32]);
  magick([path.join(ASSETS, 'logo.png'), '-resize', '16x16', f16]);
  magick([path.join(ASSETS, 'logo.png'), '-resize', '48x48', f48]);

  // Multi-resolution ICO for browsers/platforms that want one.
  magick([f16, f32, f48, path.join(ASSETS, 'favicon.ico')]);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildIcons();
}
