import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundledSkillsRoot, installSkills, listBundledSkills } from '../src/cli/skills';

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

  it('discovers packaged skills through a node_modules/.bin symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wod-skills-bin-'));
    const originalScript = process.argv[1];
    try {
      const bin = join(dir, 'node_modules', '.bin');
      const dist = join(dir, 'node_modules', '@bitcobblers', 'wod-wiki-tools', 'dist');
      mkdirSync(bin, { recursive: true });
      mkdirSync(join(dist, 'bin'), { recursive: true });
      mkdirSync(join(dist, 'skills', 'example'), { recursive: true });
      writeFileSync(join(dist, 'bin', 'wod.mjs'), '');
      writeFileSync(join(dist, 'skills', 'example', 'SKILL.md'), 'name: example');
      symlinkSync(join(dist, 'bin', 'wod.mjs'), join(bin, 'wod'));
      process.argv[1] = join(bin, 'wod');
      expect(bundledSkillsRoot()).toBe(join(dist, 'skills'));
    } finally {
      process.argv[1] = originalScript;
      rmSync(dir, { recursive: true, force: true });
    }
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

