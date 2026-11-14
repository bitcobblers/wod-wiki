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
        "// spec: e2e/specs/feeds/publication-visibility.md\nimport { test } from '../fixtures/playgroundActor';\ntest('noop', async ({ page }) => { await page.setViewportSize({ width: 375, height: 812 }); });\n",
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

  it('enforces mobile-375 viewport parity across inline setViewportSize and journal-mobile-375 config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-spec-lint-mobile375-'));
    try {
      mkdirSync(join(dir, 'e2e/specs/journal'), { recursive: true });
      mkdirSync(join(dir, 'e2e/specs/analytics'), { recursive: true });
      mkdirSync(join(dir, 'e2e/specs/feeds'), { recursive: true });
      mkdirSync(join(dir, 'e2e/live-app'), { recursive: true });

      writeFileSync(
        join(dir, 'playwright.journal.config.ts'),
        [
          "export const MOBILE_375_LEVEL2_SPECS = ['e2e/live-app/project-matched.e2e.ts'];",
          'export function resolveMobile375TestMatch() { return MOBILE_375_LEVEL2_SPECS; }',
          'export default {',
          '  projects: [',
          "    { name: 'journal-chromium', testMatch: ['**/live-app/**/*.e2e.ts'] },",
          "    { name: 'journal-mobile-375', testMatch: resolveMobile375TestMatch() },",
          '  ],',
          '};',
          '',
        ].join('\n'),
      );

      // 1. Passing via journal-mobile-375 project match (no inline setViewportSize(375))
      writeFileSync(
        join(dir, 'e2e/specs/analytics/project-matched.md'),
        [
          '---',
          'domain: analytics',
          'specFile: e2e/live-app/project-matched.e2e.ts',
          'routes: [/dashboards]',
          'personas: [Athlete]',
          'viewports: [desktop, mobile-375]',
          'priority: P1-core',
          '---',
          '',
          '# ANL-99 — Project Matched Mobile Spec',
          '',
          '### Scenario 1: Runs under journal-mobile-375 project',
          'Given a seeded workspace:',
          '1. Athlete opens /dashboards.',
          '- expect: cards fit 375px without overflow.',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'e2e/live-app/project-matched.e2e.ts'),
        "// spec: e2e/specs/analytics/project-matched.md\nimport { test } from '../fixtures/playgroundActor';\ntest('adapts', async ({ app }) => { await app.wql.openDashboards(); });\n",
      );

      // 2. Passing via viewport table + inline setViewportSize
      writeFileSync(
        join(dir, 'e2e/specs/feeds/inline-mobile.md'),
        [
          '---',
          'domain: feeds',
          'specFile: e2e/live-app/inline-mobile.e2e.ts',
          'routes: [/load]',
          'personas: [Athlete]',
          'viewports: [desktop, mobile-375]',
          'priority: P1',
          '---',
          '',
          '# FED-99 — Inline Mobile Spec',
          '',
          '### Scenario 1: Exercises 375x812 inline',
          'Given a portable archive:',
          '1. Athlete opens /load at 375x812.',
          '- expect: intake renders with zero overflow.',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'e2e/live-app/inline-mobile.e2e.ts'),
        [
          '// spec: e2e/specs/feeds/inline-mobile.md',
          "import { test } from '../fixtures/playgroundActor';",
          'const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }] as const;',
          "test('inline mobile', async ({ page }) => { for (const vp of VIEWPORTS) await page.setViewportSize(vp); });",
          '',
        ].join('\n'),
      );

      // 3. Failing: declares mobile-375 in .md, missing from journal-mobile-375 AND only desktop/comment in .e2e.ts
      writeFileSync(
        join(dir, 'e2e/specs/journal/missing-mobile.md'),
        [
          '---',
          'domain: journal',
          'specFile: e2e/live-app/missing-mobile.e2e.ts',
          'routes: [/journal]',
          'personas: [Athlete]',
          'viewports: [desktop, mobile-375]',
          'priority: P1',
          '---',
          '',
          '# JRN-98 — Missing Mobile Coverage',
          '',
          '### Scenario 1: Forgot mobile viewport',
          'Given a workspace:',
          '1. Athlete opens /journal.',
          '- expect: stream renders.',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'e2e/live-app/missing-mobile.e2e.ts'),
        [
          '// spec: e2e/specs/journal/missing-mobile.md',
          "import { test } from '../fixtures/playgroundActor';",
          '// TODO: await page.setViewportSize({ width: 375, height: 812 });',
          "test('desktop only', async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });",
          '',
        ].join('\n'),
      );

      const issues = validateE2eSpecCrosswalk(dir, NO_LEGACY);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.file).toBe('e2e/specs/journal/missing-mobile.md');
      expect(issues[0]?.message).toContain("Declares 'mobile-375' in 'viewports:'");
      expect(issues[0]?.message).toContain('journal-mobile-375');
      expect(issues[0]?.message).toContain('setViewportSize');
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
