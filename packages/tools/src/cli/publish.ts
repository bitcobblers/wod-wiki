import { nodeCrypto, nodeFs, nodePath, type CliDb } from './db';
import type { BlockEffort, BlockEquipment, BlockIndexRow, Note } from '@bitcobblers/wod-wiki-storage';
import { notebookSlugOfSourceId } from '@bitcobblers/wod-wiki-wql';
import { SEED_SCHEMA, type ManifestChunk, type SeedManifest, type SeedRow } from '../seedbuild/contract';
import { compileSeedRow } from '../seedbuild/compiler';
import { writeBuildReport } from '../seedbuild/report';

export interface PublishNotebookOptions {
  notebook?: string;
  outDir: string;
  version?: number;
}

export interface PublishNotebookResult {
  manifest: SeedManifest;
  outDir: string;
  notebooks: string[];
  totalNotes: number;
}

/**
 * Publishes notebook data from the database into a configured seed directory:
 * manifest.json, chunk files (SeedRow[] format), and report.html.
 * Compatible with `wod seed --source <outDir>` and playground custom sources.
 */
export async function publishNotebookSeed(
  db: CliDb,
  options: PublishNotebookOptions,
): Promise<PublishNotebookResult> {
  const t0 = Date.now();
  const fs = nodeFs();
  const path = nodePath();

  const allNotes = await db.storage.readonly('notes').getAll();
  if (allNotes.length === 0) {
    throw new Error(`[wod publish] No notes found in database ${db.path}`);
  }

  // Group notes by notebook slug
  const notesByNotebook = new Map<string, Note[]>();
  for (const note of allNotes) {
    const slug = notebookSlugOfSourceId(note.sourceId);
    const key = slug || '__unassigned__';
    const list = notesByNotebook.get(key) ?? [];
    list.push(note);
    notesByNotebook.set(key, list);
  }

  const targetNotebooks = new Map<string, Note[]>();
  if (options.notebook) {
    const matching = notesByNotebook.get(options.notebook);
    if (matching) {
      targetNotebooks.set(options.notebook, matching);
    } else if (notesByNotebook.has('__unassigned__') && notesByNotebook.size === 1) {
      targetNotebooks.set(options.notebook, notesByNotebook.get('__unassigned__')!);
    } else {
      const available = [...notesByNotebook.keys()].filter((k) => k !== '__unassigned__');
      throw new Error(
        `[wod publish] Notebook "${options.notebook}" not found in ${db.path}.` +
          (available.length > 0 ? ` Available notebooks: ${available.join(', ')}` : ''),
      );
    }
  } else {
    for (const [slug, notes] of notesByNotebook.entries()) {
      targetNotebooks.set(slug === '__unassigned__' ? 'default' : slug, notes);
    }
  }

  const allIndexRows = await db.storage.readonly('block_index').getAll();
  const allEffortRows = await db.storage.readonly('block_efforts').getAll();
  const allEquipmentRows = await db.storage.readonly('block_equipment').getAll();

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

  const equipmentByNote = new Map<string, BlockEquipment[]>();
  for (const row of allEquipmentRows) {
    const list = equipmentByNote.get(row.noteId) ?? [];
    list.push(row);
    equipmentByNote.set(row.noteId, list);
  }

  const outDir = path.resolve(process.cwd(), options.outDir);
  const chunksDir = path.join(outDir, 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });

  const manifestChunks: ManifestChunk[] = [];
  let totalNotes = 0;
  const publishedNotebooks: string[] = [];

  for (const [notebookSlug, notes] of targetNotebooks.entries()) {
    publishedNotebooks.push(notebookSlug);
    const chunkRows: SeedRow[] = [];

    for (const note of notes) {
      const stem =
        (note.title || note.id)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'note';
      const notePath = note.sourcePath ?? `markdown/notebooks/${notebookSlug}/${stem}.md`;
      const noteBlockIndex = indexByNote.get(note.id) ?? [];
      const noteBlockEfforts = effortsByNote.get(note.id) ?? [];
      const noteBlockEquipment = equipmentByNote.get(note.id) ?? [];

      const blockIndex: BlockIndexRow[] =
        noteBlockIndex.length > 0
          ? noteBlockIndex.map((b) => ({
              ...b,
              isStatic: true,
              sourceId: b.sourceId ?? `notebook:${notebookSlug}/${stem}`,
              sourcePath: b.sourcePath ?? notePath,
            }))
          : compileSeedRow(notePath, note.rawContent, {
              routeId: `${notebookSlug}/${stem}`,
              sourceId: `notebook:${notebookSlug}/${stem}`,
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

      const blockEquipment: BlockEquipment[] = noteBlockEquipment.map((e) => ({
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
        blockEquipment,
      });
    }
    const chunkId = `notebook.${notebookSlug}`;
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
    notebooks: publishedNotebooks,
    totalNotes,
  };
}
