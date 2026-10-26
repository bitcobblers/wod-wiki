/** Compiles exact source, occurrence maps and sparse projections into atomic notes chunks. */
import { parseScript, whiteboardParser } from '@bitcobblers/wod-wiki-lang';
import { blockContentId, parseDocumentSections, reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { BlockEffort, BlockEquipment, BlockIndexRow } from '@bitcobblers/wod-wiki-storage';
import {
  buildDashboardDocument,
  isDashboardWidgetType,
  parseDashboardNote,
  parseQuery,
  resolveWidgetType,
} from '@bitcobblers/wod-wiki-wql';
import {
  DASHBOARDS_CHUNK_ID,
  SEED_NAMESPACE,
  SEED_SCHEMA,
  SEED_REGISTERED_WIDGETS,
  canvasRouteSlug,
  seedNoteSourceId,
  notebookSlugForChunkId,
  type ManifestChunk,
  type NotebookIndex,
  type SeedManifest,
  type SeedRecordRef,
  type SeedRow,
} from './contract';
import { fileToDisplayName } from './filename';
import { createReferenceIndex, extractStatementRefs, parseEffortFile, parseEquipmentFile, slugifyRefLabel, type IEffort, type IEquipment } from '@bitcobblers/wod-wiki-lang';
import { resolveGitVersion } from './git-version';
import { writeBuildReport } from './report';
import { getScalar, parseFrontmatter } from './frontmatter';
import { assertSeedManifest } from './validation';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// BlockEffort/BlockIndexRow row types come from @bitcobblers/wod-wiki-storage
// (type-only import — chunk rows are plain JSON applied structurally by the
// app, mirroring cli/seed.ts).

/** Scan `dir` recursively for `*.md` files; returns POSIX paths relative to `dir`, sorted. */
function listMarkdownFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listMarkdownFiles(join(dir, entry.name), rel));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel);
  }
  return out.sort();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface ChunkGroup {
  id: string;
  files: string[];
}

export interface GenerateSeedOptions {
  /** The corpus directory (`markdown/`). Defaults to `<corpusRoot>/markdown`. */
  markdownDir?: string;
  /** Output directory. Defaults to `<corpusRoot>/dist`. */
  outDir?: string;
  /**
   * Explicit manifest version (tests). Defaults to the corpus repo's git
   * commit count — see git-version.ts.
   */
  version?: number;
  /** Repo root the corpus paths resolve against and versioning derives from. Defaults to cwd. */
  corpusRoot?: string;
  /** Automatically scaffold markdown files for newly discovered efforts. */
  scaffoldDiscoveredEfforts?: boolean;
  /** Repo-relative POSIX paths omitted from chunk rows and derived indexes. */
  excludePaths?: readonly string[];
}

export interface GenerateSeedResult {
  manifest: SeedManifest;
  outDir: string;
  totalFiles: number;
  reportPath: string;
  /** ms timings per pass (mirrored into report.html). */
  passMs: { scan: number; blockIndex: number; parseGate: number; blockEfforts: number; write: number };
}

// ── Corpus partition ──────────────────────────────────────────────────────

/**
 * Map one `markdown/…` path to its chunk id. Returns null for files outside
 * the known corpora — callers MUST treat that as a parity failure so new
 * content directories cannot bypass the seed.
 */
export function chunkIdFor(relPath: string): string | null {
  const parts = relPath.split('/');
  if (parts[0] !== 'markdown' || parts.length < 2) return null;
  const corpus = parts[1];
  // markdown/<corpus>/<rest…>; a file directly under markdown/ has no corpus.
  if (parts.length === 2) return null;
  const slug = parts[2]?.replace(/\.md$/, '');
  switch (corpus) {
    case 'canvas':
    case 'dashboards':
    case 'efforts':
    case 'equipment':
      return corpus;
    case 'notebooks':
      return parts.length === 3 ? `notebook._root` : `notebook.${slug}`;
    default:
      return null;
  }
}

