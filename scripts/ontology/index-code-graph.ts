#!/usr/bin/env bun
/**
 * Code Graph + QA + Bridge Indexer
 *
 * Scans:
 *  - packages/ & apps/playground/ (TypeScript files & exported symbols -> :code)
 *  - apps/playground/src/lib/testIds.ts (TEST_IDS -> code:TestId)
 *  - apps/playground/src/lib/routes.ts (ROUTE_PATTERNS -> code:Route)
 *  - packages/engine/src/agent/manifest.ts (DOMAIN_AGENT_TOOLS -> code:WebMcpTool)
 *  - e2e/specs/** and e2e/live-app/** (:qa Journeys, 5-beat chains, :bridge links)
 *  - docs/qa-walkthrough/findings.json (if present -> :qa Issues/Runs, :bridge rootCause)
 *
 * Emits:
 *  - ontology/generated/code-graph.ttl
 *  - ontology/generated/qa-instances.ttl
 *  - ontology/generated/bridge-instances.ttl
 *  - ontology/generated/unified-dataset.trig
 */
import fs from 'fs';
import path from 'path';
import { TEST_IDS } from '../../apps/playground/src/lib/testIds';
import { ROUTE_PATTERNS } from '../../apps/playground/src/lib/routes';

interface ExtractedTool {
  name: string;
  title: string;
  domain: string;
  tier: number;
  cliEquivalent: string;
  relPath: string;
}

function extractAgentTools(): ExtractedTool[] {
  const toolsDir = path.join(REPO_ROOT, 'packages/engine/src/agent/tools');
  const tools: ExtractedTool[] = [];
  if (!fs.existsSync(toolsDir)) return tools;
  for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith('.ts')).sort()) {
    const abs = path.join(toolsDir, file);
    const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    const blocks = src.split(/defineAgentTool\s*\(/).slice(1);
    for (const block of blocks) {
      const head = block.slice(0, 1200);
      const name = head.match(/\bname:\s*['"]([a-z0-9_]+)['"]/)?.[1];
      const title = head.match(/\btitle:\s*['"]([^'"]+)['"]/)?.[1];
      const domain = head.match(/\bdomain:\s*['"]([^'"]+)['"]/)?.[1];
      const tier = head.match(/\btier:\s*(\d+)/)?.[1];
      const cliEquivalent = head.match(/\bcliEquivalent:\s*['"]([^'"]+)['"]/)?.[1];
      if (name && title && domain && tier !== undefined) {
        tools.push({
          name,
          title,
          domain,
          tier: Number(tier),
          cliEquivalent: cliEquivalent ?? `wod ${name.replace(/^wod_/, '').replace(/_/g, ' ')} --json`,
          relPath: rel,
        });
      }
    }
  }
  return tools;
}

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const GENERATED_DIR = path.join(REPO_ROOT, 'ontology/generated');

const PREFIXES = `
@prefix wod:    <https://wod.wiki/ontology#> .
@prefix ufo:    <https://wod.wiki/ontology/patterns#> .
@prefix qa:     <https://wod.wiki/ontology/qa#> .
@prefix code:   <https://wod.wiki/ontology/code#> .
@prefix bridge: <https://wod.wiki/ontology/bridge#> .
@prefix owl:    <http://www.w3.org/2002/07/owl#> .
@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix prov:   <http://www.w3.org/ns/prov#> .
`.trim();

function esc(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function encodeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._~/-]/g, '_');
}

function fileIri(relPath: string): string {
  return `<https://wod.wiki/code/file/${encodeSegment(relPath)}>`;
}

function symbolIri(relPath: string, symbolName: string): string {
  return `<https://wod.wiki/code/symbol/${encodeSegment(relPath)}#${encodeSegment(symbolName)}>`;
}

function testIdIri(val: string): string {
  return `<https://wod.wiki/code/testid/${encodeSegment(val)}>`;
}

function routeIri(pattern: string): string {
  const clean = pattern.replace(/^\//, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'root';
  return `<https://wod.wiki/code/route/${clean}>`;
}

function toolIri(name: string): string {
  return `<https://wod.wiki/code/tool/${encodeSegment(name)}>`;
}

function storyIri(storyId: string): string {
  return `<https://wod.wiki/code/story/${encodeSegment(storyId)}>`;
}

function storyTestIri(storyId: string): string {
  return `<https://wod.wiki/qa/story/${encodeSegment(storyId)}>`;
}

function storyBeatIri(storyId: string, beatName: string): string {
  return `<https://wod.wiki/qa/story/${encodeSegment(storyId)}/beat/${beatName}>`;
}

const DOMAIN_STATE_NOUNS: Record<string, string[]> = {
  empty: [],
  populatedJournal: ['wod:Note', 'wod:Notebook', 'wod:Page', 'wod:PageNote', 'wod:Session', 'wod:Effort', 'wod:Equipment', 'wod:Tag'],
  activeSession: ['wod:Session', 'wod:SessionRun', 'wod:Note', 'wod:Effort'],
  scopedPropertyOverride: ['wod:FieldValue', 'wod:Effort', 'wod:Equipment', 'wod:Note'],
  skippedDependencyDiagnostic: ['wod:Session', 'wod:Note', 'wod:EventRecord'],
  readOnlyFeedNote: ['wod:Feed', 'wod:Note', 'wod:Notebook'],
};

function sanitizeStorySlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toStorybookId(title: string, exportName: string): string {
  const spacedName = exportName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return `${sanitizeStorySlug(title)}--${sanitizeStorySlug(spacedName)}`;
}

function domainIri(domain: string): string {
  return `<https://wod.wiki/qa/domain/${encodeSegment(domain)}>`;
}

function journeyIri(id: string): string {
  return `<https://wod.wiki/qa/journey/${encodeSegment(id)}>`;
}

function beatIri(journeyId: string, beatName: string): string {
  return `<https://wod.wiki/qa/journey/${encodeSegment(journeyId)}/beat/${beatName}>`;
}

function issueIri(id: string): string {
  return `<https://wod.wiki/qa/issue/${encodeSegment(id)}>`;
}

function runIri(id: string): string {
  return `<https://wod.wiki/qa/run/${encodeSegment(id)}>`;
}

function walkFiles(dir: string, exts: Set<string>, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', '.git', 'storybook-static', 'generated'].includes(entry.name)) {
        continue;
      }
      walkFiles(full, exts, out);
    } else if (entry.isFile() && exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

interface ExtractedSymbol {
  name: string;
  kind: 'class' | 'interface' | 'function' | 'const' | 'type';
  lineHint: number;
  relPath: string;
}

function extractSymbols(relPath: string, content: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(class|interface|function|const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/,
    );
    if (match) {
      const kind = match[1] as ExtractedSymbol['kind'];
      const name = match[2];
      if (!seen.has(name)) {
        seen.add(name);
        symbols.push({ name, kind, lineHint: i + 1, relPath });
      }
    }
  }
  return symbols;
}

