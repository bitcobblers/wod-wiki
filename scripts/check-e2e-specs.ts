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
 * 6. Every `e2e/live-app/*.e2e.ts` without `// spec:` must be explicitly listed
 *    in `LEGACY_UNPAIRED_E2E_FILES`, and stale/migrated allowlist entries fail
 *    so the allowlist only ratchets down.
 * 7. Every Markdown spec declaring `mobile-375` in `viewports` must EITHER have
 *    its `specFile` matched in `playwright.journal.config.ts`'s
 *    `journal-mobile-375` project OR explicitly exercise a `375` mobile viewport
 *    (`setViewportSize` with `width: 375` / `375`) in its paired `.e2e.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

export interface SpecValidationIssue {
  file: string;
  message: string;
}

export interface SpecCrosswalkOptions {
  legacyUnpairedFiles?: ReadonlySet<string>;
}

/**
 * Ratchet allowlist of pre-existing `e2e/live-app/*.e2e.ts` files that predate
 * the two-level Markdown <-> Playwright contract. New `.e2e.ts` files MUST carry
 * `// spec: e2e/specs/<domain>/<journey>.md`; deleting or migrating any file
 * below requires removing it from this set.
 */
export const LEGACY_UNPAIRED_E2E_FILES: ReadonlySet<string> = new Set([
  'e2e/live-app/canvas-editor-frontmatter.e2e.ts',
  'e2e/live-app/clock-command-board.e2e.ts',
  'e2e/live-app/codemirror-wod-editing.e2e.ts',
  'e2e/live-app/cold-boot.e2e.ts',
  'e2e/live-app/error-states.e2e.ts',
  'e2e/live-app/explore-navigation.e2e.ts',
  'e2e/live-app/folding-zones.e2e.ts',
  'e2e/live-app/nav-ladder.e2e.ts',
  'e2e/live-app/new-entry-combo.e2e.ts',
  'e2e/live-app/note-editor-navigation.e2e.ts',
  'e2e/live-app/note-reference-metrics.e2e.ts',
  'e2e/live-app/notebook-dated-item.e2e.ts',
  'e2e/live-app/page-placement.e2e.ts',
  'e2e/live-app/page-query-settings.e2e.ts',
  'e2e/live-app/playground-full-integration.e2e.ts',
  'e2e/live-app/playground-widget-block-preview.e2e.ts',
  'e2e/live-app/properties-a11y.e2e.ts',
  'e2e/live-app/property-responsive-defects.e2e.ts',
  'e2e/live-app/results-widget-inlay.e2e.ts',
  'e2e/live-app/storage-restore-ui.e2e.ts',
  'e2e/live-app/tags-page.e2e.ts',
  'e2e/live-app/timer-tiers.e2e.ts',
  'e2e/live-app/widget-edit-behavior.e2e.ts',
  'e2e/live-app/wql-segment-editor.e2e.ts',
]);

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

