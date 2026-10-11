/**
 * Seed compiler — compiles a `markdown/` corpus into versioned seed
 * artifacts (manifest.json + content-hashed chunks + report.html).
 *
 * Ported from the wod-wiki-community content repo (its src/compiler.ts);
 * that repo's CI now builds through this module via `wod build`, and the
 * wod-wiki host (scripts/sync-seed.ts) imports generateSeed from the
 * engine package instead of a sibling checkout.
 *
 *   <root>/dist/  (or --out <dir>)
 *   ├── manifest.json          ← schema + git version + chunk index (small, no-cache)
 *   ├── report.html            ← build benchmarks (sizes, timings, version stamp)
 *   ├── block-parent-map.json  ← legacy static-parent → sourcePath map (API migration)
 *   └── chunks/
 *       └── <id>.<sha256-8>.json   ← immutable, content-hashed row arrays
 *
 * Notes chunks are JSON arrays of `{ path, content }` rows; `path` is the
 * repo-relative POSIX path of the source markdown, `content` the raw file
 * text. Chunk granularity is one corpus part — `canvas`, `dashboards`,
 * `efforts`, `template`, one chunk per collection/feed slug — so a content
 * edit re-fetches only the chunk that changed.
 *
 * `block-index.<n>` chunks (kind `'block-index'`) carry precomputed
 * BlockIndexRow[] rows for the collections/feeds/guides (canvas) corpus, and
 * `block-efforts.<n>` chunks carry precomputed BlockEffort[] containment
 * rows, so the runtime importer can populate its stores directly.
 *
 * The PARITY GATE: every `.md` file under `markdown/` must land in exactly
 * one notes chunk, or the build fails. Unknown top-level corpora are a hard
 * error, so a new directory cannot silently bypass the seed pipeline. The
 * DASHBOARD GATE (#906): every `markdown/dashboards/*.md` must be a
 * well-formed dashboard note in the locked #899 format with parseable WQL
 * bodies, so invalid dashboard content fails the build before the app ever
 * sees it.
 *
 * Determinism: chunk bytes depend only on corpus content (block-index
 * created-at derives from the corpus repo's git history, so it shifts only
 * when history does); the manifest `version` (commit count) is what
 * advances. Re-import compares per-chunk hashes against the stored
 * checkpoint, so a bumped version with identical hashes is a no-op.
 *
 * Versioning: `manifest.version` is the corpus repo's commit count,
 * `versionLabel` is `git describe --long --always --dirty`, `commit` is the
 * HEAD sha — see git-version.ts. CI checkouts must fetch full history.
 */
import { parseScript } from '@bitcobblers/wod-wiki-lang';
import { parseDocumentSections, type SegmentDataType, type Section } from '@bitcobblers/wod-wiki-core';
import type { BlockEffort, BlockIndexRow } from '@bitcobblers/wod-wiki-storage';
import {
  buildDashboardDocument,
  isDashboardWidgetType,
  parseDashboardNote,
  parseQuery,
  resolveWidgetType,
} from '@bitcobblers/wod-wiki-wql';
import {
  BLOCK_EFFORTS_CHUNK_PREFIX,
  BLOCK_INDEX_CHUNK_PREFIX,
  DASHBOARDS_CHUNK_ID,
  SEED_SCHEMA,
  TEMPLATE_CHUNK_ID,
  canvasRouteSlug,
  type ChunkKind,
  type ManifestChunk,
  type SeedManifest,
  type SeedRow,
} from './contract';
import { extractEffortSlugs } from './effort-slugs';
import { fileToDisplayName } from './filename';
import { parseEffortFile } from './effort-file';
import { resolveGitVersion } from './git-version';
import { writeBuildReport } from './report';
import { parseFrontmatter } from './frontmatter';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';

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
  /** Optional playground template file — the host passes its own; standalone builds omit the `template` chunk. */
  templateFile?: string;
  /**
   * Row path recorded for the template chunk (the runtime derives the
   * template note's id from it, so it must stay stable across builds). The
   * host pins its historical in-repo path; defaults to the path relative to
   * `corpusRoot`.
   */
  templateRowPath?: string;
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
}