/** Scan the markdown corpus; returns repo-relative POSIX paths of all .md files. */
export function collectCorpusMarkdown(markdownDir: string, excludePaths: readonly string[] = []): string[] {
  const excluded = new Set(excludePaths);
  return listMarkdownFiles(markdownDir)
    .map((p) => `markdown/${p}`)
    .filter((path) => !excluded.has(path));
}

/** Group markdown corpus paths into chunk groups; throws on paths outside the known corpora. */
export function partitionIntoChunks(paths: string[]): ChunkGroup[] {
  const byId = new Map<string, string[]>();
  for (const p of paths) {
    const id = chunkIdFor(p);
    if (id === null) {
      throw new Error(
        `[generate-seed] Parity failure: '${p}' is not part of any known corpus ` +
        `(canvas | dashboards | efforts | equipment | notebooks). ` +
        `Extend chunkIdFor() if this is a new corpus.`,
      );
    }
    const list = byId.get(id);
    if (list) list.push(p);
    else byId.set(id, [p]);
  }
  return [...byId.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, files]) => ({ id, files }));
}

// ── Dashboard gate (#906) ─────────────────────────────────────────────────

/**
 * Validate one dashboard note in the locked #899 format: dashboard
 * frontmatter, a title, known widget types, WQL bodies that parse (and are
 * aggregate queries, not find queries), and every `$token` reference
 * declared. Returns the problems found (empty = valid).
 */
export function validateDashboardNote(raw: string): string[] {
  const problems: string[] = [];
  const { meta } = parseFrontmatter(raw);
  const { sections } = parseDashboardNote(raw);
  const doc = buildDashboardDocument(sections, meta);
  if (!doc.isDashboard) return ['file is not a dashboard note (missing dashboard frontmatter)'];
  if (doc.title === undefined) problems.push('dashboard has no title');
  if (doc.widgets.length < 3) problems.push(`dashboard has only ${doc.widgets.length} widgets (the locked format has ≥ 3)`);
  const declared = new Set(doc.tokens.map((t) => t.name));
  for (const widget of doc.widgets) {
    const where = `widget '${widget.title ?? widget.body.slice(0, 40)}'`;
    if (widget.title === undefined) problems.push(`${where}: missing title`);
    if (!isDashboardWidgetType(resolveWidgetType(widget.type))) {
      problems.push(`${where}: unknown widget type '${widget.type}'`);
    }
    const parsed = parseQuery(widget.body);
    if (parsed.error !== undefined) problems.push(`${where}: WQL parse error: ${parsed.error}`);
    for (const ref of [
      ...widget.body.matchAll(/\$([A-Za-z][\w-]*)/g),
      ...Object.values(widget.attributes).flatMap((v) => [...String(v).matchAll(/\$([A-Za-z][\w-]*)/g)]),
    ]) {
      if (!declared.has(ref[1])) problems.push(`${where}: undeclared token $${ref[1]}`);
    }
  }
  return problems;
}

/** Validate every dashboard file in a chunk group; throws on the first invalid file. */
function gateDashboards(groups: ChunkGroup[], corpusRoot: string): void {
  for (const group of groups) {
    if (group.id !== DASHBOARDS_CHUNK_ID) continue;
    for (const p of group.files) {
      const problems = validateDashboardNote(readFileSync(join(corpusRoot, p), 'utf8'));
      if (problems.length > 0) {
        throw new Error(`[generate-seed] Dashboard validation failed for '${p}':\n  - ${problems.join('\n  - ')}`);
      }
    }
  }
}

// ── Block index derivation ────────────────────────────────────────────────


