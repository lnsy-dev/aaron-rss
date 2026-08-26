import { describe, it, expect } from 'vitest';
import { cleanLogoSvg } from '../../scripts/build-icons.js';

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
    expect(out).toContain('viewBox="176 36 48 77"');
  });
});
