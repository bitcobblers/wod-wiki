/**
 * `wod seed` — import compiled seed artifacts (manifest.json + content-
 * hashed chunks) into the local sqlite database.
 *
 * Replicates the playground SeedImporter's mapping (SeedRow → note +
 * immutable segment + tags/pages + effort registry rows; static block rows
 * re-keyed onto imported note UUIDs through their sourcePath) so a CLI-seeded
 * db classifies identically to an app-seeded one. The per-source checkpoint
 * in the `meta` store makes re-seeds idempotent and lets shrunken corpora
 * sweep their vanished rows (seed-owned only — user edits stand).
 */

import type {
  BlockEffort,
  BlockIndexRow,
  Note,
  NoteSegment,
  Page,
  PageNote,
  Tag,
  NoteTag,
  TxOp,
} from '@bitcobblers/wod-wiki-storage';
import { loadSql, nodeCrypto, nodeFs, nodePath, randomId, uuid5, formatV5Digest, CLI_UUID_NAMESPACE, type CliDb, type SqlApi } from './db';

/** Fixed namespace — must match SeedImporter.SEED_NAMESPACE byte-for-byte. */
const SEED_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
const SEED_SCHEMA = 7;
const CANVAS_CHUNK_ID = 'canvas';
const DASHBOARDS_CHUNK_ID = 'dashboards';
const EFFORTS_CHUNK_ID = 'efforts';
const TEMPLATE_CHUNK_ID = 'template';

// ---------------------------------------------------------------------------
// Manifest / row contract (mirrors ../wod-wiki-seed/src/contract.ts)
// ---------------------------------------------------------------------------

interface ManifestChunkRef {
  id: string;
  path: string;
  sha256: string;
  bytes?: number;
  count?: number;
  kind?: 'notes' | 'block-index' | 'block-efforts';
}

interface SeedManifest {
  schema?: number;
  version: number;
  builtAt: string;
  chunks: ManifestChunkRef[];
}

interface SeedRow { path: string; content: string }

interface SeedMetaChunkRef { sha256: string; noteIds?: string[]; blockIds?: string[] }

interface SeedMetaRecord {
  key: string;
  schema: number;
  seedVersion: number;
  builtAt: string;
  importedAt: number;
  chunks: Record<string, SeedMetaChunkRef>;
  claim: null;
}

// ---------------------------------------------------------------------------
// Frontmatter — shared helpers live in ../exchange (CLI ⇄ website parity);
// this module keeps only the seed-classification logic.
// ---------------------------------------------------------------------------

import { extractTypedTags, markdownToEffort, readFrontmatterMeta, type TypedTagItem } from '../exchange';

const scalarOf = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

// ---------------------------------------------------------------------------
// Seed identity + classification (mirrors apps/playground/src/types/seed.ts)
// ---------------------------------------------------------------------------

/** Playground-exact seedNoteId: SHA-1 over `${SEED_NAMESPACE}:${path}`, v5-munged. */
export function seedNoteId(path: string): string {
  return formatV5Digest(nodeCrypto().createHash('sha1').update(`${SEED_NAMESPACE}:${path}`).digest());
}

