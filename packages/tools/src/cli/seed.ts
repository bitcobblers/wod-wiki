import { nodeFs, nodePath, type CliDb } from './db';
import {
  applySeedChunk,
  seedNoteId,
  type SeedChunkResult,
  assertSeedManifest,
  assertSeedRows,
  CANVAS_CHUNK_ID,
  SEED_SCHEMA,
  emptySeedMeta,
  seedMetaKey,
  type SeedMetaRecord,
} from '@bitcobblers/wod-wiki-engine';

export { seedNoteId };
export interface SeedSourceSummary {
  sourceId: string;
  version: number;
  notes: number;
  efforts: number;
  equipment: number;
  blocks: number;
  blockEfforts: number;
  deleted: number;
  skippedUserOwned: number;
}
export async function importSeedDir(db: CliDb, dir: string, sourceId: string): Promise<SeedSourceSummary> {
  const fs = nodeFs(), path = nodePath();
  const source = sourceId || path.basename(dir);
  const manifest = assertSeedManifest(JSON.parse(fs.readFileSync(path.resolve(dir, 'manifest.json'), 'utf-8')));
  const key = seedMetaKey(source);
  const stored = await db.storage.readonly('meta').get(key) as SeedMetaRecord | undefined;
  // Schema cutover: a checkpoint from another SEED_SCHEMA owns nothing —
  // reset and re-import (seed rows are reclaimed by exact note id; user
  // rows untouched). Data is retained, never deleted.
  let expected = stored?.schema === SEED_SCHEMA ? stored : undefined;
  let meta = expected ?? emptySeedMeta(key);
  if (manifest.version < meta.seedVersion) throw new Error('Seed manifest is older than stored checkpoint');
  const summary: SeedSourceSummary = { sourceId: source, version: manifest.version, notes: 0, efforts: 0, equipment: 0, blocks: 0, blockEfforts: 0, deleted: 0, skippedUserOwned: 0 };
  const metadataChanged = manifest.version !== meta.seedVersion || manifest.builtAt !== meta.builtAt;
  const plan = manifest.chunks.filter((c) => metadataChanged || meta.chunks[c.id]?.sha256 !== c.sha256);
  plan.sort((a, b) => Number(b.id === CANVAS_CHUNK_ID) - Number(a.id === CANVAS_CHUNK_ID));
  const accumulate = (result: SeedChunkResult) => {
    summary.notes += result.totalNotes; summary.efforts += result.totalEfforts; summary.equipment += result.totalEquipment; summary.blocks += result.totalBlocks; summary.deleted += result.deleted; summary.skippedUserOwned += result.skippedUserOwned;
  };
  for (const chunk of plan) {
    const rows = assertSeedRows(JSON.parse(fs.readFileSync(path.resolve(dir, chunk.path), 'utf-8')));
    if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
    const next = { ...meta, chunks: { ...meta.chunks, [chunk.id]: { sha256: chunk.sha256, noteIds: await Promise.all(rows.map((r) => seedNoteId(r.path))) } }, importedAt: Date.now() };
    accumulate(await applySeedChunk(db.storage, { chunkId: chunk.id, rows, manifest, expectedMeta: expected, meta: next }));
    summary.blockEfforts += rows.reduce((count, row) => count + row.blockEfforts.length, 0);
    meta = next; expected = next;
  }
  for (const chunkId of Object.keys(meta.chunks)) {
    if (manifest.chunks.some((c) => c.id === chunkId)) continue;
    const chunks = { ...meta.chunks };
    delete chunks[chunkId];
    const next = { ...meta, chunks, importedAt: Date.now() };
    accumulate(await applySeedChunk(db.storage, { chunkId, rows: [], manifest, expectedMeta: expected, meta: next }));
    meta = next; expected = next;
  }
  if (plan.length || metadataChanged || Object.keys(meta.chunks).length !== Object.keys(expected?.chunks ?? {}).length) {
    const next = { ...meta, schema: SEED_SCHEMA, seedVersion: manifest.version, builtAt: manifest.builtAt, importedAt: Date.now() };
    await applySeedChunk(db.storage, { chunkId: null, rows: [], manifest, expectedMeta: expected, meta: next });
  }
  return summary;
}
export function defaultSeedDirs(cwd: string): string[] {
  const base = nodePath().resolve(cwd, 'apps', 'playground', 'public', 'seed');
  return ['core', 'community'].map((id) => nodePath().resolve(base, id)).filter((dir) => nodeFs().existsSync(nodePath().resolve(dir, 'manifest.json')));
}