export interface GenerateSeedResult {
  manifest: SeedManifest;
  outDir: string;
  totalFiles: number;
  reportPath: string;
  /** ms timings per pass (mirrored into report.html). */
  passMs: { scan: number; blockIndex: number; blockEfforts: number; write: number };
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
      return corpus;
    case 'collections':
      return parts.length === 3 ? `collection._root` : `collection.${slug}`;
    case 'feeds':
      return parts.length === 3 ? `feed._root` : `feed.${slug}`;
    default:
      return null;
  }
}

/** Scan the markdown corpus; returns repo-relative POSIX paths of all .md files. */
export function collectCorpusMarkdown(markdownDir: string): string[] {
  return listMarkdownFiles(markdownDir).map((p) => `markdown/${p}`);
}

/** Group markdown corpus paths into chunk groups; throws on paths outside the known corpora. */
export function partitionIntoChunks(paths: string[]): ChunkGroup[] {
  const byId = new Map<string, string[]>();
  for (const p of paths) {
    const id = chunkIdFor(p);
    if (id === null) {
      throw new Error(
        `[generate-seed] Parity failure: '${p}' is not part of any known corpus ` +
        `(canvas | dashboards | efforts | collections | feeds). ` +
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

/**
 * precompute the collections/feeds/guides (canvas) corpus into BlockIndexRow[]
 * at build time so the runtime importer can populate the `block_index` store
 * directly. Row identity (`static:<noteId>:<sectionId>:1`) matches what
 * analytics joins expect.
 */
function toSegmentDataType(section: Pick<Section, 'type' | 'level'>): SegmentDataType {
  switch (section.type) {
    case 'time':
    case 'log':
      return 'wod';
    case 'title': {
      const l = section.level ?? 1;
      return `h${Math.min(Math.max(l, 1), 6)}` as SegmentDataType;
    }
    case 'frontmatter': return 'frontmatter';
    case 'markdown':
    case 'widget':
    case 'embed':
    case 'code':
      return 'markdown';
    default:
      return 'markdown';
  }
}

/** Created-at from the corpus repo's git history (collections/guides), 0 fallback when unknown. */
function getFileCreatedAt(file: string, repoRoot: string): number {
  try {
    const out = execSync(`git log -1 --format=%ct -- '${file}'`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const ts = Number(out) * 1000;
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
}

/** Created-at timestamp for a feed entry's date key (`yyyy-mm-dd` from the path). */
export function feedDateToCreatedAt(dateKey: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return 0;
  const ts = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ts) ? 0 : ts;
}

// canvasRouteSlug lives in contract.ts — one derivation shared by the
// block plane (here) and the app's importer (note plane).

/** Rows per block-index chunk (~4k rows keeps fetch + transaction sizes sane). */
const BLOCK_INDEX_ROWS_PER_CHUNK = 4000;

export function buildBlockIndexRows(markdownDir: string, corpusRoot: string): BlockIndexRow[] {
  const index: BlockIndexRow[] = [];

  // Collections: collections/{dir}/{file}.md (including collection READMEs as collection pages).
  for (const file of listMarkdownFiles(join(markdownDir, 'collections'))) {
    const rel = `markdown/collections/${file}`;
    const parts = rel.split('/');
    if (parts.length < 4) continue;
    const dirName = parts[parts.length - 2];
    const fileNameExt = parts[parts.length - 1];
    const isReadme = fileNameExt.toLowerCase() === 'readme.md';
    const fileName = fileNameExt.replace(/\.md$/, '');
    const noteId = isReadme ? dirName : `${dirName}/${fileName}`;
    const content = readFileSync(join(corpusRoot, rel), 'utf8');
    const headingMatch = isReadme ? content.match(/^#\s+(.+)$/m) : null;
    const noteTitle = headingMatch?.[1]?.trim() || fileToDisplayName(isReadme ? dirName : fileNameExt);
    const createdAt = getFileCreatedAt(rel, corpusRoot);

    const sections = parseDocumentSections(content);
    let position = 0;
    for (const section of sections) {
      const blockContentId = section.scriptBlock?.contentId ?? undefined;
      index.push({
        id: `static:${noteId}:${section.id}:1`,
        noteId,
        segmentId: section.id,
        segmentVersion: 1,
        position: position++,
        dataType: toSegmentDataType(section),
        blockContentId,
        rawContent: section.displayContent,
        noteTitle,
        createdAt,
        isStatic: true,
        sourceId: isReadme ? `collection:${dirName}` : `collection:${noteId}`,
        sourcePath: rel,
      });
    }
  }

  // Feeds: feeds/{dir}/{date}/{file}.md (READMEs excluded).
  for (const file of listMarkdownFiles(join(markdownDir, 'feeds'))) {
    const rel = `markdown/feeds/${file}`;
    const parts = rel.split('/');
    if (parts.length < 5) continue;
    const dirName = parts[parts.length - 3];
    const dateKey = parts[parts.length - 2];
    const fileNameExt = parts[parts.length - 1];
    if (fileNameExt.toLowerCase() === 'readme.md') continue;

    const fileName = fileNameExt.replace(/\.md$/, '');
    const noteId = `feeds/${dirName}/${dateKey}/${fileName}`;
    const noteTitle = fileToDisplayName(fileNameExt);
    const content = readFileSync(join(corpusRoot, rel), 'utf8');

    const sections = parseDocumentSections(content);
    let position = 0;
    for (const section of sections) {
      const blockContentId = section.scriptBlock?.contentId ?? undefined;
      index.push({
        id: `static:${noteId}:${section.id}:1`,
        noteId,
        segmentId: section.id,
        segmentVersion: 1,
        position: position++,
        dataType: toSegmentDataType(section),
        blockContentId,
        rawContent: section.displayContent,
        noteTitle,
        createdAt: feedDateToCreatedAt(dateKey),
        isStatic: true,
        sourceId: `feed:${noteId}`,
        sourcePath: rel,
      });
    }
  }

  // Guides: canvas/{dir}/{file}.md — the syntax/guide corpus. Indexed pages
  // are exactly the routable ones (`template: canvas` + a non-degenerate
  // frontmatter `route:`); noteId is that route minus the leading slash, so a
  // Library row deep-links straight to the canvas page. READMEs and routeless
  // fragments fail the same test (home/README's route is '/', with no path
  // identity) — no special-casing needed.
  for (const file of listMarkdownFiles(join(markdownDir, 'canvas'))) {
    const rel = `markdown/canvas/${file}`;
    const content = readFileSync(join(corpusRoot, rel), 'utf8');
    const noteId = canvasRouteSlug(content);
    if (!noteId) continue;

    const fileNameExt = file.split('/').pop() ?? file;
    const noteTitle = fileToDisplayName(fileNameExt);
    const createdAt = getFileCreatedAt(rel, corpusRoot);
    const sections = parseDocumentSections(content);
    let position = 0;
    for (const section of sections) {
      const blockContentId = section.scriptBlock?.contentId ?? undefined;
      index.push({
        id: `static:${noteId}:${section.id}:1`,
        noteId,
        segmentId: section.id,
        segmentVersion: 1,
        position: position++,
        dataType: toSegmentDataType(section),
        blockContentId,
        rawContent: section.displayContent,
        noteTitle,
        createdAt,
        isStatic: true,
        sourceId: `guides:${noteId}`,
        sourcePath: rel,
      });
    }
  }

  return index;
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

export function loadExistingEffortMap(markdownDir: string): {
  slugs: Set<string>;
  aliasToCanonical: Map<string, string>;
} {
  const slugs = new Set<string>();
  const aliasToCanonical = new Map<string, string>();
  const effortsDir = join(markdownDir, 'efforts');
  for (const file of listMarkdownFiles(effortsDir)) {
    const raw = readFileSync(join(effortsDir, file), 'utf8');
    const parsed = parseEffortFile(raw);
    if (!parsed) continue;

    slugs.add(parsed.slug);
    aliasToCanonical.set(parsed.slug, parsed.slug);
    aliasToCanonical.set(parsed.label.toLowerCase(), parsed.slug);
    aliasToCanonical.set(parsed.slug.replace(/-/g, ' '), parsed.slug);

    for (const alias of parsed.aliases) {
      aliasToCanonical.set(alias.toLowerCase(), parsed.slug);
      aliasToCanonical.set(alias.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), parsed.slug);
    }
  }

  return { slugs, aliasToCanonical };
}

export function discoverUncatalogedEfforts(markdownDir: string, corpusRoot: string): DiscoveredEffort[] {
  const { slugs, aliasToCanonical } = loadExistingEffortMap(markdownDir);
  const blocks = buildBlockIndexRows(markdownDir, corpusRoot);
  const discovered = new Map<string, { label: string; rawLabels: Set<string> }>();

  for (const block of blocks) {
    if (block.dataType !== 'wod' || !block.rawContent) continue;
    const script = parseScript(block.rawContent);
    for (const statement of script.statements) {
      const effortMetric = statement.metrics?.getMetric?.('effort');
      const effortLabel = (effortMetric && typeof effortMetric.value === 'string' ? effortMetric.value : undefined) ?? statement.exerciseId;
      if (!effortLabel) continue;

      const slugified = effortLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!slugified || NON_EFFORT_SLUGS[slugified]) continue;

      const canonical = aliasToCanonical.get(slugified) ?? aliasToCanonical.get(effortLabel.toLowerCase());
      if (canonical && slugs.has(canonical)) continue;

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
 * Requires a second pass over the source markdown to parse the script AST,
 * which is safe because the corpus is static and the pass is compile-time.
 */
export function buildBlockEffortRows(markdownDir: string, corpusRoot: string): BlockEffort[] {
  const efforts: BlockEffort[] = [];
  const { aliasToCanonical } = loadExistingEffortMap(markdownDir);
  const blocks = buildBlockIndexRows(markdownDir, corpusRoot);
  for (const block of blocks) {
    if (block.dataType !== 'wod' || !block.rawContent) continue;
    const script = parseScript(block.rawContent);
    const effortSlugs = extractEffortSlugs(script.statements);
    for (const rawSlug of effortSlugs) {
      const norm = rawSlug.toLowerCase().trim();
      const canonicalSlug =
        aliasToCanonical.get(norm) ??
        aliasToCanonical.get(norm.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) ??
        norm.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!canonicalSlug || NON_EFFORT_SLUGS[canonicalSlug] || NON_EFFORT_SLUGS[norm]) {
        continue;
      }
      efforts.push({
        id: `${block.id}:${canonicalSlug}`,
        noteId: block.noteId,
        blockId: block.segmentId,
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
 * legacy route parent id → canonical corpus source path. The API migration
 * (and the runtime importer's noteId mapping) reconcile legacy static block
 * rows — whose noteId is a path stem — onto imported notes through the full
 * sourcePath; ambiguity here is a generation bug and fails the build.
 */
export function buildStaticParentMap(blockRows: BlockIndexRow[]): Record<string, { sourcePath: string; sourceId?: string }> {
  const map: Record<string, { sourcePath: string; sourceId?: string }> = {};
  for (const row of blockRows) {
    if (!row.sourcePath) continue;
    const prev = map[row.noteId];
    if (prev && prev.sourcePath !== row.sourcePath) {
      throw new Error(
        `[generate-seed] ambiguous static parent '${row.noteId}' maps to both '${prev.sourcePath}' and '${row.sourcePath}'`,
      );
    }
    map[row.noteId] = { sourcePath: row.sourcePath, sourceId: row.sourceId };
  }
  return map;
}

// ── Generation ────────────────────────────────────────────────────────────

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function generateSeed(options: GenerateSeedOptions = {}): GenerateSeedResult {
  const t0 = Date.now();
  const passMs = { scan: 0, blockIndex: 0, blockEfforts: 0, write: 0 };
  const corpusRoot = options.corpusRoot ?? process.cwd();
  const markdownDir = options.markdownDir ?? join(corpusRoot, 'markdown');
  const outDir = options.outDir ?? join(corpusRoot, 'dist');
  const gitVersion = options.version !== undefined
    ? { ...resolveGitVersion(corpusRoot), version: options.version }
    : resolveGitVersion(corpusRoot);
  if (options.scaffoldDiscoveredEfforts) {
    const discovered = discoverUncatalogedEfforts(markdownDir, corpusRoot);
    if (discovered.length > 0) {
      scaffoldDiscoveredEfforts(discovered, markdownDir);
    }
  }

  const tScan = Date.now();
  const paths = collectCorpusMarkdown(markdownDir);
  const groups = partitionIntoChunks(paths);
  gateDashboards(groups, corpusRoot);
  if (options.templateFile && existsSync(options.templateFile)) {
    const templateRowPath = options.templateRowPath
      ?? relative(corpusRoot, options.templateFile).split('\\').join('/');
    groups.push({ id: TEMPLATE_CHUNK_ID, files: [templateRowPath] });
  }
  passMs.scan = Date.now() - tScan;

  const chunksDir = join(outDir, 'chunks');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(chunksDir, { recursive: true });

  const manifestChunks: ManifestChunk[] = [];
  let totalFiles = 0;

  const tWrite = Date.now();
  for (const { id, files } of groups) {
    // The template chunk's row path is the host-pinned historical identity,
    // not a path inside this repo — read it from the template file itself.
    const templateSource = id === TEMPLATE_CHUNK_ID ? options.templateFile : undefined;
    const rows: SeedRow[] = files.map((p) => ({
      path: p,
      content: readFileSync(templateSource ?? join(corpusRoot, p), 'utf8'),
    }));
    const bytes = Buffer.from(JSON.stringify(rows), 'utf8');
    const sha = sha256Hex(bytes);
    const file = `chunks/${id}.${sha.slice(0, 8)}.json`;
    writeFileSync(join(outDir, file), bytes);
    manifestChunks.push({ id, path: file, sha256: sha, bytes: bytes.length, count: rows.length });
    totalFiles += rows.length;
  }

  // ── Block-index chunks: precomputed corpus rows for the `block_index` store ──
  const tBlockIndex = Date.now();
  const blockRows = buildBlockIndexRows(markdownDir, corpusRoot);
  passMs.blockIndex = Date.now() - tBlockIndex;
  // Legacy parent → sourcePath canonical map, for API-side migration of real
  // snapshots whose static rows predate the sourcePath field.
  writeFileSync(
    join(outDir, 'block-parent-map.json'),
    JSON.stringify(buildStaticParentMap(blockRows), null, 2) + '\n',
  );
  for (let i = 0; blockRows.length > 0 && i * BLOCK_INDEX_ROWS_PER_CHUNK < blockRows.length; i++) {
    const part = blockRows.slice(i * BLOCK_INDEX_ROWS_PER_CHUNK, (i + 1) * BLOCK_INDEX_ROWS_PER_CHUNK);
    if (part.length === 0) break;
    const id = `${BLOCK_INDEX_CHUNK_PREFIX}${i}`;
    const bytes = Buffer.from(JSON.stringify(part), 'utf8');
    const sha = sha256Hex(bytes);
    const file = `chunks/${id}.${sha.slice(0, 8)}.json`;
    writeFileSync(join(outDir, file), bytes);
    manifestChunks.push({ id, path: file, sha256: sha, bytes: bytes.length, count: part.length, kind: 'block-index' satisfies ChunkKind });
  }

  // ── Block-efforts chunks: precomputed exercise containment rows ──
  const tBlockEfforts = Date.now();
  const effortRows = buildBlockEffortRows(markdownDir, corpusRoot);
  passMs.blockEfforts = Date.now() - tBlockEfforts;
  for (let i = 0; effortRows.length > 0 && i * BLOCK_INDEX_ROWS_PER_CHUNK < effortRows.length; i++) {
    const part = effortRows.slice(i * BLOCK_INDEX_ROWS_PER_CHUNK, (i + 1) * BLOCK_INDEX_ROWS_PER_CHUNK);
    if (part.length === 0) break;
    const id = `${BLOCK_EFFORTS_CHUNK_PREFIX}${i}`;
    const bytes = Buffer.from(JSON.stringify(part), 'utf8');
    const sha = sha256Hex(bytes);
    const file = `chunks/${id}.${sha.slice(0, 8)}.json`;
    writeFileSync(join(outDir, file), bytes);
    manifestChunks.push({ id, path: file, sha256: sha, bytes: bytes.length, count: part.length, kind: 'block-efforts' satisfies ChunkKind });
  }
  passMs.write = Date.now() - tWrite;

  const manifest: SeedManifest = {
    schema: SEED_SCHEMA,
    version: gitVersion.version,
    versionLabel: gitVersion.versionLabel,
    commit: gitVersion.commit,
    dirty: gitVersion.dirty,
    builtAt: new Date().toISOString(),
    chunks: manifestChunks,
  };
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