/** Created-at from the corpus repo's git history (notebooks/guides), 0 fallback when unknown. */
function getFileCreatedAt(file: string, repoRoot: string): number {
  try {
    const out = execSync(`git log -1 --format=%ct -- '${file}'`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const ts = Number(out) * 1000;
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
}

export function seedNoteIdSync(path: string): string {
  const hash = createHash('sha1').update(`${SEED_NAMESPACE}:${path}`).digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((b, i) => ([4, 6, 8, 10].includes(i) ? `-${b.toString(16).padStart(2, '0')}` : b.toString(16).padStart(2, '0'))).join('');
}

export function getFileCommit(file: string, repoRoot: string): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%H', '--', file], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function getFileVersion(file: string, repoRoot: string): number {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD', '--', file], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const count = Number(out);
    return Number.isFinite(count) && count > 0 ? count : 1;
  } catch {
    return 1;
  }
}

/**
 * Frontmatter `date: YYYY-MM-DD` → epoch ms at noon UTC (mirrors the seed
 * importer's Note.date, so the block and note planes place a post on the
 * same civil day). Absent/empty → undefined; anything else that is not a
 * real calendar day throws — the build fails loudly instead of silently
 * misdating or rolling the post to another day.
 */
export function frontmatterDateToCreatedAt(raw: string, path: string): number | undefined {
  const value = getScalar(parseFrontmatter(raw).meta, 'date');
  if (value === undefined || value === '') return undefined;
  const text = String(value);
  const parts = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ts = parts ? Date.parse(`${text}T12:00:00Z`) : NaN;
  // Some engines roll impossible days (2026-02-30 → March 2) instead of
  // failing — round-trip the UTC components so the post can never silently
  // move to another day.
  const valid = !!parts && Number.isFinite(ts)
    && new Date(ts).getUTCMonth() === Number(parts[2]) - 1
    && new Date(ts).getUTCDate() === Number(parts[3]);
  if (!valid) {
    throw new Error(`[wod build] invalid frontmatter date '${text}' in '${path}' — expected a real calendar day (YYYY-MM-DD)`);
  }
  return ts;
}

/** Created-at timestamp for a dated notebook item's date key (`yyyy-mm-dd` from the path). */
export function dateKeyToCreatedAt(dateKey: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return 0;
  const ts = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ts) ? 0 : ts;
}

// canvasRouteSlug lives in contract.ts — one derivation shared by the
// block plane (here) and the app's importer (note plane).


export function compileSeedRow(path: string, content: string, metadata: { routeId?: string; noteTitle?: string; sourceId?: string; createdAt?: number } = {}): SeedRow {
  let ordinal = 0;
  const blocks = reconcileNoteBlocks(content, { sourceRevision: 1, registeredWidgets: SEED_REGISTERED_WIDGETS, createId: () => `seed:${path}:${ordinal++}` });
  const noteId = metadata.routeId ?? path;
  const sections = parseDocumentSections(content);
  const blockIndex: BlockIndexRow[] = Object.values(blocks).map((block, position) => {
    const section = sections.find((section) => section.from === block.from && section.to === block.to);
    return { id: `${noteId}:${block.id}`, noteId, blockId: block.id, blockVersion: 1, sourceRevision: 1, from: block.from, to: block.to, position, dataType: block.kind, ...(block.kind === 'wod' ? { blockContentId: blockContentId(section?.scriptBlock?.content ?? content.slice(block.from, block.to)) } : {}), rawContent: content.slice(block.from, block.to), noteTitle: metadata.noteTitle ?? fileToDisplayName(path.split('/').at(-1) ?? path), createdAt: metadata.createdAt ?? 0, isStatic: true, sourceId: metadata.sourceId, sourcePath: path, routeId: metadata.routeId };
  });
  return { path, content, blocks, blockIndex, blockEfforts: [], blockEquipment: [] };
}

