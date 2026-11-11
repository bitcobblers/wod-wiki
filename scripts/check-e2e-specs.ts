/**
 * Bidirectional integrity gate (`spec-lint`) between Level-1 Markdown journey
 * specifications (`e2e/specs/<domain>/<journey>.md`) and Level-2 Playwright
 * scripts (`e2e/live-app/<journey>.e2e.ts`).
 *
 * Enforces the contract from `.whiteboards/playground-e2e-user-journeys.json`:
 * 1. Every `e2e/specs/**\/*.md` (excluding README.md) carries YAML frontmatter
 *    with `domain`, `specFile`, `routes`, `personas`, `viewports`, and `priority`.
 * 2. Every Markdown spec defines at least one `### Scenario` heading, a `Given`
 *    precondition line, numbered user steps, and `- expect:` outcome bullets.
 * 3. Every referenced `specFile` exists and starts with `// spec: <relMdPath>`.
 * 4. Every `.e2e.ts` carrying `// spec: <relMdPath>` points to an existing
 *    Markdown spec that maps back to it 1:1.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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

    const specFile = fm.specFile;
    if (!specFile) continue;

    if (!/^###\s+Scenario\b/m.test(raw)) {
      issues.push({ file: relMd, message: 'Must contain at least one `### Scenario ...` heading' });
    }
    if (!/^Given\s+/m.test(raw)) {
      issues.push({ file: relMd, message: 'Must contain a `Given <world setup>:` precondition line' });
    }
    if (!/^\d+\.\s+/m.test(raw)) {
      issues.push({ file: relMd, message: 'Must contain numbered user steps (`1. ...`)' });
    }
    if (!/^\s*-\s*expect:/m.test(raw)) {
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