function titleFromPath(path: string): string {
  const stem = path.split('/').pop() ?? path;
  return stem
    .replace(/\.md$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function catalogForChunkId(chunkId: string): string | undefined {
  const match = /^(?:collection|feed)\.(.+)$/.exec(chunkId);
  const value = match?.[1];
  return value && value !== '_root' ? value : undefined;
}

function canvasRouteSlug(content: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (fm?.[1] && !/^template:\s*canvas\s*$/m.test(fm[1])) return null;
  const route = fm?.[1]?.match(/^route:\s*(\S+)\s*$/m)?.[1];
  if (!route) return null;
  return route.replace(/^\//, '') || null;
}

function seedNoteSourceId(path: string, content: string, chunkId: string): string | undefined {
  const parts = path.split('/');
  const stem = (parts[parts.length - 1] ?? '').replace(/\.md$/i, '');
  const under = parts.slice(2).map((p) => p.replace(/\.md$/i, '')).join('/');
  if (chunkId === CANVAS_CHUNK_ID) {
    const route = canvasRouteSlug(content);
    return route ? `guides:${route}` : `guides:${under}`;
  }
  if (chunkId === DASHBOARDS_CHUNK_ID) return 'dashboards';
  if (chunkId === EFFORTS_CHUNK_ID) return 'efforts';
  if (chunkId === TEMPLATE_CHUNK_ID) return 'playground';
  if (chunkId.startsWith('collection.')) {
    const catalog = catalogForChunkId(chunkId);
    if (!catalog) return 'collection:_root';
    return stem.toLowerCase() === 'readme' ? `collection:${catalog}` : `collection:${catalog}/${stem}`;
  }
  if (chunkId.startsWith('feed.')) return `feed:feeds/${under}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface SeedSourceSummary {
  sourceId: string;
  version: number;
  notes: number;
  efforts: number;
  blocks: number;
  blockEfforts: number;
  deleted: number;
  skippedUserOwned: number;
}

interface BuiltNoteRecord {
  note: Note;
  segment: NoteSegment;
  tags: TypedTagItem[];
  page?: Page;
  pageNote?: PageNote;
  rawContent: string;
  sourcePath: string;
}

function buildNoteRecord(row: SeedRow, chunkId: string, seedVersion: number): BuiltNoteRecord {
  const id = seedNoteId(row.path);
  const createdAt = seedVersion; // deterministic, mirrors SeedImporter
  const meta = readFrontmatterMeta(row.content);
  // General `tags:` plus typed keys (equipment, quality, …) — SeedImporter parity.
  const tags = extractTypedTags(row.content);

  let date: number | undefined;
  let page: Page | undefined;
  let pageNote: PageNote | undefined;
  const rawDate = scalarOf(meta['date']);
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    date = new Date(`${rawDate}T12:00:00Z`).getTime();
  }
  const slug = scalarOf(meta['slug']);
  if (slug) {
    const pageId = seedNoteId(`page:${slug}`);
    page = { id: pageId, slug, title: titleFromPath(row.path), createdAt };
    pageNote = { id: seedNoteId(`pagenote:${slug}:${row.path}`), pageId, noteId: id, createdAt };
  }

  const sourceId = seedNoteSourceId(row.path, row.content, chunkId);
  if (!sourceId) {
    throw new Error(`[wod seed] chunk "${chunkId}" row "${row.path}" has no source family — refusing to import it as journal`);
  }
  const metaTitle = scalarOf(meta['title']);
  return {
    note: {
      id,
      title: (metaTitle?.trim() || titleFromPath(row.path)),
      date,
      createdAt,
      type: chunkId === DASHBOARDS_CHUNK_ID ? 'dashboard' : 'note',
      sourceId,
      catalog: catalogForChunkId(chunkId),
      seedOrigin: 'seed',
      seedVersion,
      seedChunkId: chunkId,
      sourcePath: row.path,
    },
    segment: {
      id: `seed:${id}`,
      version: 1,
      noteId: id,
      position: 0,
      dataType: 'markdown',
      data: null,
      rawContent: row.content,
      createdAt,
    },
    tags,
    page,
    pageNote,
    rawContent: row.content,
    sourcePath: row.path,
  };
}

/** Effort materialization lives in ../exchange (markdownToEffort) so the
 * website and CLI parse effort files identically. */

async function metaRecord(sql: SqlApi, db: CliDb['db'], sourceId: string): Promise<SeedMetaRecord> {
  const rows = (await sql.listRows(db, sql.storeDefinition('meta'))) as Array<{ key: string } & Record<string, unknown>>;
  const existing = rows.find((r) => r.key === `seed:${sourceId}`);
  return (existing as SeedMetaRecord | undefined) ?? {
    key: `seed:${sourceId}`,
    schema: SEED_SCHEMA,
    seedVersion: 0,
    builtAt: '',
    importedAt: 0,
    chunks: {},
    claim: null,
  };
}

async function applyOps(db: CliDb, ops: TxOp[]): Promise<void> {
  if (ops.length === 0) return;
  const sql = await loadSql();
  await db.db.transaction(async (tx) => {
    await sql.refreshDomain(tx, ops);
  });
}

/** Import one compiled seed directory (manifest.json + chunks/). */
export async function importSeedDir(db: CliDb, dir: string, sourceId: string): Promise<SeedSourceSummary> {
  const sql = await loadSql();
  const fs = nodeFs();
  const source = sourceId || nodePath().basename(dir);
  const manifest = JSON.parse(fs.readFileSync(nodePath().resolve(dir, 'manifest.json'), 'utf-8')) as SeedManifest;
  const prior = await metaRecord(sql, db.db, source);
  const notesById = new Map(
    ((await sql.listRows(db.db, sql.storeDefinition('notes'))) as Array<{ id: string } & Record<string, unknown>>)
      .map((row) => [row.id, row as unknown as Note]),
  );
  const tagRowByLabel = new Map(
    ((await sql.listRows(db.db, sql.storeDefinition('tags'))) as Tag[]).map((t) => [t.label, t]),
  );

  const summary: SeedSourceSummary = {
    sourceId: source,
    version: manifest.version,
    notes: 0,
    efforts: 0,
    blocks: 0,
    blockEfforts: 0,
    deleted: 0,
    skippedUserOwned: 0,
  };
  const nextMeta: SeedMetaRecord = {
    ...prior,
    schema: SEED_SCHEMA,
    seedVersion: manifest.version,
    builtAt: manifest.builtAt,
    importedAt: Date.now(),
    chunks: {},
  };

  // Notes chunks first: static block rows re-key through the sourcePath map.
  const ordered = [
    ...manifest.chunks.filter((c) => (c.kind ?? 'notes') === 'notes'),
    ...manifest.chunks.filter((c) => c.kind === 'block-index'),
    ...manifest.chunks.filter((c) => c.kind === 'block-efforts'),
  ];
  const bySourcePath = new Map<string, string>();
  const noteIdsByChunk: Record<string, string[]> = {};
  const blockIdsByChunk: Record<string, string[]> = {};

  for (const chunk of ordered) {
    const payload = JSON.parse(fs.readFileSync(nodePath().resolve(dir, chunk.path), 'utf-8')) as unknown;
    const ops: TxOp[] = [];

    if ((chunk.kind ?? 'notes') === 'notes') {
      const rows = payload as SeedRow[];
      const built = rows.map((row) => buildNoteRecord(row, chunk.id, manifest.version));
      const noteIds: string[] = [];
      for (const record of built) {
        bySourcePath.set(record.sourcePath, record.note.id);
        const existing = notesById.get(record.note.id);
        if (existing && existing.seedOrigin !== 'seed') {
          summary.skippedUserOwned += 1;
          continue;
        }
        noteIds.push(record.note.id);
        ops.push({ op: 'put', store: 'notes', value: record.note });
        ops.push({ op: 'put', store: 'segments', value: record.segment });
        if (record.page) ops.push({ op: 'put', store: 'page', value: record.page });
        if (record.pageNote) ops.push({ op: 'put', store: 'page_notes', value: record.pageNote });
        for (const item of record.tags) {
          const label = item.label;
          let tag = tagRowByLabel.get(label);
          if (!tag) {
            tag = { id: randomId(), label, type: item.type, createdAt: Date.now() };
            tagRowByLabel.set(label, tag);
            ops.push({ op: 'put', store: 'tags', value: tag satisfies Tag });
          } else if (item.type && !tag.type) {
            // Upgrade an untyped tag to its typed use (SeedImportStorage parity).
            tag = { ...tag, type: item.type };
            tagRowByLabel.set(label, tag);
            ops.push({ op: 'put', store: 'tags', value: tag satisfies Tag });
          }
          const tagId = tag.id;
          ops.push({
            op: 'put',
            store: 'note_tags',
            // Deterministic junction id — re-seeds must upsert the same row
            // (note_tags has a unique [noteId, tagId] index).
            value: { id: uuid5(CLI_UUID_NAMESPACE, `note-tag:${record.note.id}:${tagId}`), noteId: record.note.id, tagId } satisfies NoteTag,
          });
        }
        if (chunk.id === EFFORTS_CHUNK_ID) {
          const effort = markdownToEffort(record.rawContent);
          if (effort) {
            ops.push({ op: 'put', store: 'efforts', value: { ...effort, registrySource: 'bundled' } });
            summary.efforts += 1;
          }
        }
      }
      // Vanished rows: prior membership minus current, seed-owned only.
      const priorIds = prior.chunks[chunk.id]?.noteIds ?? [];
      const goneIds = priorIds.filter((id) => !noteIds.includes(id) && notesById.get(id)?.seedOrigin === 'seed');
      for (const id of goneIds) {
        ops.push(...(await noteCascadeOps(sql, db, id)));
        summary.deleted += 1;
      }
      noteIdsByChunk[chunk.id] = rows.map((row) => seedNoteId(row.path));
      nextMeta.chunks[chunk.id] = { sha256: chunk.sha256, noteIds: noteIdsByChunk[chunk.id] };
      summary.notes += noteIds.length;
      await applyOps(db, ops);
      continue;
    }

    // Static block rows: re-key noteId through the sourcePath map.
    const rows = (payload as Array<BlockIndexRow & BlockEffort>).filter((row) => row.isStatic === true);
    const rekeyed = rows.map((row) => {
      const noteId = row.sourcePath ? bySourcePath.get(row.sourcePath) : undefined;
      if (!noteId) {
        throw new Error(
          `[wod seed] static row ${row.id}: sourcePath "${row.sourcePath ?? ''}" has no imported note — chunk aborted`,
        );
      }
      return chunk.kind === 'block-efforts'
        ? { ...row, noteId }
        : { ...row, noteId, routeId: row.noteId };
    });
    const store = chunk.kind === 'block-index' ? 'block_index' : 'block_efforts';
    for (const row of rekeyed) ops.push({ op: 'put', store, value: row });
    const priorBlockIds = prior.chunks[chunk.id]?.blockIds ?? [];
    const writtenIds = new Set(rekeyed.map((row) => row.id));
    const goneBlocks = priorBlockIds.filter((id) => !writtenIds.has(id));
    for (const id of goneBlocks) ops.push({ op: 'delete', store, key: id });
    summary.deleted += goneBlocks.length;
    blockIdsByChunk[chunk.id] = (payload as Array<{ id: string }>).map((row) => row.id);
    nextMeta.chunks[chunk.id] = { sha256: chunk.sha256, blockIds: blockIdsByChunk[chunk.id] };
    if (chunk.kind === 'block-index') summary.blocks += rekeyed.length;
    else summary.blockEfforts += rekeyed.length;
    await applyOps(db, ops);
  }

  // Vanished chunks: membership the manifest no longer declares.
  const manifestIds = new Set(manifest.chunks.map((c) => c.id));
  for (const [chunkId, checkpoint] of Object.entries(prior.chunks)) {
    if (manifestIds.has(chunkId)) continue;
    const sweep: TxOp[] = [];
    for (const id of checkpoint.noteIds ?? []) {
      if (notesById.get(id)?.seedOrigin === 'seed') {
        sweep.push(...(await noteCascadeOps(sql, db, id)));
        summary.deleted += 1;
      }
    }
    for (const id of checkpoint.blockIds ?? []) {
      sweep.push({ op: 'delete', store: 'block_index', key: id });
      summary.deleted += 1;
    }
    await applyOps(db, sweep);
  }

  await applyOps(db, [{ op: 'put', store: 'meta', value: nextMeta }]);
  return summary;
}

/** Delete a seed note plus its segments and derived block rows. */
async function noteCascadeOps(sql: SqlApi, db: CliDb, noteId: string): Promise<TxOp[]> {
  const ops: TxOp[] = [{ op: 'delete', store: 'notes', key: noteId }];
  for (const store of ['segments', 'block_index', 'block_efforts', 'note_tags'] as const) {
    // Rows came out of our own store tables; shape is the store contract.
    const rows = (await sql.listRows(db.db, sql.storeDefinition(store), { only: noteId }, undefined, 'by-note')) as Array<{ id: string; version?: number }>;
    for (const row of rows) {
      // segments keyPath is [id, version]; block rows key on id alone.
      ops.push({ op: 'delete', store, key: store === 'segments' ? [row.id, row.version ?? 1] : row.id });
    }
  }
  return ops;
}

/** Default bundled sources: <cwd>/apps/playground/public/seed/{core,community}. */
export function defaultSeedDirs(cwd: string): string[] {
  const base = nodePath().resolve(cwd, 'apps', 'playground', 'public', 'seed');
  return ['core', 'community']
    .map((id) => nodePath().resolve(base, id))
    .filter((dir) => nodeFs().existsSync(nodePath().resolve(dir, 'manifest.json')));
}
