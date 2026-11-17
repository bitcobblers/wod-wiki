import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { findOrphanTests } from './check-orphan-tests';

describe('Zero-Orphan Gate (check-orphan-tests)', () => {
  it('enforces 0 orphan test files in the workspace', () => {
    const orphans = findOrphanTests();
    expect(orphans).toEqual([]);
  });

  it('detects unmapped test files in legacy or non-runner paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-orphan-check-'));
    try {
      // Create a valid matched test
      mkdirSync(join(dir, 'packages/core/tests'), { recursive: true });
      writeFileSync(join(dir, 'packages/core/tests/valid.test.ts'), '// test');

      // Create an orphan test in apps/playground/tests/ (the legacy unmapped directory)
      mkdirSync(join(dir, 'apps/playground/tests'), { recursive: true });
      writeFileSync(join(dir, 'apps/playground/tests/legacy.test.ts'), '// test');

      // Create an orphan test at package root
      mkdirSync(join(dir, 'packages/core/unmapped'), { recursive: true });
      writeFileSync(join(dir, 'packages/core/unmapped/stray.spec.ts'), '// test');

      const orphans = findOrphanTests(dir);
      expect(orphans).toEqual([
        'apps/playground/tests/legacy.test.ts',
        'packages/core/unmapped/stray.spec.ts',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recognizes valid test files across all registered packages and apps runners', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-runner-check-'));
    try {
      const validPaths = [
        'packages/core/tests/unit.test.ts',
        'packages/lang/tests/runtime/block.test.ts',
        'packages/storage/tests/store.test.ts',
        'packages/wql/tests/query.test.ts',
        'packages/engine/tests/runtime.test.ts',
        'packages/tools/tests/cli.test.ts',
        'packages/ui/src/widget.test.tsx',
        'packages/ui/test/component.spec.ts',
        'apps/playground/src/service.test.ts',
        'apps/playground/app/page.test.tsx',
        'apps/storybook/test/workbench.test.tsx',
      ];

      for (const p of validPaths) {
        mkdirSync(join(dir, p, '..'), { recursive: true });
        writeFileSync(join(dir, p), '// test');
      }

      const orphans = findOrphanTests(dir);
      expect(orphans).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