function flattenTestIds(
  obj: Record<string, unknown>,
  prefix = '',
  out: Array<{ key: string; value: string }> = [],
): Array<{ key: string; value: string }> {
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out.push({ key: fullKey, value: v });
    } else if (v && typeof v === 'object') {
      flattenTestIds(v as Record<string, unknown>, fullKey, out);
    }
  }
  return out;
}

interface ParsedSpec {
  id: string;
  slug: string;
  title: string;
  domain: string;
  specPath: string;
  playwrightSpec: string;
  routes: string[];
  personas: string[];
  viewports: string[];
  priority: string;
  summary: string;
  testIds: string[];
  seedNouns: string[];
  stories: string[];
  scenarios: string[];
}

const DOMAIN_CLASS_HINTS: Array<{ pattern: RegExp; wodClass: string }> = [
  { pattern: /\b(Note|notes?|daily note|journal)\b/i, wodClass: 'wod:Note' },
  { pattern: /\b(Notebook|notebooks?)\b/i, wodClass: 'wod:Notebook' },
  { pattern: /\b(Page|pages?|guide)\b/i, wodClass: 'wod:Page' },
  { pattern: /\b(Session|workout|timer|run|FastClock)\b/i, wodClass: 'wod:Session' },
  { pattern: /\b(EventRecord|events?)\b/i, wodClass: 'wod:EventRecord' },
  { pattern: /\b(Metric|metrics?)\b/i, wodClass: 'wod:Metric' },
  { pattern: /\b(Effort|efforts?)\b/i, wodClass: 'wod:Effort' },
  { pattern: /\b(Equipment|equipment)\b/i, wodClass: 'wod:Equipment' },
  { pattern: /\b(Tag|tags?)\b/i, wodClass: 'wod:Tag' },
  { pattern: /\b(Dashboard|dashboards?|widget)\b/i, wodClass: 'wod:Dashboard' },
  { pattern: /\b(Feed|feeds?|subscription|autosync)\b/i, wodClass: 'wod:Feed' },
  { pattern: /\b(Property|properties|override)\b/i, wodClass: 'wod:FieldValue' },
  { pattern: /\b(WQL|query|stream)\b/i, wodClass: 'wod:Query' },
  { pattern: /\b(Attachment|zip|bundle)\b/i, wodClass: 'wod:Attachment' },
];

function parseFrontmatter(md: string): { meta: Record<string, string | string[]>; body: string } {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: md };
  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (!kv) continue;
    const [, k, rawV] = kv;
    const v = rawV.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      meta[k] = v;
    }
  }
  return { meta, body: match[2] };
}

