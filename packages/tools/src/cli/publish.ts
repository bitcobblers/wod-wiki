import { nodeCrypto, nodeFs, nodePath, type CliDb } from './db';
import type { BlockEffort, BlockIndexRow, Note } from '@bitcobblers/wod-wiki-storage';
import { catalogOfItem } from '@bitcobblers/wod-wiki-wql';
import { readFrontmatterMeta } from '@bitcobblers/wod-wiki-engine';
import { SEED_SCHEMA, type ManifestChunk, type SeedManifest, type SeedRow } from '../seedbuild/contract';
import { compileSeedRow } from '../seedbuild/compiler';
import { writeBuildReport } from '../seedbuild/report';

export interface PublishCatalogOptions {
  catalog?: string;
  outDir: string;
  version?: number;
}

export interface PublishCatalogResult {
  manifest: SeedManifest;
  outDir: string;
  catalogs: string[];
  totalNotes: number;
}

/**
 * Publishes catalog data from the database into a configured seed directory:
 * manifest.json, chunk files (SeedRow[] format), and report.html.
 * Compatible with `wod seed --source <outDir>` and playground custom sources.
 */
export async function publishCatalogSeed(
  db: CliDb,
  options: PublishCatalogOptions,
): Promise<PublishCatalogResult> {
  const t0 = Date.now();
  const fs = nodeFs();
  const path = nodePath();

  const allNotes = await db.storage.readonly('notes').getAll();
  if (allNotes.length === 0) {
    throw new Error(`[wod publish] No notes found in database ${db.path}`);
  }

  // Group notes by catalog
  const notesByCatalog = new Map<string, Note[]>();
  for (const note of allNotes) {
    const fm = readFrontmatterMeta(note.rawContent);
    const cat =
      (typeof fm['catalog'] === 'string' && fm['catalog'].trim()) ||
      (typeof fm['collection'] === 'string' && fm['collection'].trim()) ||
      note.catalog ||
      catalogOfItem(note);
    const key = cat || '__uncataloged__';
    const list = notesByCatalog.get(key) ?? [];
    list.push(note);
    notesByCatalog.set(key, list);
  }

  const targetCatalogs = new Map<string, Note[]>();
  if (options.catalog) {
    const matching = notesByCatalog.get(options.catalog);
    if (matching) {
      targetCatalogs.set(options.catalog, matching);
    } else if (notesByCatalog.has('__uncataloged__') && notesByCatalog.size === 1) {
      targetCatalogs.set(options.catalog, notesByCatalog.get('__uncataloged__')!);
    } else {
      const available = [...notesByCatalog.keys()].filter((k) => k !== '__uncataloged__');
      throw new Error(
        `[wod publish] Catalog "${options.catalog}" not found in ${db.path}.` +
          (available.length > 0 ? ` Available catalogs: ${available.join(', ')}` : ''),
      );
    }
  } else {
    for (const [cat, notes] of notesByCatalog.entries()) {
      targetCatalogs.set(cat === '__uncataloged__' ? 'default' : cat, notes);
    }
  }

  const allIndexRows = await db.storage.readonly('block_index').getAll();
  const allEffortRows = await db.storage.readonly('block_efforts').getAll();

  const indexByNote = new Map<string, BlockIndexRow[]>();
  for (const row of allIndexRows) {
    const list = indexByNote.get(row.noteId) ?? [];
    list.push(row);
    indexByNote.set(row.noteId, list);
  }

  const effortsByNote = new Map<string, BlockEffort[]>();
  for (const row of allEffortRows) {
    const list = effortsByNote.get(row.noteId) ?? [];
    list.push(row);
    effortsByNote.set(row.noteId, list);
  }

  const outDir = path.resolve(process.cwd(), options.outDir);
  const chunksDir = path.join(outDir, 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });

  const manifestChunks: ManifestChunk[] = [];
  let totalNotes = 0;
  const publishedCatalogs: string[] = [];

  for (const [catalogName, notes] of targetCatalogs.entries()) {
    publishedCatalogs.push(catalogName);
    const chunkRows: SeedRow[] = [];

    for (const note of notes) {
      const stem =
        (note.title || note.id)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'note';
      const notePath = note.sourcePath ?? `markdown/collections/${catalogName}/${stem}.md`;
      const noteBlockIndex = indexByNote.get(note.id) ?? [];
      const noteBlockEfforts = effortsByNote.get(note.id) ?? [];

      const blockIndex: BlockIndexRow[] =
        noteBlockIndex.length > 0
          ? noteBlockIndex.map((b) => ({
              ...b,
              isStatic: true,
              sourceId: b.sourceId ?? `collection:${catalogName}/${stem}`,
              sourcePath: b.sourcePath ?? notePath,
              catalog: catalogName,
            }))
          : compileSeedRow(notePath, note.rawContent, {
              routeId: `${catalogName}/${stem}`,
              sourceId: `collection:${catalogName}/${stem}`,
              // Authored frontmatter date first — exports keep the post's own
              // day, never the import/publish time.
              createdAt: note.date ?? note.createdAt,
              noteTitle: note.title,
            }).blockIndex;

      const blockEfforts: BlockEffort[] = noteBlockEfforts.map((e) => ({
        ...e,
        isStatic: true,
        sourcePath: e.sourcePath ?? notePath,
      }));

      chunkRows.push({
        path: notePath,
        content: note.rawContent,
        blocks: note.blocks,
        blockIndex,
        blockEfforts,
      });
    }
    const chunkId = `collection.${catalogName}`;
    const json = JSON.stringify(chunkRows);
    const digest = nodeCrypto().createHash('sha256').update(json).digest();
    const sha = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    const chunkFile = `chunks/${chunkId}.${sha.slice(0, 8)}.json`;
    fs.writeFileSync(path.join(outDir, chunkFile), json, 'utf-8');

    manifestChunks.push({
      id: chunkId,
      path: chunkFile,
      sha256: sha,
      bytes: Buffer.byteLength(json, 'utf8'),
      count: chunkRows.length,
      kind: 'notes',
    });
    totalNotes += chunkRows.length;
  }

  const manifest: SeedManifest = {
    schema: SEED_SCHEMA,
    version: options.version ?? 1,
    versionLabel: `v${options.version ?? 1}`,
    builtAt: new Date().toISOString(),
    chunks: manifestChunks,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  writeBuildReport(outDir, {
    manifest,
    totalMs: Date.now() - t0,
    passMs: { scan: 0, blockIndex: 0, parseGate: 0, blockEfforts: 0, write: Date.now() - t0 },
    fileCount: totalNotes,
    outDir,
  });

  return {
    manifest,
    outDir,
    catalogs: publishedCatalogs,
    totalNotes,
  };
}