function stripTsComments(source: string): string {
  return source.replace(
    /(['"`])(?:\\.|(?!\1)[\s\S])*?\1|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match, quote) => (quote ? match : ' '),
  );
}

function extractStringLiterals(snippet: string): string[] {
  const out: string[] = [];
  const re = /(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    out.push(m[2]!);
  }
  return out;
}

function globMatchesSpecFile(pattern: string, specFile: string): boolean {
  const normalizedSpec = specFile.replace(/^\.\//, '');
  const relFromE2e = normalizedSpec.replace(/^e2e\//, '');
  const normalizedPattern = pattern.replace(/^\.\//, '');
  if (normalizedPattern === normalizedSpec || normalizedPattern === relFromE2e) {
    return true;
  }
  const regexSrc =
    '^' +
    normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.+/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*') +
    '$';
  const regex = new RegExp(regexSrc);
  return regex.test(normalizedSpec) || regex.test(relFromE2e);
}

function exercisesInlineMobile375(tsCodeWithoutComments: string): boolean {
  if (!/\bsetViewportSize\s*\(/.test(tsCodeWithoutComments)) return false;
  return (
    /\bwidth\s*:\s*375\b/.test(tsCodeWithoutComments) ||
    /\bsetViewportSize\s*\([^)]*\b375\b/.test(tsCodeWithoutComments)
  );
}

function isMatchedInJournalMobile375Project(
  repoRoot: string,
  specFile: string,
  tsCodeWithoutComments: string,
): boolean {
  const configPath = join(repoRoot, 'playwright.journal.config.ts');
  if (!existsSync(configPath)) return false;
  const configCode = stripTsComments(readFileSync(configPath, 'utf8'));

  const projectIdx = configCode.search(/name\s*:\s*['"]journal-mobile-375['"]/);
  if (projectIdx === -1) return false;

  let openIdx = projectIdx;
  while (openIdx > 0 && configCode[openIdx] !== '{') openIdx--;
  let depth = 0;
  let closeIdx = configCode.length;
  for (let i = openIdx; i < configCode.length; i++) {
    if (configCode[i] === '{') depth++;
    else if (configCode[i] === '}') {
      depth--;
      if (depth === 0) {
        closeIdx = i + 1;
        break;
      }
    }
  }

  const projectBlock = configCode.slice(openIdx, closeIdx);
  const testMatchM = projectBlock.match(
    /testMatch\s*:\s*(\[[\s\S]*?\]|['"][^'"]+['"]|[A-Za-z0-9_$]+\s*\([^)]*\)|[A-Za-z0-9_$]+)/,
  );
  if (!testMatchM) return false;

  const testMatchExpr = testMatchM[1]!;
  const candidatePatterns: string[] = [...extractStringLiterals(testMatchExpr)];

  const usesHelper = /\bresolveMobile375TestMatch\s*\(/.test(testMatchExpr);
  const usesExplicitList =
    usesHelper || /\bMOBILE_375_LEVEL2_SPECS\b/.test(testMatchExpr);

  if (usesExplicitList) {
    const explicitArrM = configCode.match(
      /\bMOBILE_375_LEVEL2_SPECS\b[^=]*=\s*\[([\s\S]*?)\]/,
    );
    if (explicitArrM) {
      for (const entry of extractStringLiterals(explicitArrM[1]!)) {
        candidatePatterns.push(entry);
        candidatePatterns.push(`**/${entry.replace(/^e2e\//, '')}`);
      }
    }
  }

  if (candidatePatterns.some((pat) => globMatchesSpecFile(pat, specFile))) {
    return true;
  }

  if (
    usesHelper &&
    /\bfunction\s+resolveMobile375TestMatch\b/.test(configCode) &&
    !exercisesInlineMobile375(tsCodeWithoutComments) &&
    /\bviewportSize\s*\(\s*\)/.test(tsCodeWithoutComments)
  ) {
    return true;
  }

  return false;
}

export function validateE2eSpecCrosswalk(
  repoRoot: string,
  options?: SpecCrosswalkOptions,
): SpecValidationIssue[] {
  const issues: SpecValidationIssue[] = [];
  const legacyUnpaired = options?.legacyUnpairedFiles ?? LEGACY_UNPAIRED_E2E_FILES;
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

    const parsedViewports = fm.viewports ? parseBracketList(fm.viewports) : null;
    if (parsedViewports?.includes('mobile-375')) {
      const tsCodeWithoutComments = stripTsComments(tsRaw);
      const hasInline375 = exercisesInlineMobile375(tsCodeWithoutComments);
      const inMobileProject = isMatchedInJournalMobile375Project(
        repoRoot,
        specFile,
        tsCodeWithoutComments,
      );
      if (!hasInline375 && !inMobileProject) {
        issues.push({
          file: relMd,
          message: `Declares 'mobile-375' in 'viewports:', but '${specFile}' is neither matched by 'journal-mobile-375' in playwright.journal.config.ts nor exercises a 375 mobile viewport via setViewportSize({ width: 375, ... })`,
        });
      }
    }
  }

  const seenLiveAppFiles = new Set<string>();
  for (const absTs of walkFiles(liveAppDir, '.e2e.ts')) {
    const relTs = relative(repoRoot, absTs).replace(/\\/g, '/');
    seenLiveAppFiles.add(relTs);
    const tsRaw = readFileSync(absTs, 'utf8');
    const headerMatch = tsRaw.match(/^\/\/\s*spec:\s*(\S+)/m);
    if (!headerMatch) {
      if (!legacyUnpaired.has(relTs)) {
        issues.push({
          file: relTs,
          message:
            "Missing '// spec: e2e/specs/<domain>/<journey>.md' header comment (unpaired E2E specs are not allowed outside LEGACY_UNPAIRED_E2E_FILES)",
        });
      }
      continue;
    }
    if (legacyUnpaired.has(relTs)) {
      issues.push({
        file: relTs,
        message:
          "File now carries '// spec:' header — remove it from LEGACY_UNPAIRED_E2E_FILES so the allowlist ratchets down",
      });
    }
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

  for (const allowlisted of legacyUnpaired) {
    if (!seenLiveAppFiles.has(allowlisted)) {
      issues.push({
        file: allowlisted,
        message:
          'Stale LEGACY_UNPAIRED_E2E_FILES entry — file no longer exists on disk; remove it so the allowlist ratchets down',
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
  process.stdout.write(`[check-e2e-specs] Verified ${count} two-level Markdown <-> Playwright journey pair(s).\n`);
}
