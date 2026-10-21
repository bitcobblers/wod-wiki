import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installSkills, listBundledSkills } from '../src/cli/skills';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const skillsRoot = join(repoRoot, 'skills');

describe('bundled skills', () => {
  it('lists every skill directory with its frontmatter description', () => {
    const skills = listBundledSkills(skillsRoot);
    expect(skills.map((skill) => skill.name)).toContain('wod-extraction');
    const extraction = skills.find((skill) => skill.name === 'wod-extraction')!;
    expect(extraction.description).toContain('WOD Wiki syntax');
    expect(extraction.path).toBe(join(skillsRoot, 'wod-extraction'));
  });

  it('names every skill after its directory', () => {
    for (const skill of listBundledSkills(skillsRoot)) {
      const source = readFileSync(join(skill.path, 'SKILL.md'), 'utf-8');
      expect(source).toMatch(new RegExp(`^name: ${skill.name}$`, 'm'));
    }
  });

  it('returns nothing for a directory without skills', () => {
    expect(listBundledSkills(join(repoRoot, 'packages'))).toEqual([]);
  });
});

describe('installSkills', () => {
  const withTempProject = (run: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-skills-'));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('copies each skill into <dir>/.agents/skills/', () => {
    withTempProject((dir) => {
      const result = installSkills({ root: skillsRoot, dir });
      expect(result.installed).toEqual(['wod-extraction']);
      expect(result.target).toBe(join(dir, '.agents', 'skills'));
      expect(readdirSync(result.target)).toEqual(['wod-extraction']);
      expect(readFileSync(join(result.target, 'wod-extraction', 'SKILL.md'), 'utf-8')).toBe(
        readFileSync(join(skillsRoot, 'wod-extraction', 'SKILL.md'), 'utf-8'),
      );
    });
  });

  it('keeps an existing install unless force is set', () => {
    withTempProject((dir) => {
      const target = join(dir, '.agents', 'skills', 'wod-extraction');
      installSkills({ root: skillsRoot, dir });
      writeFileSync(join(target, 'SKILL.md'), 'local edit');

      const kept = installSkills({ root: skillsRoot, dir });
      expect(kept).toMatchObject({ installed: [], skipped: ['wod-extraction'] });
      expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toBe('local edit');

      const replaced = installSkills({ root: skillsRoot, dir, force: true });
      expect(replaced.installed).toEqual(['wod-extraction']);
      expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toBe(
        readFileSync(join(skillsRoot, 'wod-extraction', 'SKILL.md'), 'utf-8'),
      );
    });
  });

  it('throws when no skills are found', () => {
    withTempProject((dir) => {
      expect(() => installSkills({ root: join(dir, 'missing'), dir })).toThrow(/no skills under/i);
    });
  });
});

describe('served copies', () => {
  it('keeps the playground copy identical to the canonical skill', () => {
    expect(readFileSync(join(repoRoot, 'apps/playground/public/ai-skills/parse.md'), 'utf-8')).toBe(
      readFileSync(join(skillsRoot, 'wod-extraction', 'SKILL.md'), 'utf-8'),
    );
  });
});
