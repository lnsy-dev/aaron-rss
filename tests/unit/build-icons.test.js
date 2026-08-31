import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanLogoSvg, buildIcons } from '../../scripts/build-icons.js';

describe('cleanLogoSvg', () => {
  it('strips the class attribute carrying the editor grid classes', () => {
    const svg = '<svg class="grid-isometric grid-hidden" width="10"></svg>';
    const out = cleanLogoSvg(svg);
    expect(out).not.toContain('class=');
    expect(out).toContain('width="10"');
  });

  it('strips the inline style attribute with the grid background', () => {
    const svg = '<svg style="--grid-size-mm: 5mm; background-image: repeating-linear-gradient(90deg, red, red);"></svg>';
    const out = cleanLogoSvg(svg);
    expect(out).not.toContain('style=');
    expect(out).not.toContain('repeating-linear-gradient');
  });

  it('resolves var() references to their fallback values', () => {
    const svg = '<rect fill="var(--accent, #e4191c)" font-family="var(--font-family, \'EB Garamond\', serif)"/>';
    const out = cleanLogoSvg(svg);
    expect(out).toContain('fill="#e4191c"');
    expect(out).toContain("font-family=\"'EB Garamond', serif\"");
    expect(out).not.toContain('var(');
  });

  it('leaves SVG without class, style or var() untouched', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 1 1"/></svg>';
    expect(cleanLogoSvg(svg)).toBe(svg);
  });

  it('cleans the real logo source into a self-contained SVG', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const svgPath = path.resolve(process.cwd(), 'assets/logo.svg');
    if (!fs.existsSync(svgPath)) return; // asset missing in checkout; skip
    const out = cleanLogoSvg(fs.readFileSync(svgPath, 'utf8'));
    expect(out).not.toContain('var(');
    expect(out).not.toContain('style=');
    expect(out).toContain('viewBox="141 28 63 88"');
  });
});

describe('buildIcons', () => {
  it('writes the full icon set from a minimal SVG into the output dir', async () => {
    const inDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaron-icons-src-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaron-icons-out-'));
    const source = path.join(inDir, 'logo.svg');
    fs.writeFileSync(source, [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
      '<rect fill="var(--accent, #123456)" x="10" y="10" width="80" height="80"/>',
      '</svg>',
    ].join(''));

    await buildIcons({ sourceSvg: source, outputDir: outDir });

    // All generated artifacts exist.
    for (const name of [
      'logo.png',
      'favicon.svg',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'favicon.ico',
      'apple-touch-icon.png',
    ]) {
      expect(fs.existsSync(path.join(outDir, name)), name).toBe(true);
    }

    // favicon.svg is the cleaned source (var() resolved).
    const faviconSvg = fs.readFileSync(path.join(outDir, 'favicon.svg'), 'utf8');
    expect(faviconSvg).toContain('fill="#123456"');
    expect(faviconSvg).not.toContain('var(');

    // PNG outputs are actually raster images with the right dimensions.
    const sharp = (await import('sharp')).default;
    const master = sharp(path.join(outDir, 'logo.png'));
    expect((await master.metadata()).width).toBe(1024);
    expect((await master.metadata()).height).toBe(1024);
    const touch = sharp(path.join(outDir, 'apple-touch-icon.png'));
    expect((await touch.metadata()).width).toBe(180);

    // ICO embeds multiple sizes.
    const ico = fs.readFileSync(path.join(outDir, 'favicon.ico'));
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2); // image count
  });
});