function parseE2eSpec(filePath: string, knownTestIdValues: Set<string>): ParsedSpec | null {
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  if (path.basename(filePath).toLowerCase() === 'readme.md') return null;

  const raw = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const h1Match = body.match(/^#\s+([A-Z]+-\d+)\s+[—-]\s+(.+)$/m);
  const id = h1Match?.[1] ?? path.basename(filePath, '.md').toUpperCase();
  const title = h1Match?.[2]?.trim() ?? path.basename(filePath, '.md');
  const slug = path.basename(filePath, '.md');

  const scenarios = [...body.matchAll(/^###\s+Scenario\s+\d+:\s+(.+)$/gm)].map((m) => m[1].trim());
  const summaryLines = body
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('Given ') && !/^\d+\./.test(l.trim()) && !l.startsWith('- expect:'));

  // Extract referenced test IDs from backticks in the spec
  const referencedTestIds = new Set<string>();
  for (const m of body.matchAll(/`([a-z0-9-]+)`/g)) {
    if (knownTestIdValues.has(m[1])) {
      referencedTestIds.add(m[1]);
    }
  }

  // Infer seed nouns + explicit frontmatter seedNouns
  const seedNouns = new Set<string>();
  const explicitSeedNouns = Array.isArray(meta.seedNouns)
    ? meta.seedNouns
    : typeof meta.seedNouns === 'string'
      ? [meta.seedNouns]
      : [];
  for (const sn of explicitSeedNouns) {
    if (sn) seedNouns.add(sn);
  }
  for (const hint of DOMAIN_CLASS_HINTS) {
    if (hint.pattern.test(body)) {
      seedNouns.add(hint.wodClass);
    }
  }

  const stories = Array.isArray(meta.stories) ? meta.stories : typeof meta.stories === 'string' ? [meta.stories] : [];
  const routes = Array.isArray(meta.routes) ? meta.routes : typeof meta.routes === 'string' ? [meta.routes] : [];
  const personas = Array.isArray(meta.personas) ? meta.personas : typeof meta.personas === 'string' ? [meta.personas] : [];
  const viewports = Array.isArray(meta.viewports)
    ? meta.viewports
    : typeof meta.viewports === 'string'
      ? [meta.viewports]
      : [];

  return {
    id,
    slug,
    title,
    domain: typeof meta.domain === 'string' ? meta.domain : path.basename(path.dirname(filePath)),
    specPath: rel,
    playwrightSpec: typeof meta.specFile === 'string' ? meta.specFile : `e2e/live-app/${slug}.e2e.ts`,
    routes,
    personas,
    viewports,
    priority: typeof meta.priority === 'string' ? meta.priority : 'P1',
    summary: summaryLines[0]?.trim() ?? title,
    testIds: [...referencedTestIds].sort(),
    seedNouns: [...seedNouns].sort(),
    stories,
    scenarios,
  };
}

export async function buildUnifiedGraph() {
  const codeLines: string[] = [PREFIXES, '', '# === :code — SCIP-style Files, Symbols, TestIds, Routes, WebMCP Tools ===', ''];
  const qaLines: string[] = [PREFIXES, '', '# === :qa — Domains, Journeys, 5-Beat Chains, Issues, Runs ===', ''];
  const bridgeLines: string[] = [PREFIXES, '', '# === :bridge — Cross-graph Links (:qa <-> :code <-> :domain) ===', ''];

  const flatTestIds = flattenTestIds(TEST_IDS as unknown as Record<string, unknown>);
  const testIdMap = new Map(flatTestIds.map((t) => [t.key, t.value]));
  const knownTestIdValues = new Set(flatTestIds.map((t) => t.value));

  // 1. Index Files & Symbols in packages/, apps/playground/, e2e/
  const sourceRoots = ['packages', 'apps/playground/app', 'apps/playground/src', 'e2e'];
  const allCodeFiles: string[] = [];
  for (const root of sourceRoots) {
    walkFiles(path.join(REPO_ROOT, root), new Set(['.ts', '.tsx', '.md']), allCodeFiles);
  }

  const symbolIndexByName = new Map<string, ExtractedSymbol[]>();
  const fileLineCounts = new Map<string, number>();

  for (const abs of allCodeFiles) {
    const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
    const isTest = /\.(test|spec)\.(ts|tsx)$/.test(rel) || rel.includes('/__tests__/');
    const isSpecMd = rel.startsWith('e2e/specs/') && rel.endsWith('.md');
    const isE2eTs = rel.startsWith('e2e/live-app/') && rel.endsWith('.e2e.ts');
    const pkgMatch = rel.match(/^(packages\/[^/]+|apps\/[^/]+|e2e)/);
    const area = pkgMatch ? pkgMatch[1] : 'repo';

    const fIri = fileIri(rel);
    codeLines.push(
      `${fIri} a code:File ;`,
      `    rdfs:label "${esc(path.basename(rel))}" ;`,
      `    code:filePath "${esc(rel)}" ;`,
      `    code:packageName "${esc(area)}" ;`,
      `    code:isTestFile ${isTest || isE2eTs} .`,
      '',
    );

    if (rel.endsWith('.ts') || rel.endsWith('.tsx')) {
      const content = fs.readFileSync(abs, 'utf8');
      fileLineCounts.set(rel, content.split(/\r?\n/).length);
      if (!isTest) {
        const syms = extractSymbols(rel, content);
        for (const sym of syms) {
          const sIri = symbolIri(rel, sym.name);
          codeLines.push(
            `${sIri} a code:Symbol ;`,
            `    rdfs:label "${esc(sym.name)}" ;`,
            `    code:symbolName "${esc(sym.name)}" ;`,
            `    code:scipId "${esc(rel + '#' + sym.name)}" ;`,
            `    code:symbolKind "${sym.kind}" ;`,
            `    code:definedIn ${fIri} ;`,
            `    code:lineHint ${sym.lineHint} .`,
            '',
          );
          const list = symbolIndexByName.get(sym.name) ?? [];
          list.push(sym);
          symbolIndexByName.set(sym.name, list);

          // Bridge: Symbol -> wod:Class if symbol name matches a domain class
          if (/^(Note|Notebook|Page|Session|SessionRun|SessionRecord|EventRecord|WorkoutEvent|Metric|MetricObservation|Effort|Equipment|Tag|Dashboard|Feed|Query|Attachment)$/.test(sym.name)) {
            bridgeLines.push(`${sIri} bridge:implementsDomainClass wod:${sym.name} .`);
          }
        }
        // Index TEST_IDS.* and literal data-testid usages in non-test source files
        const usedTestIds = new Set<string>();
        for (const m of content.matchAll(/\bTEST_IDS\.([A-Za-z0-9_.]+)/g)) {
          const val = testIdMap.get(m[1]);
          if (val) usedTestIds.add(val);
        }
        for (const m of content.matchAll(/data-testid=["']([^"']+)["']/g)) {
          if (knownTestIdValues.has(m[1])) {
            usedTestIds.add(m[1]);
          }
        }
        for (const val of usedTestIds) {
          codeLines.push(`${fIri} code:usesTestId ${testIdIri(val)} .`);
        }
      }
    }
    if (isSpecMd) {
      // Marked as spec file; linked from :bridge below
    }
  }

  // 2. Index TEST_IDS
  const testIdsFile = fileIri('apps/playground/src/lib/testIds.ts');
  for (const { key, value } of flatTestIds) {
    const tIri = testIdIri(value);
    codeLines.push(
      `${tIri} a code:TestId ;`,
      `    rdfs:label "${esc(value)}" ;`,
      `    code:testIdKey "${esc(key)}" ;`,
      `    code:testIdValue "${esc(value)}" ;`,
      `    code:definedIn ${testIdsFile} .`,
      '',
    );
  }

  // 3. Index ROUTE_PATTERNS
  const routesFile = fileIri('apps/playground/src/lib/routes.ts');
  const knownRoutes = new Set<string>();
  for (const [key, pattern] of Object.entries(ROUTE_PATTERNS)) {
    knownRoutes.add(pattern);
    const rIri = routeIri(pattern);
    codeLines.push(
      `${rIri} a code:Route ;`,
      `    rdfs:label "${esc(pattern)}" ;`,
      `    code:routeName "${esc(key)}" ;`,
      `    code:routePath "${esc(pattern)}" ;`,
      `    code:definedIn ${routesFile} .`,
      '',
    );
  }

  // 4. Index WebMCP / Domain Agent Tools
  const agentTools = extractAgentTools();
  for (const tool of agentTools) {
    const wIri = toolIri(tool.name);
    codeLines.push(
      `${wIri} a code:WebMcpTool ;`,
      `    rdfs:label "${esc(tool.name)}" ;`,
      `    code:toolName "${esc(tool.name)}" ;`,
      `    code:toolTitle "${esc(tool.title)}" ;`,
      `    code:toolDomain "${esc(tool.domain)}" ;`,
      `    code:toolTier ${tool.tier} ;`,
      `    code:cliEquivalent "${esc(tool.cliEquivalent)}" ;`,
      `    code:definedIn ${fileIri(tool.relPath)} .`,
      '',
    );
  }

  // 4b. Index Storybook Stories (apps/storybook/src/**/*.stories.tsx -> code:Story)
  interface IndexedStory {
    id: string;
    title: string;
    name: string;
    relPath: string;
    domainState?: string;
    componentName?: string;
    route?: string;
    hasPlay: boolean;
    testIds: string[];
    seedNouns: string[];
  }
  const storyFiles = walkFiles(path.join(REPO_ROOT, 'apps/storybook/src'), new Set(['.tsx', '.ts'])).filter((f) =>
    f.endsWith('.stories.tsx') || f.endsWith('.stories.ts'),
  );
  const indexedStories: IndexedStory[] = [];
  const knownStoryIds = new Set<string>();
  const storyIdsByRoute = new Map<string, string[]>();
  const storyIdsByFile = new Map<string, string[]>();

  for (const absStory of storyFiles) {
    const relPath = path.relative(REPO_ROOT, absStory).replace(/\\/g, '/');
    const content = fs.readFileSync(absStory, 'utf8');
    const titleMatch = content.match(/\btitle\s*:\s*['"]([^'"]+)['"]/);
    if (!titleMatch) continue;
    const storyTitle = titleMatch[1];
    const compMatch = content.match(/\bcomponent\s*:\s*([A-Z][A-Za-z0-9_]*)/);
    const componentName = compMatch?.[1];
    const defaultDomainState = content.match(/meta[\s\S]{0,600}?\bdomainState\s*:\s*['"]([A-Za-z0-9_-]+)['"]/)?.[1];

    // Match CSF3 `export const Foo: Story = ...` or `export const Foo = ...`
    const exportMatches = [...content.matchAll(/^export\s+const\s+([A-Za-z0-9_]+)\s*(?::\s*Story[^=]*)?=/gm)];
    for (let idx = 0; idx < exportMatches.length; idx++) {
      const m = exportMatches[idx];
      const exportName = m[1];
      if (exportName === 'default' || exportName === 'meta') continue;
      const startOffset = m.index ?? 0;
      const endOffset = idx + 1 < exportMatches.length ? (exportMatches[idx + 1].index ?? content.length) : content.length;
      const chunk = content.slice(startOffset, endOffset);
      const storyId = toStorybookId(storyTitle, exportName);
      if (knownStoryIds.has(storyId)) continue;
      knownStoryIds.add(storyId);

      const ds = chunk.match(/\bdomainState\s*:\s*['"]([A-Za-z0-9_-]+)['"]/)?.[1] ?? defaultDomainState;
      const storyRoute = chunk.match(/\broutePath\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? chunk.match(/\broute\s*:\s*['"]([^'"]+)['"]/)?.[1];
      const hasPlay = /\bplay\s*:\s*async\b/.test(chunk);

      // Extract per-story TEST_IDS and literal data-testid queries
      const storyTestIds = new Set<string>();
      for (const tidMatch of chunk.matchAll(/\bTEST_IDS\.([A-Za-z0-9_.]+)/g)) {
        const val = testIdMap.get(tidMatch[1]);
        if (val) storyTestIds.add(val);
      }
      for (const tidMatch of chunk.matchAll(/(?:getByTestId|queryByTestId|findByTestId|data-testid=)\(?['"]([a-z0-9-]+)['"]/g)) {
        if (knownTestIdValues.has(tidMatch[1])) storyTestIds.add(tidMatch[1]);
      }

      // Extract per-story seed nouns from DOMAIN_STATE_PRESETS + story text hints
      const storySeedNouns = new Set<string>(ds && DOMAIN_STATE_NOUNS[ds] ? DOMAIN_STATE_NOUNS[ds] : []);
      for (const hint of DOMAIN_CLASS_HINTS) {
        if (hint.pattern.test(`${storyTitle} ${componentName ?? ''} ${exportName}`)) {
          storySeedNouns.add(hint.wodClass);
        }
      }

      // Extract Drive actions & Prove assertions from play()
      const driveCalls = [...chunk.matchAll(/\b(?:userEvent|storyActions|fireEvent)\.([A-Za-z0-9_]+)/g)].map((x) => x[1]);
      const uniqueDrive = [...new Set(driveCalls)];
      const expectCount = (chunk.match(/\bexpect\s*\(/g) ?? []).length;

      indexedStories.push({
        id: storyId,
        title: storyTitle,
        name: exportName,
        relPath,
        domainState: ds,
        componentName,
        route: storyRoute,
        hasPlay,
        testIds: [...storyTestIds].sort(),
        seedNouns: [...storySeedNouns].sort(),
      });

      const sIri = storyIri(storyId);
      const stIri = storyTestIri(storyId);
      const compSyms = componentName ? (symbolIndexByName.get(componentName) ?? []) : [];
      const compSym = compSyms[0];

      codeLines.push(
        `${sIri} a code:Story ;`,
        `    rdfs:label "${esc(storyTitle + ' / ' + exportName)}" ;`,
        `    code:storyId "${esc(storyId)}" ;`,
        `    code:storyTitle "${esc(storyTitle)}" ;`,
        `    code:storyName "${esc(exportName)}" ;`,
        ...(ds ? [`    code:domainStatePreset "${esc(ds)}" ;`] : []),
        ...(compSym ? [`    code:storyComponent ${symbolIri(compSym.relPath, compSym.name)} ;`] : []),
        `    code:definedIn ${fileIri(relPath)} .`,
        '',
      );

      // Emit dedicated qa:StoryTest + 5-beat causal chain for this story
      const stBeats: Array<{ name: string; beatRef: string; desc: string; next?: string }> = [
        {
          name: 'Seed',
          beatRef: 'qa:Seed',
          desc: `Seed: ${ds ? `domainState=${ds}` : 'props/args'}${storySeedNouns.size ? ` (${[...storySeedNouns].join(', ')})` : ''}`,
          next: 'Enter',
        },
        {
          name: 'Enter',
          beatRef: 'qa:Enter',
          desc: `Enter: ${componentName ?? storyTitle}${storyRoute ? ` @ ${storyRoute}` : ''}`,
          next: 'Sense',
        },
        {
          name: 'Sense',
          beatRef: 'qa:Sense',
          desc: `Sense: ${storyTestIds.size ? [...storyTestIds].slice(0, 6).join(', ') : 'rendered DOM'}`,
          next: 'Drive',
        },
        {
          name: 'Drive',
          beatRef: 'qa:Drive',
          desc: `Drive: ${hasPlay ? (uniqueDrive.length ? uniqueDrive.join(', ') : 'play() mount') : 'static story render'}`,
          next: 'Prove',
        },
        {
          name: 'Prove',
          beatRef: 'qa:Prove',
          desc: `Prove: ${hasPlay ? `${expectCount} expect() assertion(s)` : 'visual/render baseline'}`,
        },
      ];

      qaLines.push(
        `${stIri} a qa:StoryTest ;`,
        `    rdfs:label "${esc(storyTitle + ' / ' + exportName)}" ;`,
        `    qa:hasPlayTest ${hasPlay ? 'true' : 'false'} ;`,
        `    qa:hasStep ${stBeats.map((b) => storyBeatIri(storyId, b.name)).join(', ')} .`,
        '',
      );

      for (let bi = 0; bi < stBeats.length; bi++) {
        const b = stBeats[bi];
        const bIri = storyBeatIri(storyId, b.name);
        qaLines.push(
          `${bIri} a qa:Step ;`,
          `    rdfs:label "${esc(b.desc)}" ;`,
          `    qa:hasBeat ${b.beatRef} ;`,
          `    qa:stepIndex ${bi + 1} ;`,
          `    qa:beatOrder ${bi + 1}${b.next ? ` ;\n    qa:nextStep ${storyBeatIri(storyId, b.next)}` : ''} .`,
          '',
        );
      }

      bridgeLines.push(`${stIri} bridge:story ${sIri} .`);
      bridgeLines.push(`${stIri} bridge:touches ${fileIri(relPath)} .`);
      if (compSym) {
        bridgeLines.push(`${stIri} bridge:touches ${fileIri(compSym.relPath)} .`);
      }
      if (storyRoute && knownRoutes.has(storyRoute)) {
        bridgeLines.push(`${stIri} bridge:route ${routeIri(storyRoute)} .`);
      }
      for (const tid of storyTestIds) {
        bridgeLines.push(`${stIri} bridge:testId ${testIdIri(tid)} .`);
      }
      for (const noun of storySeedNouns) {
        bridgeLines.push(`${stIri} bridge:seedNoun ${noun} .`);
        bridgeLines.push(`${noun} bridge:story ${sIri} .`);
      }
      if (storyRoute) {
        const list = storyIdsByRoute.get(storyRoute) ?? [];
        list.push(storyId);
        storyIdsByRoute.set(storyRoute, list);
      }
      const fList = storyIdsByFile.get(relPath) ?? [];
      fList.push(storyId);
      storyIdsByFile.set(relPath, fList);
    }
  }

  // 5. Index QA Domains & Journeys from e2e/specs/ + e2e/live-app/ (all 7 domains)
  const domains = new Set<string>(['journal', 'notebooks', 'runtime', 'properties', 'analytics', 'feeds', 'manual']);
  const domainToArea: Record<string, string> = {
    journal: 'apps/playground/app/pages',
    notebooks: 'apps/playground/app/views/stream',
    runtime: 'packages/engine/src/runtime',
    properties: 'apps/playground/app/pages',
    analytics: 'apps/playground/app/views/dashboards',
    feeds: 'apps/playground/app/services',
    manual: 'apps/playground/app/tour',
  };

  for (const dom of domains) {
    const dIri = domainIri(dom);
    qaLines.push(
      `${dIri} a qa:Domain ;`,
      `    rdfs:label "${esc(dom)}" ;`,
      `    qa:domainSlug "${esc(dom)}" .`,
      '',
    );
    if (domainToArea[dom]) {
      bridgeLines.push(`${dIri} bridge:domainMapping "${esc(domainToArea[dom])}" .`);
    }
  }

  const specFiles = walkFiles(path.join(REPO_ROOT, 'e2e/specs'), new Set(['.md']));
  const journeyById = new Map<string, ParsedSpec>();

  for (const absSpec of specFiles) {
    const parsed = parseE2eSpec(absSpec, knownTestIdValues);
    if (!parsed) continue;
    journeyById.set(parsed.id, parsed);

    const jIri = journeyIri(parsed.id);
    const dIri = domainIri(parsed.domain);

    qaLines.push(
      `${jIri} a qa:Journey ;`,
      `    rdfs:label "${esc(parsed.id + ': ' + parsed.title)}" ;`,
      `    qa:journeyId "${esc(parsed.id)}" ;`,
      `    qa:journeyTitle "${esc(parsed.title)}" ;`,
      `    qa:slug "${esc(parsed.slug)}" ;`,
      `    qa:priority "${esc(parsed.priority)}" ;`,
      `    qa:inDomain ${dIri} ;`,
      `    rdfs:comment "${esc(parsed.summary)}" ;`,
      `    qa:hasStep ${beatIri(parsed.id, 'Seed')}, ${beatIri(parsed.id, 'Enter')}, ${beatIri(parsed.id, 'Sense')}, ${beatIri(parsed.id, 'Drive')}, ${beatIri(parsed.id, 'Prove')} .`,
      '',
    );

    // 5-beat chain steps: Seed -> Enter -> Sense -> Drive -> Prove
    const seedLabel = parsed.seedNouns.join(', ') || parsed.domain;
    const enterLabel = parsed.routes.join(', ') || '/';
    const senseLabel = parsed.testIds.slice(0, 6).join(', ') || 'DOM readiness';
    const driveLabel = parsed.scenarios[0] ?? parsed.title;
    const proveLabel = parsed.playwrightSpec;

    const beats: Array<{ name: string; beatRef: string; desc: string; next?: string }> = [
      { name: 'Seed', beatRef: 'qa:Seed', desc: `Seed: ${seedLabel}`, next: 'Enter' },
      { name: 'Enter', beatRef: 'qa:Enter', desc: `Enter: ${enterLabel}`, next: 'Sense' },
      { name: 'Sense', beatRef: 'qa:Sense', desc: `Sense: ${senseLabel}`, next: 'Drive' },
      { name: 'Drive', beatRef: 'qa:Drive', desc: `Drive: ${driveLabel}`, next: 'Prove' },
      { name: 'Prove', beatRef: 'qa:Prove', desc: `Prove: ${proveLabel}` },
    ];

    for (const b of beats) {
      const bIri = beatIri(parsed.id, b.name);
      qaLines.push(
        `${bIri} a qa:Step ;`,
        `    rdfs:label "${esc(b.desc)}" ;`,
        `    qa:hasBeat ${b.beatRef} ;`,
        `    qa:beatOrder ${beats.indexOf(b) + 1}${b.next ? ` ;\n    qa:nextStep ${beatIri(parsed.id, b.next)}` : ''} .`,
        '',
      );
    }

    // Bridge: Journey -> specFile, playwrightSpec, routes, testIds, seedNouns
    bridgeLines.push(`${jIri} bridge:specFile ${fileIri(parsed.specPath)} .`);
    if (fs.existsSync(path.join(REPO_ROOT, parsed.playwrightSpec))) {
      const pwIri = fileIri(parsed.playwrightSpec);
      bridgeLines.push(`${jIri} bridge:playwrightSpec ${pwIri} .`);
      bridgeLines.push(`${jIri} bridge:touches ${pwIri} .`);

      // Inspect Playwright E2E file for imports, page objects, and TEST_IDS
      const pwContent = fs.readFileSync(path.join(REPO_ROOT, parsed.playwrightSpec), 'utf8');
      for (const imp of pwContent.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = imp[1];
        if (spec.startsWith('.')) {
          const resolved = path.normalize(path.join(path.dirname(parsed.playwrightSpec), spec)).replace(/\\/g, '/');
          const candidates = [`${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`];
          const hit = candidates.find((c) => fs.existsSync(path.join(REPO_ROOT, c)));
          if (hit) {
            bridgeLines.push(`${jIri} bridge:touches ${fileIri(hit)} .`);
          }
        }
      }
      for (const tidMatch of pwContent.matchAll(/TEST_IDS\.([A-Za-z0-9_.]+)/g)) {
        const parts = tidMatch[1].split('.');
        let cur: unknown = TEST_IDS;
        for (const p of parts) {
          cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
        }
        if (typeof cur === 'string') {
          bridgeLines.push(`${jIri} bridge:testId ${testIdIri(cur)} .`);
        }
      }
    }

    for (const r of parsed.routes) {
      if (!knownRoutes.has(r)) {
        knownRoutes.add(r);
        codeLines.push(
          `${routeIri(r)} a code:Route ;`,
          `    rdfs:label "${esc(r)}" ;`,
          `    code:routePath "${esc(r)}" .`,
          '',
        );
      }
      bridgeLines.push(`${jIri} bridge:route ${routeIri(r)} .`);
    }
    for (const t of parsed.testIds) {
      bridgeLines.push(`${jIri} bridge:testId ${testIdIri(t)} .`);
    }
    for (const noun of parsed.seedNouns) {
      bridgeLines.push(`${jIri} bridge:seedNoun ${noun} .`);
    }
    const linkedStories = new Set<string>(parsed.stories.filter((s) => knownStoryIds.has(s)));
    for (const r of parsed.routes) {
      for (const sid of storyIdsByRoute.get(r) ?? []) {
        linkedStories.add(sid);
      }
    }
    for (const sid of linkedStories) {
      bridgeLines.push(`${jIri} bridge:story ${storyIri(sid)} .`);
      qaLines.push(`${storyTestIri(sid)} qa:verifiesJourney ${jIri} .`);
    }
    // Also link any qa:StoryTest that shares >= 2 TEST_IDS with this journey
    if (parsed.testIds.length >= 2) {
      const jTidSet = new Set(parsed.testIds);
      for (const st of indexedStories) {
        const overlap = st.testIds.filter((t) => jTidSet.has(t));
        if (overlap.length >= 2 && !linkedStories.has(st.id)) {
          bridgeLines.push(`${jIri} bridge:story ${storyIri(st.id)} .`);
          qaLines.push(`${storyTestIri(st.id)} qa:verifiesJourney ${jIri} .`);
        }
      }
    }
  }

  // Build slug -> journeyId lookup from authored specs
  const slugToJourneyIri = new Map<string, string>();
  const symbolsByFile = new Map<string, ExtractedSymbol[]>();
  for (const syms of symbolIndexByName.values()) {
    for (const sym of syms) {
      const list = symbolsByFile.get(sym.relPath) ?? [];
      list.push(sym);
      symbolsByFile.set(sym.relPath, list);
    }
  }
  for (const syms of symbolsByFile.values()) {
    syms.sort((a, b) => a.lineHint - b.lineHint);
  }
  for (const [, spec] of journeyById.entries()) {
    slugToJourneyIri.set(`${spec.domain}-${spec.slug}`, journeyIri(spec.id));
    slugToJourneyIri.set(spec.slug, journeyIri(spec.id));
  }

  function resolveRootCauseSymbol(rcFile: string, rcLine: number): ExtractedSymbol | undefined {
    const syms = symbolsByFile.get(rcFile);
    if (!syms || syms.length === 0) return undefined;
    let best: ExtractedSymbol | undefined;
    for (const s of syms) {
      if (s.lineHint <= rcLine) best = s;
      else break;
    }
    return best ?? syms[0];
  }

  // 6. Index QA Runs, Proposed Journeys, and Issues from live QA site (with committed snapshot fallback)
  const qaSnapshotPath = path.join(REPO_ROOT, 'ontology/qa/qa-snapshot.ttl');
  async function fetchQaOntologyTtl(): Promise<string | null> {
    const offline = process.argv.includes('--offline') || process.env.ONTOLOGY_OFFLINE === '1';
    if (!offline) {
      try {
        const res = await fetch('https://qa.forest-adhara.ts.net/ontology.ttl', {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const text = await res.text();
          if (text.includes('qa:Issue')) {
            fs.mkdirSync(GENERATED_DIR, { recursive: true });
            fs.writeFileSync(qaSnapshotPath, text, 'utf8');
            return text;
          }
        }
      } catch {
        // Fall through to local fallbacks
      }
    }
    const localCandidates = [
      qaSnapshotPath,
      path.join(process.env.HOME ?? '', 'workspace/wod-wiki-ontology-audit/qa-ontology.ttl'),
      path.join(REPO_ROOT, 'docs/qa-walkthrough/qa-ontology.ttl'),
      '/tmp/qa-ontology.ttl',
    ];
    for (const p of localCandidates) {
      if (p && fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8');
      }
    }
    return null;
  }

  let issueCount = 0;
  let runCount = 0;
  let proposedCount = 0;
  let rootCauseCount = 0;

  const qaTtl = await fetchQaOntologyTtl();
  if (qaTtl) {
    const qaNodes = new Map<string, Map<string, string[]>>();
    for (const rawLine of qaTtl.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('@prefix') || line.startsWith('#')) continue;
      const m = line.match(/^(\S+)\s+(\S+)\s+([\s\S]+?)\s*\.$/);
      if (!m) continue;
      const [, subj, pred, rawObj] = m;
      const obj = rawObj.startsWith('"') && rawObj.endsWith('"') ? rawObj.slice(1, -1) : rawObj;
      let pMap = qaNodes.get(subj);
      if (!pMap) {
        pMap = new Map();
        qaNodes.set(subj, pMap);
      }
      const vals = pMap.get(pred) ?? [];
      vals.push(obj);
      pMap.set(pred, vals);
    }

    // 6a. Proposed journeys (to reach 23/23 coverage)
    for (const [subj, props] of qaNodes.entries()) {
      if (!subj.startsWith('jrn:')) continue;
      const key = subj.slice(4);
      if (slugToJourneyIri.has(key)) continue;
      const status = props.get('qa:status')?.[0] ?? 'proposed';
      const label = props.get('rdfs:label')?.[0] ?? key;
      const domVal = props.get('qa:domain')?.[0]?.replace(/^dom:/, '') ?? 'manual';
      const propId = `PROP-${key.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 32)}`;
      const jIri = journeyIri(key);
      slugToJourneyIri.set(key, jIri);
      proposedCount++;
      qaLines.push(
        `${jIri} a qa:Journey ;`,
        `    rdfs:label "${esc(label)}" ;`,
        `    qa:journeyId "${esc(propId)}" ;`,
        `    qa:journeyTitle "${esc(label)}" ;`,
        `    qa:slug "${esc(key)}" ;`,
        `    qa:status "${esc(status)}" ;`,
        `    qa:priority "P2" ;`,
        `    qa:inDomain ${domainIri(domVal)} .`,
        '',
      );
    }

    // 6b. QA Runs
    for (const [subj, props] of qaNodes.entries()) {
      if (!subj.startsWith('run:')) continue;
      const runId = subj.slice(4);
      runCount++;
      const rIri = runIri(runId);
      const runDate = props.get('qa:runDate')?.[0] ?? '';
      const commit = props.get('qa:commit')?.[0] ?? '';
      const findings = props.get('qa:findings')?.[0] ?? '0';
      const runDomains = props.get('qa:runDomain') ?? [];
      qaLines.push(
        `${rIri} a qa:Run ;`,
        `    rdfs:label "${esc(runId)}" ;`,
        `    qa:runDate "${esc(runDate)}" ;`,
        `    qa:commit "${esc(commit)}" ;`,
        `    qa:findings ${Number(findings) || 0}${runDomains.length > 0 ? ` ;\n    qa:runDomain ${runDomains.map((d) => domainIri(d.replace(/^dom:/, ''))).join(', ')}` : ''} .`,
        '',
      );
    }

    // 6c. QA Issues + PROV edges + SCIP bridge:rootCause edges
    for (const [subj, props] of qaNodes.entries()) {
      if (!subj.startsWith('ww:')) continue;
      const id = subj.slice(3);
      issueCount++;
      const iIri = issueIri(id);
      const title = props.get('rdfs:label')?.[0] ?? id;
      const severity = props.get('qa:severity')?.[0] ?? 'Medium';
      const kind = props.get('qa:kind')?.[0] ?? 'defect';
      const status = props.get('qa:status')?.[0] ?? 'open';
      const coverageStatus = props.get('qa:coverageStatus')?.[0] ?? '';
      const firstSeen = props.get('qa:firstSeen')?.[0];
      const lastSeen = props.get('qa:lastSeen')?.[0];
      const affectsDoms = props.get('qa:affects') ?? [];
      const coveredByJrns = props.get('qa:coveredBy') ?? [];
      const rootCauses = props.get('qa:rootCause') ?? [];

      const extraTriples: string[] = [];
      if (coverageStatus) extraTriples.push(`    qa:coverageStatus "${esc(coverageStatus)}"`);
      if (firstSeen) {
        extraTriples.push(`    prov:wasGeneratedBy ${runIri(firstSeen)}`);
        extraTriples.push(`    qa:firstSeenRun ${runIri(firstSeen)}`);
      }
      if (lastSeen) {
        extraTriples.push(`    qa:lastSeenRun ${runIri(lastSeen)}`);
      }
      for (const dom of affectsDoms) {
        extraTriples.push(`    qa:affects ${domainIri(dom.replace(/^dom:/, ''))}`);
      }
      for (const jrn of coveredByJrns) {
        const jKey = jrn.replace(/^jrn:/, '');
        const resolvedJrn = slugToJourneyIri.get(jKey) ?? journeyIri(jKey);
        extraTriples.push(`    qa:coveredBy ${resolvedJrn}`);
      }

      qaLines.push(
        `${iIri} a qa:Issue ;`,
        `    rdfs:label "${esc(title)}" ;`,
        `    qa:issueId "${esc(id)}" ;`,
        `    qa:severity "${esc(severity)}" ;`,
        `    qa:kind "${esc(kind)}" ;`,
        `    qa:status "${esc(status)}"${extraTriples.length > 0 ? ` ;\n${extraTriples.join(' ;\n')}` : ''} .`,
        '',
      );

      for (const rc of rootCauses) {
        const [rcFile, rcLineStr] = rc.split(':');
        if (!rcFile) continue;
        rootCauseCount++;
        const fIri = fileIri(rcFile);
        bridgeLines.push(`${iIri} bridge:rootCause ${fIri} .`);
        const rcLine = Number(rcLineStr);
        if (!Number.isNaN(rcLine) && rcLine > 0) {
          const sym = resolveRootCauseSymbol(rcFile, rcLine);
          if (sym) {
            bridgeLines.push(`${iIri} bridge:rootCause ${symbolIri(rcFile, sym.name)} .`);
          }
          bridgeLines.push(`${fIri} code:lineHint ${rcLine} .`);
        }
      }
    }
  } else {
    // Fallback: docs/qa-walkthrough/findings.json
    const findingsPath = path.join(REPO_ROOT, 'docs/qa-walkthrough/findings.json');
    if (fs.existsSync(findingsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
        const runs = Array.isArray(data.runs) ? data.runs : [];
        for (const run of runs) {
          if (!run?.id) continue;
          runCount++;
          qaLines.push(
            `${runIri(run.id)} a qa:Run ;`,
            `    rdfs:label "${esc(run.id)}" ;`,
            `    qa:runDate "${esc(String(run.date ?? ''))}" .`,
            '',
          );
        }
        const issues = Array.isArray(data.issues) ? data.issues : Array.isArray(data) ? data : [];
        for (const issue of issues) {
          if (!issue?.id) continue;
          issueCount++;
          const iIri = issueIri(issue.id);
          qaLines.push(
            `${iIri} a qa:Issue ;`,
            `    rdfs:label "${esc(issue.title ?? issue.id)}" ;`,
            `    qa:severity "${esc(String(issue.severity ?? 'medium'))}" ;`,
            `    qa:status "${esc(String(issue.status ?? 'open'))}"${issue.firstSeen ? ` ;\n    prov:wasGeneratedBy ${runIri(String(issue.firstSeen))}` : ''} .`,
            '',
          );
          if (issue.journey && journeyById.has(issue.journey)) {
            qaLines.push(`${iIri} qa:affects ${journeyIri(issue.journey)} .`);
          }
          if (typeof issue.rootCause === 'string') {
            const [rcFile, rcLine] = issue.rootCause.split(':');
            if (rcFile) {
              rootCauseCount++;
              bridgeLines.push(`${iIri} bridge:rootCause ${fileIri(rcFile)} .`);
              if (rcLine) {
                bridgeLines.push(`${fileIri(rcFile)} code:lineHint ${Number(rcLine) || 1} .`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Warning: failed to parse docs/qa-walkthrough/findings.json:', err);
      }
    }
  }

  // Write output files
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const codeOut = path.join(GENERATED_DIR, 'code-graph.ttl');
  const qaOut = path.join(GENERATED_DIR, 'qa-instances.ttl');
  const bridgeOut = path.join(GENERATED_DIR, 'bridge-instances.ttl');
  const trigOut = path.join(GENERATED_DIR, 'unified-dataset.trig');

  fs.writeFileSync(codeOut, codeLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(qaOut, qaLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(bridgeOut, bridgeLines.join('\n') + '\n', 'utf8');

  // Build unified-dataset.trig combining schema + instance graphs
  const stripPrefixes = (ttl: string) =>
    ttl
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('@prefix '))
      .join('\n');

  const trigParts: string[] = [
    PREFIXES,
    '',
    '# Unified 5-Named-Graph Dataset (patterns, domain, code, qa, bridge)',
    '',
    `<https://wod.wiki/graph/code> {\n${stripPrefixes(codeLines.join('\n'))}\n}`,
    '',
    `<https://wod.wiki/graph/qa> {\n${stripPrefixes(qaLines.join('\n'))}\n}`,
    '',
    `<https://wod.wiki/graph/bridge> {\n${stripPrefixes(bridgeLines.join('\n'))}\n}`,
    '',
  ];
  fs.writeFileSync(trigOut, trigParts.join('\n'), 'utf8');

  console.log(
    `Indexed code+qa+bridge graphs: ${allCodeFiles.length} files, ${symbolIndexByName.size} unique symbols, ${flatTestIds.length} testIds, ${knownRoutes.size} routes, ${agentTools.length} WebMCP tools, ${indexedStories.length} stories, ${domains.size} domains, ${journeyById.size + proposedCount} journeys (${journeyById.size} authored, ${proposedCount} proposed), ${runCount} runs, ${issueCount} issues, ${rootCauseCount} rootCause edges.`,
  );
  console.log(
    `Wrote:\n  - ${path.relative(REPO_ROOT, codeOut)}\n  - ${path.relative(REPO_ROOT, qaOut)}\n  - ${path.relative(REPO_ROOT, bridgeOut)}\n  - ${path.relative(REPO_ROOT, trigOut)}`,
  );
}

if (import.meta.main) {
  await buildUnifiedGraph();
}
