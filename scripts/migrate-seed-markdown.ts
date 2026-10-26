import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ponytail: line-oriented regex transform assumes 2-space indented baseAttributes; upgrade to AST YAML parser if seeds introduce arbitrary multi-line scalars.

export interface MigrateOptions {
  dryRun?: boolean;
  build?: boolean;
}

export function migrateMarkdownContent(content: string, filePath: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  if (!match) return content;

  let fm = match[1];
  const rest = match[2] ?? '';
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const isEffort = filePath.includes('/efforts/') || filePath.startsWith('markdown/efforts/');

  // 1. Ensure `type: effort` on effort files
  if (isEffort && !/^type:\s*/m.test(fm)) {
    fm = `type: effort${eol}` + fm;
  }

  // 2. Flatten baseAttributes block
  fm = fm.replace(/(?:^|\n)baseAttributes:\r?\n((?:[ \t]+[^\r\n]+(?:\r?\n|$))+)/, (m, block) => {
    const lines: string[] = [];
    const metM = block.match(/^\s*met:\s*(.+)$/m);
    const dfM = block.match(/^\s*disciplineFactor:\s*(.+)$/m);
    const discM = block.match(/^\s*discipline:\s*(.+)$/m);
    const intM = block.match(/^\s*intensityTier:\s*(.+)$/m);

    if (metM) lines.push(`metrics.met: ${metM[1].trim()}`);
    if (dfM) lines.push(`metrics.disciplineFactor: ${dfM[1].trim()}`);
    if (discM) {
      let d = discM[1].trim();
      if (d === 'weightlifting' || d === '"weightlifting"' || d === "'weightlifting'") d = 'strength';
      lines.push(`discipline: ${d}`);
    }
    if (intM) lines.push(`intensityTier: ${intM[1].trim()}`);

    for (const rawLine of block.split(/\r?\n/)) {
      const kv = rawLine.match(/^\s*([a-zA-Z0-9_-]+):\s*(.+)$/);
      if (kv && !['met', 'disciplineFactor', 'discipline', 'intensityTier'].includes(kv[1])) {
        lines.push(`metrics.${kv[1]}: ${kv[2].trim()}`);
      }
    }

    const prefix = m.startsWith('\n') ? '\n' : '';
    const suffix = m.endsWith('\n') && lines.length > 0 ? eol : '';
    return prefix + lines.join(eol) + suffix;
  });

  // 3. Map non-canonical discipline: weightlifting -> strength
  fm = fm.replace(/^discipline:\s*(['"]?)weightlifting\1/gm, 'discipline: $1strength$1');

  return `---${eol}${fm}${eol}---${rest}`;
}

export function findMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== '.worktrees') {
        files.push(...findMarkdownFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

export function migrateRepo(repoDir: string, options: MigrateOptions = {}): { total: number; changed: number } {
  const mdDir = existsSync(join(repoDir, 'markdown')) ? join(repoDir, 'markdown') : repoDir;
  const files = findMarkdownFiles(mdDir);
  let changed = 0;

  for (const file of files) {
    const original = readFileSync(file, 'utf8');
    const migrated = migrateMarkdownContent(original, file);
    if (migrated !== original) {
      changed++;
      if (!options.dryRun) {
        writeFileSync(file, migrated, 'utf8');
      }
    }
  }

  if (options.build && !options.dryRun && changed > 0) {
    const pkgPath = join(repoDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const buildCmd = pkg.scripts?.['generate:seed']
        ? 'bun run generate:seed'
        : pkg.scripts?.build
          ? 'bun run build'
          : null;
      if (buildCmd) {
        console.log(`[build] Running "${buildCmd}" in ${repoDir}...`);
        execSync(buildCmd, { cwd: repoDir, stdio: 'inherit' });
      }
    }
  }

  return { total: files.length, changed };
}

function discoverSiblingRepos(): string[] {
  const parent = resolve(import.meta.dirname, '..', '..');
  const dirs: string[] = [];
  try {
    for (const name of readdirSync(parent)) {
      if (!name.startsWith('wod-wiki') || name.includes('__worktrees')) continue;
      const full = join(parent, name);
      if (existsSync(join(full, 'markdown'))) {
        dirs.push(full);
      }
    }
  } catch {}
  return dirs.sort();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const build = args.includes('--build');
  const all = args.includes('--all');
  const targets = args.filter((a) => !a.startsWith('--'));

  const reposToProcess = all || targets.length === 0
    ? (targets.length === 0 && !all ? [resolve(import.meta.dirname, '..')] : discoverSiblingRepos())
    : targets.map((t) => resolve(process.cwd(), t));

  console.log(`[migrate-seed] ${dryRun ? '(dry-run) ' : ''}Scanning ${reposToProcess.length} repo(s)...`);

  for (const repo of reposToProcess) {
    const { total, changed } = migrateRepo(repo, { dryRun, build });
    console.log(`[migrate-seed] ${repo}: ${changed}/${total} markdown file(s) ${dryRun ? 'need changes' : 'updated'}.`);
  }
}
