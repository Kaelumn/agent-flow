import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * The comparison reads the editor's code but the editor must never depend on it, so it can be changed or removed
 * without touching anything else. The page is opened from App (loaded lazily) and the history panel links to its address.
 */
describe('version comparison stays separate', () => {
  it('is imported by nothing outside its folder except the lazy route in App', () => {
    const importers = files(SRC)
      .filter((f) => !relative(SRC, f).startsWith(`compare${sep}`))
      .filter((f) => /from\s+['"][^'"]*\/compare\//.test(readFileSync(f, 'utf8')) || /import\(\s*['"][^'"]*\/compare\//.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).replaceAll(sep, '/'));
    expect(importers).toEqual(['App.tsx']);
  });
});