export function buildBlockIndexRows(markdownDir: string, corpusRoot: string, excludePaths: readonly string[] = []): BlockIndexRow[] {
  const rows: BlockIndexRow[] = [];
  for (const path of collectCorpusMarkdown(markdownDir, excludePaths)) {
    const chunkId = chunkIdFor(path);
    if (!chunkId) continue;
    const content = readFileSync(join(corpusRoot, path), 'utf8');
    const parts = path.split('/');
    const stem = (parts.at(-1) ?? '').replace(/\.md$/, '');
    const slug = parts[2];
    const routeId = chunkId === 'canvas' ? canvasRouteSlug(content) ?? undefined : chunkId.startsWith('notebook.') ? (stem.toLowerCase() === 'readme' ? slug : parts.slice(2).join('/').replace(/\.md$/, '')) : undefined;
    const sourceId = seedNoteSourceId(path, content, chunkId);
    // Authored frontmatter date wins regardless of filename/directory; dated
    // notebooks keep their historical path-date placement, everything else
    // falls back to the corpus repo's git history.
    const createdAt = frontmatterDateToCreatedAt(content, path)
      ?? (chunkId.startsWith('notebook.') && /^\d{4}-\d{2}-\d{2}$/.test(parts.at(-2) ?? '') ? dateKeyToCreatedAt(parts.at(-2) ?? '') : getFileCreatedAt(path, corpusRoot));
    rows.push(...compileSeedRow(path, content, { routeId, sourceId, createdAt }).blockIndex);
  }
  return rows;
}

/**
 * Syntax gate — every `wod` block's script must parse cleanly.
 *
 * Plain fences get a strict scan of the Lezer tree for error nodes
 * (`WhiteboardScript.errors` only carries mapper exceptions; the parser
 * recovers silently, so the tree is scanned directly) with `path:line`
 * diagnostics. Dialect-fenced blocks (`log:climbing`, …) are owned by the
 * dialect stack — their `key: value` lines are recovered by dialect
 * handlers, not the base grammar — so those gate on the exception channel
 * of a dialect-aware parse instead, matching how the app consumes them.
 */
export function validateWodBlockSyntax(blocks: BlockIndexRow[]): string[] {
  const problems: string[] = [];
  for (const block of blocks) {
    if (block.dataType !== 'wod' || !block.rawContent?.trim()) continue;
    const section = parseDocumentSections(block.rawContent, { registeredWidgets: SEED_REGISTERED_WIDGETS })
      .find((s) => s.scriptBlock);
    const source = section?.scriptBlock?.content ?? block.rawContent;
    if (!source.trim()) continue;

    const where = block.sourcePath ?? block.noteId;
    if (section?.sport) {
      const parsed = parseScript(source, { sport: section.sport });
      for (const error of parsed.errors ?? []) {
        problems.push(`${where}: ${error.message}`);
      }
      continue;
    }

    const doc = source.endsWith('\n') ? source : source + '\n';
    const tree = whiteboardParser.parse(doc);
    tree.iterate({
      enter: (node) => {
        if (!node.type.isError) return;
        const line = doc.slice(0, node.from).split('\n').length;
        const snippet = source.slice(node.from, Math.min(node.to, node.from + 60)).split('\n')[0];
        problems.push(`${where}:${line} \`${snippet}\``);
      },
    });
  }
  return problems;
}

/**
 * Uncataloged effort discovered during workout block analysis.
 */
export interface DiscoveredEffort {
  slug: string;
  label: string;
  rawLabels: string[];
}

/** Static lookup — syntax/structure keywords and known non-effort labels that must never scaffold. */
const NON_EFFORT_SLUGS: Record<string, true> = {
  'amrap': true, 'emom': true, 'tabata': true, 'for-time': true, 'rounds': true, 'sets': true,
  'repetitions': true, 'count-down': true, 'total-reps': true,
  'warmup': true, 'cooldown': true, 'cool-down': true, 'transition': true, 'rest': true, 'break': true, 'work': true,
  'i-suck-at-this': true, 'isuckatthis': true, 'movement': true, 'movement-you': true, 'selected-exercise': true,
  'training-setup': true, 'grade-system': true, 'hangs': true, 'warm-light-wind': true, 'basin': true, 'rock-canyon': true,
  'b-onsight': true, 'a-redpoint': true, 'd-redpoint': true, 'v0-flash': true, 'v2-flash': true, 'v7-redpoint': true,
  'avgrpe-mean': true, 'calculate': true, 'totalload-sum': true, 'query': true, 'by': true,
  '': true, '-': true, '...': true, 'x': true, 's': true, 'bw': true,
};

