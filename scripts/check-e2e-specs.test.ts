import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { validateE2eSpecCrosswalk } from './check-e2e-specs';

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

      expect(validateE2eSpecCrosswalk(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports missing frontmatter keys, missing expect bullets, and broken // spec: headers', () => {
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

      const issues = validateE2eSpecCrosswalk(dir);
      expect(issues.some((i) => i.message.includes("Missing required frontmatter key 'routes:'"))).toBe(true);
      expect(issues.some((i) => i.message.includes('Given'))).toBe(true);
      expect(issues.some((i) => i.message.includes('- expect:'))).toBe(true);
      expect(issues.some((i) => i.message.includes("Missing '// spec: e2e/specs/journal/broken.md'"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
