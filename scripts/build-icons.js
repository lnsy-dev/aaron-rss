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
 * Rasterization uses `sharp` (bundled librsvg) and ICO assembly uses
 * `png-to-ico`, so the build needs no system-level tools.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SOURCE_SVG = path.join(ASSETS, 'logo.svg');

/** Master square size for logo.png. */
const MASTER_SIZE = 1024;
/** Logo content fills this much of the square canvas (rest is padding). */
const CONTENT_RATIO = 0.82;
/** Density used when rasterizing the source SVG (keeps downscales crisp). */
const RASTER_DENSITY = 600;

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
 * Generate the icon set from an SVG source into an output directory.
 *
 * @param {object} [options]
 * @param {string} [options.sourceSvg] Path to the source SVG
 *        (defaults to assets/logo.svg)
 * @param {string} [options.outputDir] Directory to write icons into
 *        (defaults to assets/)
 * @returns {Promise<void>}
 */
export async function buildIcons({ sourceSvg = SOURCE_SVG, outputDir = ASSETS } = {}) {
  const raw = fs.readFileSync(sourceSvg, 'utf8');
  const cleaned = cleanLogoSvg(raw);

  // Cleaned SVG doubles as the scalable web favicon.
  fs.writeFileSync(path.join(outputDir, 'favicon.svg'), cleaned);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaron-rss-icons-'));
  try {
    const contentSize = Math.round(MASTER_SIZE * CONTENT_RATIO);

    // Rasterize from a hi-res render so downscales stay crisp.
    const hires = await sharp(Buffer.from(cleaned), { density: RASTER_DENSITY })
      .resize(contentSize, contentSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    // Square master: hi-res render centered on a transparent canvas.
    const masterPath = path.join(tmpDir, 'master.png');
    await sharp({
      create: {
        width: MASTER_SIZE,
        height: MASTER_SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: hires, gravity: 'centre' }])
      .png()
      .toFile(masterPath);

    // Master doubles as the electron-builder app icon.
    fs.copyFileSync(masterPath, path.join(outputDir, 'logo.png'));

    // PNG favicons derived from the master.
    await sharp(masterPath).resize(180, 180).png()
      .toFile(path.join(outputDir, 'apple-touch-icon.png'));
    const f32Path = path.join(outputDir, 'favicon-32x32.png');
    const f16Path = path.join(outputDir, 'favicon-16x16.png');
    await sharp(masterPath).resize(32, 32).png().toFile(f32Path);
    await sharp(masterPath).resize(16, 16).png().toFile(f16Path);

    // Multi-resolution ICO for browsers/platforms that want one.
    const f48 = await sharp(masterPath).resize(48, 48).png().toBuffer();
    const icoBuffer = await pngToIco([
      await fs.promises.readFile(f16Path),
      await fs.promises.readFile(f32Path),
      f48,
    ]);
    fs.writeFileSync(path.join(outputDir, 'favicon.ico'), icoBuffer);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildIcons().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
