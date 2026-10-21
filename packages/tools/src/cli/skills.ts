/**
 * `wod skills list | install` — the agent skills bundled with this CLI.
 *
 * The skills are the parsing rules an agent needs to read and write correct
 * Whiteboard Script (see `skills/<name>/SKILL.md` in the wod-wiki repo). They
 * ship inside the package as `skills/<name>/SKILL.md`, which is also the layout
 * `npx skills experimental_sync` discovers in an installed dependency, so a
 * project can get them without this command.
 *
 * `install` copies them into `<dir>/.agents/skills/` — the shared location agent
 * CLIs read (see the `skills` CLI's discovery list), no network, no npx.
 *
 * Lazily imported by cli/runner.ts (dynamic import), so static node:fs/node:path
 * imports stay out of browser bundles.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface BundledSkill {
  /** Directory name, which is also the frontmatter `name`. */
  name: string;
  description: string;
  /** Absolute path of the skill directory. */
  path: string;
}

export interface InstallResult {
  /** Skills root the files were read from. */
  root: string;
  /** `.agents/skills` directory that received them. */
  target: string;
  installed: string[];
  /** Already present and left alone (pass force to replace). */
  skipped: string[];
}

function frontmatterField(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}:[ \t]*(.*)$`, 'm'));
  return match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
}

/** Every `<root>/<name>/SKILL.md` directory, frontmatter read for the listing. */
export function listBundledSkills(root: string): BundledSkill[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const source = readFileSync(join(root, entry.name, 'SKILL.md'), 'utf-8');
      return {
        name: entry.name,
        description: frontmatterField(source, 'description') ?? '',
        path: join(root, entry.name),
      };
    });
}

/**
 * Skills root of this install, probed from the running CLI script: `<pkg>/dist/skills`
 * when built (`dist/bin/wod.mjs`), `skills/` in a checkout (`bin/wod`,
 * `packages/tools/src/bin/wod.ts`).
 */
export function bundledSkillsRoot(): string | undefined {
  const scriptDir = dirname(realpathSync(process.argv[1] ?? process.cwd()));
  const candidates = ['skills', '../skills', '../../skills', '../../../skills', '../../../../skills'].map((rel) =>
    resolve(scriptDir, rel),
  );
  return candidates.find((candidate) => listBundledSkills(candidate).length > 0);
}

/** Copy every bundled skill into `<dir>/.agents/skills/`. */
export function installSkills(options: { dir?: string; force?: boolean; root?: string } = {}): InstallResult {
  const root = options.root ?? bundledSkillsRoot();
  if (!root) {
    throw new Error('no bundled skills found next to this CLI — reinstall the package or run from the wod-wiki checkout');
  }
  const skills = listBundledSkills(root);
  if (skills.length === 0) throw new Error(`no skills under ${root}`);

  const target = join(resolve(options.dir ?? process.cwd()), '.agents', 'skills');
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const skill of skills) {
    const destination = join(target, skill.name);
    if (existsSync(destination) && options.force !== true) {
      skipped.push(skill.name);
      continue;
    }
    // Replacing: drop the old directory so files removed upstream do not linger.
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(skill.path, destination, { recursive: true });
    installed.push(skill.name);
  }
  return { root, target, installed, skipped };
}
