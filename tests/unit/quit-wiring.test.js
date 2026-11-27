import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('electron main Ctrl+Q quit wiring', () => {
  const source = readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  it('the before-input-event listener uses the quit matcher', () => {
    expect(source).toContain('isQuitKeyDown');
  });

  it('a matched Ctrl+Q press calls app.quit()', () => {
    // The quit block sits between the matcher call and the next
    // before-input-event branch; app.quit() is the shutdown entry.
    const block = source.slice(
      source.indexOf('isQuitKeyDown(input, process.platform)'),
      source.indexOf('isQuitKeyDown(input, process.platform)') + 300,
    );
    expect(block).toContain('app.quit()');
    expect(block).toContain('event.preventDefault()');
  });
});
