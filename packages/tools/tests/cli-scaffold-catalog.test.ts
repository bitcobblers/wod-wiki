import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cliMain } from '../src/index';
import { generateSeed } from '../src/seedbuild/compiler';

describe('wod init-catalog', () => {
  const tempDirs: string[] = [];
  const makeTempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-init-catalog-'));
    tempDirs.push(dir);
    return dir;
  };
  const inTempDir = async (run: () => Promise<void>): Promise<void> => {
    const originalCwd = process.cwd();
    process.chdir(makeTempDir());
    try {
      await run();
    } finally {
      process.chdir(originalCwd);
    }
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('scaffolds a catalog the seed compiler really compiles (exit code 0)', async () => {
    await inTempDir(async () => {
      const code = await cliMain(['init-catalog', 'my-catalog'], { stdout: () => {} });
      expect(code).toBe(0);

      const pkg = JSON.parse(readFileSync(join('my-catalog', 'package.json'), 'utf8'));
      expect(pkg.name).toBe('my-catalog');

      // The scaffold must pass the real seed compiler gates (parity + syntax).
      const result = generateSeed({ corpusRoot: join(process.cwd(), 'my-catalog'), outDir: join(process.cwd(), 'dist-test') });
      expect(result.totalFiles).toBe(2);
      expect(result.manifest.chunks.map((c) => c.id)).toContain('collection.example');
    });
  });

  it('refuses an existing destination without touching its files (exit code 1)', async () => {
    await inTempDir(async () => {
      mkdirSync('my-catalog');
      writeFileSync(join('my-catalog', 'keep.txt'), 'keep me', 'utf8');

      const errors: string[] = [];
      const code = await cliMain(['init-catalog', 'my-catalog'], { stdout: () => {}, stderr: (t) => { errors.push(t); } });

      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('already exists');
      expect(readFileSync(join('my-catalog', 'keep.txt'), 'utf8')).toBe('keep me');
      expect(existsSync(join('my-catalog', 'package.json'))).toBe(false);
    });
  });

  it('rejects traversal, absolute paths, and invalid package names (exit code 1)', async () => {
    await inTempDir(async () => {
      expect(await cliMain(['init-catalog'], { stdout: () => {} })).toBe(1);
      for (const name of ['..', '../escape', '/abs', 'My-Catalog']) {
        expect(await cliMain(['init-catalog', name], { stdout: () => {} }), name).toBe(1);
      }
      expect(existsSync('/abs')).toBe(false);
      expect(existsSync('My-Catalog')).toBe(false);
    });
  });
});