function formatDiscoveredLabel(raw: string): string {
  const clean = raw.replace(/[-_]+/g, ' ').trim();
  return clean
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * ONE corpus reference catalog — both definition families parsed once into
 * real arrays, the direct feed for lang's `createReferenceIndex`. Effort and
 * equipment containment rows, discovery and the runtime all resolve through
 * that single index, so the static plane and runtime agree on canonical
 * slugs with no per-family copies.
 */
export function loadCorpusReferenceCatalog(markdownDir: string): { efforts: IEffort[]; equipment: IEquipment[] } {
  const efforts: IEffort[] = [];
  const equipment: IEquipment[] = [];
  const effortsDir = join(markdownDir, 'efforts');
  for (const file of listMarkdownFiles(effortsDir)) {
    const parsed = parseEffortFile(readFileSync(join(effortsDir, file), 'utf8'));
    if (parsed) efforts.push(parsed);
  }
  const equipmentDir = join(markdownDir, 'equipment');
  for (const file of listMarkdownFiles(equipmentDir)) {
    const parsed = parseEquipmentFile(readFileSync(join(equipmentDir, file), 'utf8'));
    if (parsed) equipment.push(parsed);
  }
  return { efforts, equipment };
}

export function discoverUncatalogedEfforts(markdownDir: string, corpusRoot: string, excludePaths: readonly string[] = []): DiscoveredEffort[] {
  const catalog = loadCorpusReferenceCatalog(markdownDir);
  const index = createReferenceIndex(catalog);
  const blocks = buildBlockIndexRows(markdownDir, corpusRoot, excludePaths);
  const discovered = new Map<string, { label: string; rawLabels: Set<string> }>();

  for (const block of blocks) {
    if (block.dataType !== 'wod' || !block.rawContent) continue;
    const section = parseDocumentSections(block.rawContent, { registeredWidgets: SEED_REGISTERED_WIDGETS }).find((section) => section.scriptBlock);
    const script = parseScript(section?.scriptBlock?.content ?? block.rawContent, { references: index });
    for (const statement of script.statements) {
      const effortMetric = statement.metrics?.getMetric?.('effort');
      const effortLabel = (effortMetric && typeof effortMetric.value === 'string' ? effortMetric.value : undefined) ?? statement.exerciseId;
      if (!effortLabel) continue;

      const slugified = slugifyRefLabel(effortLabel);
      if (!slugified || NON_EFFORT_SLUGS[slugified]) continue;

      // Known efforts are exactly the catalog's canonical slugs — discovery
      // only reports labels the shared index cannot resolve.
      if (index.resolveEffort(slugified) || index.resolveEffort(effortLabel)) continue;

      const existing = discovered.get(slugified);
      if (existing) {
        existing.rawLabels.add(effortLabel);
      } else {
        discovered.set(slugified, {
          label: formatDiscoveredLabel(effortLabel),
          rawLabels: new Set([effortLabel]),
        });
      }
    }
  }

  return Array.from(discovered.entries()).map(([slug, data]) => ({
    slug,
    label: data.label,
    rawLabels: Array.from(data.rawLabels),
  }));
}

export function scaffoldDiscoveredEfforts(
  discovered: DiscoveredEffort[],
  markdownDir: string,
): string[] {
  const targetDir = join(markdownDir, 'efforts', 'discovered');
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const createdPaths: string[] = [];
  for (const effort of discovered) {
    const filePath = join(targetDir, `${effort.slug}.md`);
    if (existsSync(filePath)) continue;

    const aliases = effort.rawLabels
      .filter((l) => l.toLowerCase() !== effort.label.toLowerCase())
      .map((l) => `  - "${l.replace(/"/g, '\\"')}"`);

    const content = [
      '---',
      `id: effort-bundled-${effort.slug}`,
      `slug: ${effort.slug}`,
      `label: "${effort.label.replace(/"/g, '\\"')}"`,
      aliases.length > 0 ? `aliases:\n${aliases.join('\n')}` : 'aliases: []',
      'baseAttributes:',
      '  met: 5.0',
      '  discipline: general',
      '  intensityTier: moderate',
      'registrySource: bundled',
      '---',
      '',
    ].join('\n');

    writeFileSync(filePath, content, 'utf8');
    createdPaths.push(filePath);
  }

  return createdPaths;
}

/**
 * Derive BlockEffort[] containment rows from the block-index row set.
 * Requires a second pass over the source markdown to parse the script AST
 * (with the corpus reference index configured, so statements carry canonical
 * refs), which is safe because the corpus is static and compile-time.
 *
 * Only VALIDATED refs enter the durable index: a slug that survives is
 * confirmed by the shared index (`resolveEffort`); uncataloged movements
 * produce no durable link — that is discovery's reporting job.
 */
export function buildBlockEffortRows(markdownDir: string, corpusRoot: string, blocks: BlockIndexRow[] = buildBlockIndexRows(markdownDir, corpusRoot)): BlockEffort[] {
  const efforts: BlockEffort[] = [];
  const index = createReferenceIndex(loadCorpusReferenceCatalog(markdownDir));
  for (const block of blocks) {
    if (block.dataType !== 'wod' || !block.rawContent) continue;
    const section = parseDocumentSections(block.rawContent, { registeredWidgets: SEED_REGISTERED_WIDGETS }).find((section) => section.scriptBlock);
    const script = parseScript(section?.scriptBlock?.content ?? block.rawContent, { references: index });
    const linked = new Set<string>();
    for (const rawSlug of extractStatementRefs(script.statements).efforts) {
      const canonical = index.resolveEffort(rawSlug);
      const canonicalSlug = canonical?.slug;
      if (!canonicalSlug || NON_EFFORT_SLUGS[canonicalSlug] || NON_EFFORT_SLUGS[rawSlug]) {
        continue;
      }
      if (linked.has(canonicalSlug)) continue;
      linked.add(canonicalSlug);
      efforts.push({
        id: `${block.id}:${canonicalSlug}`,
        noteId: block.noteId,
        blockId: block.blockId,
        blockContentId: block.blockContentId,
        effortSlug: canonicalSlug,
        isStatic: block.isStatic,
        sourcePath: block.sourcePath,
        createdAt: block.createdAt,
      });
    }
  }
  return efforts;
}

/**
 * Derive BlockEquipment[] containment rows — the equipment twin of
 * {@link buildBlockEffortRows}. Parsed with the corpus reference index so
 * statements carry canonical equipment refs; only slugs the shared index
 * confirms (`resolveEquipment`) produce a durable link. Unknown equipment
 * stays visible as authored source + parser diagnostics.
 */
export function buildBlockEquipmentRows(markdownDir: string, corpusRoot: string, blocks: BlockIndexRow[] = buildBlockIndexRows(markdownDir, corpusRoot)): BlockEquipment[] {
  const links: BlockEquipment[] = [];
  const index = createReferenceIndex(loadCorpusReferenceCatalog(markdownDir));
  for (const block of blocks) {
    if (block.dataType !== 'wod' || !block.rawContent) continue;
    const section = parseDocumentSections(block.rawContent, { registeredWidgets: SEED_REGISTERED_WIDGETS }).find((s) => s.scriptBlock);
    const script = parseScript(section?.scriptBlock?.content ?? block.rawContent, { references: index });
    const linked = new Set<string>();
    for (const rawSlug of extractStatementRefs(script.statements).equipment) {
      const canonicalSlug = index.resolveEquipment(rawSlug)?.slug;
      if (!canonicalSlug || linked.has(canonicalSlug)) continue;
      linked.add(canonicalSlug);
      links.push({
        id: `${block.id}:${canonicalSlug}`,
        noteId: block.noteId,
        blockId: block.blockId,
        blockContentId: block.blockContentId,
        equipmentSlug: canonicalSlug,
        isStatic: block.isStatic,
        sourcePath: block.sourcePath,
        createdAt: block.createdAt,
      });
    }
  }
  return links;
}


// ── Generation ────────────────────────────────────────────────────────────

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function generateSeed(options: GenerateSeedOptions = {}): GenerateSeedResult {
  const t0 = Date.now();
  const passMs = { scan: 0, blockIndex: 0, parseGate: 0, blockEfforts: 0, write: 0 };
  const corpusRoot = options.corpusRoot ?? process.cwd();
  const markdownDir = options.markdownDir ?? join(corpusRoot, 'markdown');
  const outDir = options.outDir ?? join(corpusRoot, 'dist');
  const gitVersion = options.version !== undefined
    ? { ...resolveGitVersion(corpusRoot), version: options.version }
    : resolveGitVersion(corpusRoot);
  const packageFile = join(corpusRoot, 'package.json');
  const packageMetadata: unknown = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, 'utf8')) : {};
  const metadata = packageMetadata && typeof packageMetadata === 'object' ? packageMetadata : {};
  const repository = 'repository' in metadata ? metadata.repository : undefined;
  const repositoryUrl = typeof repository === 'string' ? repository : repository && typeof repository === 'object' && 'url' in repository && typeof repository.url === 'string' ? repository.url : undefined;
  const webRepositoryUrl = repositoryUrl?.replace(/^git\+/, '').replace(/\.git$/, '');
  const repositoryLink = webRepositoryUrl && URL.canParse(webRepositoryUrl) ? new URL(webRepositoryUrl) : undefined;
  if (options.scaffoldDiscoveredEfforts) {
    const discovered = discoverUncatalogedEfforts(markdownDir, corpusRoot, options.excludePaths);
    if (discovered.length > 0) {
      scaffoldDiscoveredEfforts(discovered, markdownDir);
    }
  }

  const tScan = Date.now();
  const paths = collectCorpusMarkdown(markdownDir, options.excludePaths);
  const groups = partitionIntoChunks(paths);
  gateDashboards(groups, corpusRoot);
  passMs.scan = Date.now() - tScan;

  const tBlockIndex = Date.now();
  const blockRows = buildBlockIndexRows(markdownDir, corpusRoot, options.excludePaths);
  passMs.blockIndex = Date.now() - tBlockIndex;
  const tParseGate = Date.now();
  const syntaxProblems = validateWodBlockSyntax(blockRows);
  passMs.parseGate = Date.now() - tParseGate;
  if (syntaxProblems.length > 0) {
    const shown = syntaxProblems.slice(0, 20).map((p) => `  ${p}`).join('\n');
    const more = syntaxProblems.length > 20 ? `\n  … and ${syntaxProblems.length - 20} more` : '';
    throw new Error(`[wod build] block syntax gate failed — ${syntaxProblems.length} block(s) do not parse:\n${shown}${more}`);
  }

  const chunksDir = join(outDir, 'chunks');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(chunksDir, { recursive: true });

  const manifestChunks: ManifestChunk[] = [];
  const tBlockEfforts = Date.now();
  const effortRows = buildBlockEffortRows(markdownDir, corpusRoot, blockRows);
  const equipmentRows = buildBlockEquipmentRows(markdownDir, corpusRoot, blockRows);
  passMs.blockEfforts = Date.now() - tBlockEfforts;
  const blocksByPath = new Map<string, BlockIndexRow[]>();
  const effortsByPath = new Map<string, BlockEffort[]>();
  const equipmentByPath = new Map<string, BlockEquipment[]>();
  for (const row of blockRows) {
    const rows = blocksByPath.get(row.sourcePath!) ?? [];
    rows.push(row); blocksByPath.set(row.sourcePath!, rows);
  }
  for (const row of effortRows) {
    const rows = effortsByPath.get(row.sourcePath!) ?? [];
    rows.push(row); effortsByPath.set(row.sourcePath!, rows);
  }
  for (const row of equipmentRows) {
    const rows = equipmentByPath.get(row.sourcePath!) ?? [];
    rows.push(row); equipmentByPath.set(row.sourcePath!, rows);
  }
  let totalFiles = 0;
  const manifestNotebooks: NotebookIndex[] = [];

  const tWrite = Date.now();
  for (const { id, files } of groups) {
    const records: SeedRecordRef[] = [];
    const rows: SeedRow[] = files.map((p) => {
      const raw = readFileSync(join(corpusRoot, p), 'utf8');
      const content = raw;
      const compiled = compileSeedRow(p, content);
      compiled.blockIndex = blocksByPath.get(p) ?? compiled.blockIndex;
      compiled.blockEfforts = effortsByPath.get(p) ?? [];
      compiled.blockEquipment = equipmentByPath.get(p) ?? [];
      const fileCommit = getFileCommit(p, corpusRoot) || gitVersion.commit || '';
      const fileVer = getFileVersion(p, corpusRoot);
      const uuid = seedNoteIdSync(p);
      compiled.commit = fileCommit;
      compiled.uuid = uuid;
      compiled.version = fileVer;

      // Write compiled record JSON alongside markdown
      const recordRelPath = p.replace(/\.md$/, '.json');
      const recordOutFile = join(outDir, recordRelPath);
      mkdirSync(dirname(recordOutFile), { recursive: true });
      const recordBytes = Buffer.from(JSON.stringify(compiled, null, 2), 'utf8');
      writeFileSync(recordOutFile, recordBytes);

      const title = compiled.blockIndex[0]?.noteTitle ?? fileToDisplayName(p.split('/').at(-1) ?? p);
      records.push({
        uuid,
        path: p,
        recordPath: recordRelPath,
        commit: fileCommit,
        version: fileVer,
        sha256: sha256Hex(recordBytes),
        title,
        date: frontmatterDateToCreatedAt(content, p),
      });

      return compiled;
    });
    const bytes = Buffer.from(JSON.stringify(rows), 'utf8');
    const sha = sha256Hex(bytes);
    const file = `chunks/${id}.${sha.slice(0, 8)}.json`;
    writeFileSync(join(outDir, file), bytes);
    manifestChunks.push({ id, path: file, sha256: sha, bytes: bytes.length, count: rows.length });
    totalFiles += rows.length;

    // Emit notebook index
    const notebookIndexPath = `indexes/notebooks/${id}.json`;
    const notebookIndex: NotebookIndex = {
      notebookId: id,
      label: fileToDisplayName(id.split('.').at(-1) ?? id),
      category: notebookSlugForChunkId(id),
      indexPath: notebookIndexPath,
      commit: records.find((r) => r.commit)?.commit ?? gitVersion.commit,
      count: rows.length,
      records,
    };
    const indexOutFile = join(outDir, notebookIndexPath);
    mkdirSync(dirname(indexOutFile), { recursive: true });
    writeFileSync(indexOutFile, JSON.stringify(notebookIndex, null, 2) + '\n');
    manifestNotebooks.push(notebookIndex);
  }

  passMs.write = Date.now() - tWrite;

  const manifest: SeedManifest = {
    name: 'name' in metadata && typeof metadata.name === 'string' ? metadata.name : undefined,
    description: 'description' in metadata && typeof metadata.description === 'string' ? metadata.description : undefined,
    repositoryUrl: repositoryLink?.protocol === 'https:' && !repositoryLink.username && !repositoryLink.password ? repositoryLink.href : undefined,
    schema: SEED_SCHEMA,
    version: gitVersion.version,
    versionLabel: gitVersion.versionLabel,
    commit: gitVersion.commit,
    dirty: gitVersion.dirty,
    builtAt: new Date().toISOString(),
    chunks: manifestChunks,
    notebooks: manifestNotebooks,
  };
  assertSeedManifest(manifest);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const reportPath = writeBuildReport(outDir, {
    manifest,
    totalMs: Date.now() - t0,
    passMs,
    fileCount: paths.length,
    outDir,
  });

  return { manifest, outDir, totalFiles, reportPath, passMs };
}
