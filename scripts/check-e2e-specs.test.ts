import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { LEGACY_UNPAIRED_E2E_FILES, validateE2eSpecCrosswalk } from './check-e2e-specs';

const NO_LEGACY = { legacyUnpairedFiles: new Set<string>() };

describe('validateE2eSpecCrosswalk (spec-lint)', () => {
  it('passes when Level-1 Markdown spec and Level-2 .e2e.ts script match 1:1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-spec-lint-ok-'));
    try {
      mkdirSync(join(dir, 'e2e/specs/feeds'), { recursive: true });
      mkdirSync(join(dir, 'e2e/live-app'), { recursive: true });
      writeFileSync(
        join(dir, 'e2e/specs/feeds/publication-visibility.md'),
        [
          '---',
          'domain: feeds',
          'specFile: e2e/live-app/publication-visibility.e2e.ts',
          'routes: [/note/:noteId, /feeds]',
          'personas: [Feed Publisher]',
          'viewports: [desktop, mobile-375]',
          'priority: P0-gate',
          '---',
          '',
          '# FED-03 — Publication Visibility & Feed Export',
          '',
          '### Scenario 1: Publication Visibility ladder',
          'Given a private Journal Note and a user Notebook:',
          '1. Publisher promotes the Note and marks the Notebook public.',
          '- expect: PublicationPill transitions to Published Note.',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'e2e/live-app/publication-visibility.e2e.ts'),
        "// spec: e2e/specs/feeds/publication-visibility.md\nimport { test } from '../fixtures/playgroundActor';\ntest('noop', async () => {});\n",
      );

      expect(validateE2eSpecCrosswalk(dir, NO_LEGACY)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports missing frontmatter keys, missing expect bullets, missing H1, and broken // spec: headers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-spec-lint-bad-'));
    try {
      mkdirSync(join(dir, 'e2e/specs/journal'), { recursive: true });
      mkdirSync(join(dir, 'e2e/live-app'), { recursive: true });
      writeFileSync(
        join(dir, 'e2e/specs/journal/broken.md'),
        [
          '---',
          'domain: journal',
          'specFile: e2e/live-app/broken.e2e.ts',
          '---',
          '',
          '### Scenario 1: Missing fields',
          '1. Athlete opens /journal.',
          '',
        ].join('\n'),
      );
      writeFileSync(join(dir, 'e2e/live-app/broken.e2e.ts'), "import { test } from '@playwright/test';\n");

      const issues = validateE2eSpecCrosswalk(dir, NO_LEGACY);
      expect(issues.some((i) => i.message.includes("Missing required frontmatter key 'routes:'"))).toBe(true);
      expect(issues.some((i) => i.message.includes('H1 heading'))).toBe(true);
      expect(issues.some((i) => i.message.includes('Given'))).toBe(true);
      expect(issues.some((i) => i.message.includes('- expect:'))).toBe(true);
      expect(issues.some((i) => i.message.includes("Missing '// spec: e2e/specs/journal/broken.md'"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces allowed domain, priority, bracketed list syntax, and viewport tokens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-spec-lint-enums-'));
    try {
      mkdirSync(join(dir, 'e2e/specs/journal'), { recursive: true });
      mkdirSync(join(dir, 'e2e/live-app'), { recursive: true });
      writeFileSync(
        join(dir, 'e2e/specs/journal/drift.md'),
        [
          '---',
          'domain: analytics',
          'specFile: e2e/live-app/drift.e2e.ts',
          'routes: /journal, /note/:noteId',
          'personas: [Athlete]',
          'viewports: [1280x800, mobile-375]',
          'priority: P0',
          '---',
          '',
          '# Drift Test',
          '',
          '### Scenario 1: Enum checks',
          'Given a workspace:',
          '1. Athlete opens /journal.',
          '- expect: stream renders.',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'e2e/live-app/drift.e2e.ts'),
        "// spec: e2e/specs/journal/drift.md\nimport { test } from '../fixtures/playgroundActor';\ntest('noop', async () => {});\n",
      );

      const issues = validateE2eSpecCrosswalk(dir, NO_LEGACY);
      expect(issues.some((i) => i.message.includes("does not match parent folder 'journal'"))).toBe(true);
      expect(issues.some((i) => i.message.includes("Invalid frontmatter priority 'P0'"))).toBe(true);
      expect(issues.some((i) => i.message.includes("Frontmatter 'routes:' must be a non-empty bracketed list"))).toBe(true);
      expect(issues.some((i) => i.message.includes("Invalid viewport token '1280x800'"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ratchets LEGACY_UNPAIRED_E2E_FILES downward on new unpaired, deleted, or migrated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-spec-lint-ratchet-'));
    try {
      mkdirSync(join(dir, 'e2e/specs/journal'), { recursive: true });
      mkdirSync(join(dir, 'e2e/live-app'), { recursive: true });

      writeFileSync(
        join(dir, 'e2e/specs/journal/migrated.md'),
        [
          '---',
          'domain: journal',
          'specFile: e2e/live-app/migrated.e2e.ts',
          'routes: [/journal]',
          'personas: [Athlete]',
          'viewports: [desktop]',
          'priority: P1',
          '---',
          '',
          '# JRN-99 — Migrated Spec',
          '',
          '### Scenario 1: Migrated',
          'Given a workspace:',
          '1. Athlete opens /journal.',
          '- expect: stream renders.',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'e2e/live-app/migrated.e2e.ts'),
        "// spec: e2e/specs/journal/migrated.md\nimport { test } from '../fixtures/playgroundActor';\ntest('noop', async () => {});\n",
      );
      writeFileSync(join(dir, 'e2e/live-app/legacy-allowed.e2e.ts'), "import { test } from '@playwright/test';\n");
      writeFileSync(join(dir, 'e2e/live-app/brand-new-unpaired.e2e.ts'), "import { test } from '@playwright/test';\n");

      const issues = validateE2eSpecCrosswalk(dir, {
        legacyUnpairedFiles: new Set([
          'e2e/live-app/legacy-allowed.e2e.ts',
          'e2e/live-app/migrated.e2e.ts',
          'e2e/live-app/deleted-legacy.e2e.ts',
        ]),
      });

      expect(issues.some((i) => i.file === 'e2e/live-app/legacy-allowed.e2e.ts')).toBe(false);
      expect(
        issues.some(
          (i) =>
            i.file === 'e2e/live-app/brand-new-unpaired.e2e.ts' &&
            i.message.includes('unpaired E2E specs are not allowed'),
        ),
      ).toBe(true);
      expect(
        issues.some(
          (i) =>
            i.file === 'e2e/live-app/migrated.e2e.ts' &&
            i.message.includes('remove it from LEGACY_UNPAIRED_E2E_FILES'),
        ),
      ).toBe(true);
      expect(
        issues.some(
          (i) =>
            i.file === 'e2e/live-app/deleted-legacy.e2e.ts' &&
            i.message.includes('Stale LEGACY_UNPAIRED_E2E_FILES entry'),
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates the live repository with zero crosswalk or allowlist drift', () => {
    const repoRoot = join(import.meta.dirname, '..');
    expect(LEGACY_UNPAIRED_E2E_FILES.size).toBe(24);
    expect(validateE2eSpecCrosswalk(repoRoot)).toEqual([]);
  });
});
