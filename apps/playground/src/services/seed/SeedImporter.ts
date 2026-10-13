import { assertSeedManifest, assertSeedRows, seedNoteId, type SeedChunkResult } from '@bitcobblers/wod-wiki-engine';
import { CANVAS_CHUNK_ID, SEED_SCHEMA, emptySeedMeta, seedMetaKey, type SeedMetaRecord } from '@/types/seed';
import type { ISeedSource } from './ISeedSource';
import type { SeedImportStorage } from './SeedImportStorage';
export { seedNoteId };
export interface SeedImportResult extends SeedChunkResult {
  status: 'imported' | 'current';
  appliedChunks: number;
}
export type SeedImportProgress = SeedChunkResult & {
  phase: 'fetching' | 'applying' | 'committed' | 'finalizing';
  chunkId: string | null;
  completedChunks: number;
  totalChunks: number;
};
export class SeedImporter {
  constructor(private readonly storage: SeedImportStorage, private readonly source: ISeedSource, private readonly sourceId: string, private readonly now: () => number = Date.now) {}
  async applyAll(opts: { forceAll?: boolean; onFirstPaintApplied?: () => void; onProgress?: (progress: SeedImportProgress) => void } = {}): Promise<SeedImportResult> {
    const manifest = assertSeedManifest(await this.source.fetchManifest());
    const key = seedMetaKey(this.sourceId);
    let expected = await this.storage.getSeedMeta(key);
    if (expected && expected.schema !== SEED_SCHEMA) throw new Error('Incompatible seed checkpoint; recreate storage');
    let meta = expected ?? emptySeedMeta(key);
    if (manifest.version < meta.seedVersion) throw new Error('Seed manifest is older than the stored checkpoint');
    const metadataChanged = manifest.version !== meta.seedVersion || manifest.builtAt !== meta.builtAt;
    const plan = manifest.chunks.filter((c) => opts.forceAll || metadataChanged || meta.chunks[c.id]?.sha256 !== c.sha256);
    plan.sort((a, b) => Number(b.id === CANVAS_CHUNK_ID) - Number(a.id === CANVAS_CHUNK_ID));
    const vanished = Object.keys(meta.chunks).filter((id) => !manifest.chunks.some((c) => c.id === id));
    const result: SeedImportResult = { status: 'current', appliedChunks: 0, totalNotes: 0, totalEfforts: 0, totalBlocks: 0, skippedUserOwned: 0, deleted: 0, addedNotes: 0, updatedNotes: 0 };
    if (!plan.length && !vanished.length && !metadataChanged) return result;
    result.status = 'imported';
    const report = (phase: SeedImportProgress['phase'], chunkId: string | null) => opts.onProgress?.({ phase, chunkId, completedChunks: result.appliedChunks, totalChunks: plan.length, totalNotes: result.totalNotes, totalEfforts: result.totalEfforts, totalBlocks: result.totalBlocks, skippedUserOwned: result.skippedUserOwned, deleted: result.deleted, addedNotes: result.addedNotes, updatedNotes: result.updatedNotes });
    for (let i = 0; i < plan.length;) {
      // ponytail: four fetches bound cold-import memory; tune from actual import traces.
      const batch = plan.slice(i, i + (plan[i]?.id === CANVAS_CHUNK_ID ? 1 : 4));
      const pending = batch.map((chunk) => ({ chunk, request: this.source.fetchChunk(chunk.path).then((payload) => ({ payload }), (error: unknown) => ({ error })) }));
      for (const { chunk, request } of pending) {
        report('fetching', chunk.id);
        const fetched = await request;
        if ('error' in fetched) throw fetched.error;
        const rows = assertSeedRows(fetched.payload);
        if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
        const noteIds = await Promise.all(rows.map((r) => seedNoteId(r.path)));
        const next: SeedMetaRecord = { ...meta, chunks: { ...meta.chunks, [chunk.id]: { sha256: chunk.sha256, noteIds } }, importedAt: this.now() };
        report('applying', chunk.id);
        const committed = await this.storage.applyChunk({ chunkId: chunk.id, rows, manifest, expectedMeta: expected, meta: next });
        result.totalNotes += committed.totalNotes; result.totalEfforts += committed.totalEfforts; result.totalBlocks += committed.totalBlocks; result.skippedUserOwned += committed.skippedUserOwned; result.deleted += committed.deleted; result.addedNotes += committed.addedNotes; result.updatedNotes += committed.updatedNotes;
        result.appliedChunks++;
        meta = next; expected = next;
        report('committed', chunk.id);
        if (chunk.id === CANVAS_CHUNK_ID) opts.onFirstPaintApplied?.();
      }
      i += batch.length;
    }
    for (const chunkId of vanished) {
      const chunks = { ...meta.chunks };
      delete chunks[chunkId];
      const next = { ...meta, chunks, importedAt: this.now() };
      const committed = await this.storage.applyChunk({ chunkId, rows: [], manifest, expectedMeta: expected, meta: next });
      result.deleted += committed.deleted;
      meta = next; expected = next;
    }
    const next = { ...meta, schema: SEED_SCHEMA, seedVersion: manifest.version, builtAt: manifest.builtAt, importedAt: this.now() };
    await this.storage.applyChunk({ chunkId: null, rows: [], manifest, expectedMeta: expected, meta: next });
    report('finalizing', null);
    return result;
  }
}
