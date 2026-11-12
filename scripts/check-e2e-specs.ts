/**
 * Bidirectional integrity gate (`spec-lint`) between Level-1 Markdown journey
 * specifications (`e2e/specs/<domain>/<journey>.md`) and Level-2 Playwright
 * scripts (`e2e/live-app/<journey>.e2e.ts`).
 *
 * Enforces the contract from `.whiteboards/playground-e2e-user-journeys.json`:
 * 1. Every `e2e/specs/<domain>/<journey>.md` (excluding README.md) carries YAML frontmatter
 *    with `domain`, `specFile`, `routes`, `personas`, `viewports`, and `priority`.
 * 2. Enum and format checks:
 *    - `domain` matches folder name and is one of the 6 canonical domains.
 *    - `priority` is in `{P0-gate, P1-core, P1, P2}`.
 *    - `routes`, `personas`, and `viewports` use YAML bracketed array syntax `[...]`.
 *    - `viewports` entries belong to `{desktop, mobile-375, cold-boot, dark}`.
 * 3. Every Markdown spec defines a top-level `# ...` H1 heading, at least one
 *    `### Scenario` heading, a `Given` precondition line, numbered user steps,
 *    and `- expect:` outcome bullets.
 * 4. Every referenced `specFile` exists and starts with `// spec: <relMdPath>`.
 * 5. Every `.e2e.ts` carrying `// spec: <relMdPath>` points to an existing
 *    Markdown spec that maps back to it 1:1.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

export interface SpecValidationIssue {
  file: string;
  message: string;
}

const REQUIRED_FRONTMATTER_KEYS = [
  'domain',
  'specFile',
  'routes',
  'personas',
  'viewports',
  'priority',
] as const;

const ALLOWED_DOMAINS = new Set([
  'journal',
  'notebooks',
  'runtime',
  'properties',
  'analytics',
  'feeds',
]);

const ALLOWED_PRIORITIES = new Set([
  'P0-gate',
  'P1-core',
  'P1',
  'P2',
]);

const ALLOWED_VIEWPORTS = new Set([
  'desktop',
  'mobile-375',
  'cold-boot',
  'dark',
]);

const BRACKET_LIST_KEYS = ['routes', 'personas', 'viewports'] as const;

function walkFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full, suffix));
    } else if (entry.endsWith(suffix)) {
      results.push(full);
    }
  }
  return results.sort();
}

function extractFrontmatter(raw: string): Record<string, string> | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (kv) {
      out[kv[1]!] = kv[2]!.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

function parseBracketList(rawVal: string): string[] | null {
  const trimmed = rawVal.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

export function validateE2eSpecCrosswalk(repoRoot: string): SpecValidationIssue[] {
  const issues: SpecValidationIssue[] = [];
  const specsDir = join(repoRoot, 'e2e/specs');
  const liveAppDir = join(repoRoot, 'e2e/live-app');

  const mdFiles = walkFiles(specsDir, '.md').filter((f) => !f.endsWith('/README.md'));
  const mdToTs = new Map<string, string>();

  for (const absMd of mdFiles) {
    const relMd = relative(repoRoot, absMd).replace(/\\/g, '/');
    const raw = readFileSync(absMd, 'utf8');
    const fm = extractFrontmatter(raw);
    if (!fm) {
      issues.push({ file: relMd, message: 'Missing YAML frontmatter block (`--- ... ---`)' });
      continue;
    }

    for (const key of REQUIRED_FRONTMATTER_KEYS) {
      if (!fm[key]) {
        issues.push({ file: relMd, message: `Missing required frontmatter key '${key}:'` });
      }
    }

    if (fm.domain) {
      if (!ALLOWED_DOMAINS.has(fm.domain)) {
        issues.push({
          file: relMd,
          message: `Invalid frontmatter domain '${fm.domain}' (expected one of: ${[...ALLOWED_DOMAINS].join(', ')})`,
        });
      }
      const folderDomain = basename(dirname(absMd));
      if (folderDomain !== 'specs' && fm.domain !== folderDomain) {
        issues.push({
          file: relMd,
          message: `Frontmatter domain '${fm.domain}' does not match parent folder '${folderDomain}'`,
        });
      }
    }

    if (fm.priority && !ALLOWED_PRIORITIES.has(fm.priority)) {
      issues.push({
        file: relMd,
        message: `Invalid frontmatter priority '${fm.priority}' (expected one of: ${[...ALLOWED_PRIORITIES].join(', ')})`,
      });
    }

    for (const listKey of BRACKET_LIST_KEYS) {
      const rawVal = fm[listKey];
      if (!rawVal) continue;
      const parsed = parseBracketList(rawVal);
      if (!parsed || parsed.length === 0) {
        issues.push({
          file: relMd,
          message: `Frontmatter '${listKey}:' must be a non-empty bracketed list (e.g. [item1, item2])`,
        });
      } else if (listKey === 'viewports') {
        for (const vp of parsed) {
          if (!ALLOWED_VIEWPORTS.has(vp)) {
            issues.push({
              file: relMd,
              message: `Invalid viewport token '${vp}' in 'viewports:' (expected one of: ${[...ALLOWED_VIEWPORTS].join(', ')})`,
            });
          }
        }
      }
    }

    const specFile = fm.specFile;
    if (!specFile) continue;

    const bodyWithoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    if (!/^#\s+\S/m.test(bodyWithoutFrontmatter)) {
      issues.push({ file: relMd, message: 'Must contain a top-level `# <ID> — <Title>` H1 heading' });
    }
    if (!/^###\s+Scenario\b/m.test(bodyWithoutFrontmatter)) {
      issues.push({ file: relMd, message: 'Must contain at least one `### Scenario ...` heading' });
    }
    if (!/^Given\s+/m.test(bodyWithoutFrontmatter)) {
      issues.push({ file: relMd, message: 'Must contain a `Given <world setup>:` precondition line' });
    }
    if (!/^\d+\.\s+/m.test(bodyWithoutFrontmatter)) {
      issues.push({ file: relMd, message: 'Must contain numbered user steps (`1. ...`)' });
    }
    if (!/^\s*-\s*expect:/m.test(bodyWithoutFrontmatter)) {
      issues.push({ file: relMd, message: 'Must contain at least one `- expect:` outcome assertion' });
    }

    const absTs = join(repoRoot, specFile);
    if (!existsSync(absTs)) {
      issues.push({ file: relMd, message: `Referenced specFile '${specFile}' does not exist` });
      continue;
    }

    mdToTs.set(relMd, specFile);
    const tsRaw = readFileSync(absTs, 'utf8');
    const headerMatch = tsRaw.match(/^\/\/\s*spec:\s*(\S+)/m);
    if (!headerMatch) {
      issues.push({ file: specFile, message: `Missing '// spec: ${relMd}' header comment` });
    } else if (headerMatch[1] !== relMd) {
      issues.push({
        file: specFile,
        message: `Header '// spec: ${headerMatch[1]}' does not match '${relMd}'`,
      });
    }
  }

  for (const absTs of walkFiles(liveAppDir, '.e2e.ts')) {
    const relTs = relative(repoRoot, absTs).replace(/\\/g, '/');
    const tsRaw = readFileSync(absTs, 'utf8');
    const headerMatch = tsRaw.match(/^\/\/\s*spec:\s*(\S+)/m);
    if (!headerMatch) continue;
    const targetMd = headerMatch[1]!;
    const absMd = join(repoRoot, targetMd);
    if (!existsSync(absMd)) {
      issues.push({ file: relTs, message: `Header '// spec: ${targetMd}' points to missing Markdown spec` });
      continue;
    }
    const mappedTs = mdToTs.get(targetMd);
    if (mappedTs && mappedTs !== relTs) {
      issues.push({
        file: relTs,
        message: `Markdown spec '${targetMd}' maps to '${mappedTs}', not '${relTs}'`,
      });
    }
  }

  return issues;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..');
  const issues = validateE2eSpecCrosswalk(root);
  if (issues.length > 0) {
    console.error('[check-e2e-specs] Spec crosswalk validation failed:');
    for (const issue of issues) {
      console.error(`  - ${issue.file}: ${issue.message}`);
    }
    process.exit(1);
  }
  const count = walkFiles(join(root, 'e2e/specs'), '.md').filter((f) => !f.endsWith('/README.md')).length;
  console.log(`[check-e2e-specs] Verified ${count} two-level Markdown <-> Playwright journey pair(s).`);
}
