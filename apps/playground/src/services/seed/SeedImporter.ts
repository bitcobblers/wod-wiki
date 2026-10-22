import { assertSeedManifest, assertSeedRows, assertSeedRow, seedNoteId, type SeedChunkResult, type SeedRow } from '@bitcobblers/wod-wiki-engine';
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
  recordId?: string | null;
  completedRecords?: number;
  totalRecords?: number;
};
export interface SeedImportOptions {
  forceAll?: boolean;
  onFirstPaintApplied?: () => void;
  onProgress?: (progress: SeedImportProgress) => void;
  notebookIds?: string[];
  granularRecords?: boolean;
}
export class SeedImporter {
  constructor(private readonly storage: SeedImportStorage, private readonly source: ISeedSource, private readonly sourceId: string, private readonly now: () => number = Date.now) {}
  async applyAll(opts: SeedImportOptions = {}): Promise<SeedImportResult> {
    const manifest = assertSeedManifest(await this.source.fetchManifest());
    const key = seedMetaKey(this.sourceId);
    const stored = await this.storage.getSeedMeta(key);
    // Schema cutover: a checkpoint from another SEED_SCHEMA cannot own
    // anything — reset it and re-import from scratch. No data is deleted:
    // notes/projections are reclaimed by exact note id on re-import, and
    // user-owned rows are untouched.
    let expected = stored?.schema === SEED_SCHEMA ? stored : undefined;
    let meta = expected ?? emptySeedMeta(key);
    if (manifest.version < meta.seedVersion) throw new Error('Seed manifest is older than the stored checkpoint');
    const metadataChanged = manifest.version !== meta.seedVersion || manifest.builtAt !== meta.builtAt;
    const plan = manifest.chunks.filter((c) => {
      if (opts.notebookIds && !opts.notebookIds.includes(c.id)) return false;
      return opts.forceAll || metadataChanged || meta.chunks[c.id]?.sha256 !== c.sha256;
    });
    plan.sort((a, b) => Number(b.id === CANVAS_CHUNK_ID) - Number(a.id === CANVAS_CHUNK_ID));
    const vanished = Object.keys(meta.chunks).filter((id) => !manifest.chunks.some((c) => c.id === id));
    const result: SeedImportResult = { status: 'current', appliedChunks: 0, totalNotes: 0, totalEfforts: 0, totalEquipment: 0, totalBlocks: 0, skippedUserOwned: 0, deleted: 0, addedNotes: 0, updatedNotes: 0 };
    if (!plan.length && !vanished.length && !metadataChanged) return result;
    result.status = 'imported';
    const report = (phase: SeedImportProgress['phase'], chunkId: string | null, recordId?: string | null, completedRecords?: number, totalRecords?: number) =>
      opts.onProgress?.({
        phase,
        chunkId,
        completedChunks: result.appliedChunks,
        totalChunks: plan.length,
        totalNotes: result.totalNotes,
        totalEfforts: result.totalEfforts,
        totalEquipment: result.totalEquipment,
        totalBlocks: result.totalBlocks,
        skippedUserOwned: result.skippedUserOwned,
        deleted: result.deleted,
        addedNotes: result.addedNotes,
        updatedNotes: result.updatedNotes,
        ...(recordId !== undefined ? { recordId } : {}),
        ...(completedRecords !== undefined ? { completedRecords } : {}),
        ...(totalRecords !== undefined ? { totalRecords } : {}),
      });
    for (let i = 0; i < plan.length;) {
      // ponytail: four fetches bound cold-import memory; tune from actual import traces.
      const batch = plan.slice(i, i + (plan[i]?.id === CANVAS_CHUNK_ID ? 1 : 4));
      for (const chunk of batch) {
        let rows: SeedRow[];
        const notebook = manifest.notebooks?.find((n) => n.notebookId === chunk.id);
        const records = notebook?.records ?? chunk.records;
        if (opts.granularRecords && records && records.length > 0) {
          const commits = (!opts.forceAll && this.storage.getNoteCommits)
            ? await this.storage.getNoteCommits(records.map((r) => r.uuid))
            : undefined;
          const neededRecords = commits
            ? records.filter((r) => commits.get(r.uuid) !== r.commit)
            : records;
          if (neededRecords.length === 0 && !opts.forceAll) {
            result.appliedChunks++;
            continue;
          }
          const fetchedRows: SeedRow[] = [];
          let recIdx = 0;
          for (const rec of neededRecords) {
            report('fetching', chunk.id, rec.uuid, recIdx, neededRecords.length);
            const fetched = await this.source.fetchChunk(rec.recordPath);
            const r = Array.isArray(fetched) ? assertSeedRows(fetched) : [assertSeedRow(fetched)];
            fetchedRows.push(...r);
            recIdx++;
          }
          rows = fetchedRows;
        } else {
          report('fetching', chunk.id);
          const fetched = await this.source.fetchChunk(chunk.path);
          rows = assertSeedRows(fetched);
          if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
        }
        const noteIds = await Promise.all(rows.map((r) => seedNoteId(r.path)));
        const next: SeedMetaRecord = { ...meta, chunks: { ...meta.chunks, [chunk.id]: { sha256: chunk.sha256, noteIds } }, importedAt: this.now() };
        report('applying', chunk.id);
        const committed = await this.storage.applyChunk({ chunkId: chunk.id, rows, manifest, expectedMeta: expected, meta: next });
        result.totalNotes += committed.totalNotes; result.totalEfforts += committed.totalEfforts; result.totalEquipment += committed.totalEquipment; result.totalBlocks += committed.totalBlocks; result.skippedUserOwned += committed.skippedUserOwned; result.deleted += committed.deleted; result.addedNotes += committed.addedNotes; result.updatedNotes += committed.updatedNotes;
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
