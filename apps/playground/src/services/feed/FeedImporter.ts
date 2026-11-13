import { assertNotebookIndex, assertSeedManifest, assertSeedRows, assertSeedRow, seedNoteId, type SeedChunkResult, type SeedChunkWrite, type SeedRow, type SeedManifest } from '@bitcobblers/wod-wiki-engine';
type SeedManifestChunk = SeedManifest['chunks'][number];
type SeedManifestNotebook = NonNullable<SeedManifest['notebooks']>[number];
import { CANVAS_CHUNK_ID, EFFORTS_CHUNK_ID, EQUIPMENT_CHUNK_ID, SEED_SCHEMA, emptySeedMeta, seedMetaKey, type SeedMetaRecord } from '@/types/seed';
import type { IFeedSource } from './IFeedSource';
import type { FeedImportStorage } from './FeedImportStorage';
export { seedNoteId };
export interface FeedImportResult extends SeedChunkResult {
  status: 'imported' | 'current';
  appliedChunks: number;
}
export type FeedImportProgress = SeedChunkResult & {
  phase: 'fetching' | 'applying' | 'committed' | 'finalizing';
  chunkId: string | null;
  completedChunks: number;
  totalChunks: number;
  recordId?: string | null;
  completedRecords?: number;
  totalRecords?: number;
};
export interface FeedImportOptions {
  forceAll?: boolean;
  onFirstPaintApplied?: () => void;
  onProgress?: (progress: FeedImportProgress) => void;
  notebookIds?: string[] | null;
  granularRecords?: boolean;
  manifest?: SeedManifest;
  stored?: SeedMetaRecord | null;
}
export class FeedImporter {
  constructor(private readonly storage: FeedImportStorage, private readonly source: IFeedSource, private readonly sourceId: string, private readonly now: () => number = Date.now) {}
  async applyAll(opts: FeedImportOptions = {}): Promise<FeedImportResult> {
    const manifest = assertSeedManifest(opts.manifest ?? await this.source.fetchManifest());
    const key = seedMetaKey(this.sourceId);
    const stored = opts.stored !== undefined ? opts.stored : await this.storage.getSeedMeta(key);
    // Schema cutover: a checkpoint from another SEED_SCHEMA cannot own
    // anything — reset it and re-import from scratch. No data is deleted:
    // notes/projections are reclaimed by exact note id on re-import, and
    // user-owned rows are untouched.
    let expected = stored?.schema === SEED_SCHEMA ? stored : undefined;
    let meta = expected ?? emptySeedMeta(key);
    if (manifest.version < meta.seedVersion) throw new Error('Seed manifest is older than the stored checkpoint');
    const targetChunks = manifest.chunks.filter((c) => {
      if (opts.notebookIds !== undefined && opts.notebookIds !== null) {
        if (opts.notebookIds.length === 0) return false;
        if (!opts.notebookIds.includes(c.id) && c.id !== EFFORTS_CHUNK_ID && c.id !== EQUIPMENT_CHUNK_ID) {
          return false;
        }
      }
      return true;
    });
    const hasNotebookSummaries = Boolean(manifest.notebooks && manifest.notebooks.length > 0);
    const plan = targetChunks.filter((c) => {
      const nb = manifest.notebooks?.find((n) => n.notebookId === c.id);
      const chunkStored = meta.chunks[c.id];
      if (opts.forceAll || !chunkStored) return true;
      if (nb) {
        if ((nb.version ?? 0) > (chunkStored.version ?? 0)) return true;
      } else if (!hasNotebookSummaries && (manifest.version !== meta.seedVersion || manifest.builtAt !== meta.builtAt)) {
        return true;
      }
      return chunkStored.sha256 !== c.sha256;
    });
    plan.sort((a, b) => Number(b.id === CANVAS_CHUNK_ID) - Number(a.id === CANVAS_CHUNK_ID));
    const vanished = Object.keys(meta.chunks).filter((id) => !manifest.chunks.some((c) => c.id === id));
    const result: FeedImportResult = { status: 'current', appliedChunks: 0, totalNotes: 0, totalEfforts: 0, totalEquipment: 0, totalBlocks: 0, skippedUserOwned: 0, deleted: 0, addedNotes: 0, updatedNotes: 0 };
    if (!plan.length && !vanished.length && manifest.version === meta.seedVersion && manifest.builtAt === meta.builtAt) return result;
    result.status = 'imported';
    const report = (phase: FeedImportProgress['phase'], chunkId: string | null, recordId?: string | null, completedRecords?: number, totalRecords?: number) =>
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
    const accumulate = (committed: SeedChunkResult) => {
      result.totalNotes += committed.totalNotes;
      result.totalEfforts += committed.totalEfforts;
      result.totalEquipment += committed.totalEquipment;
      result.totalBlocks += committed.totalBlocks;
      result.skippedUserOwned += committed.skippedUserOwned;
      result.deleted += committed.deleted;
      result.addedNotes += committed.addedNotes;
      result.updatedNotes += committed.updatedNotes;
    };
    const buildChunkMeta = (chunk: SeedManifestChunk, notebook: SeedManifestNotebook | undefined, noteIds: string[]): SeedMetaRecord => ({
      ...meta,
      seedVersion: manifest.version,
      builtAt: manifest.builtAt,
      chunks: {
        ...meta.chunks,
        [chunk.id]: {
          sha256: chunk.sha256,
          version: notebook?.version,
          builtAt: notebook?.builtAt ?? manifest.builtAt,
          importedAt: this.now(),
          noteIds,
        },
      },
      importedAt: this.now(),
    });
    let startIdx = 0;
    if (plan[0]?.id === CANVAS_CHUNK_ID) {
      const canvasChunk = plan[0];
      const notebook = manifest.notebooks?.find((n) => n.notebookId === canvasChunk.id);
      const { rows, noteIds } = await this.fetchChunkData(canvasChunk, notebook, meta, opts, report);
      const next = buildChunkMeta(canvasChunk, notebook, noteIds);
      report('applying', canvasChunk.id);
      const committed = await this.storage.applyChunk({ chunkId: canvasChunk.id, rows, manifest, expectedMeta: expected, meta: next });
      accumulate(committed);
      result.appliedChunks++;
      meta = next;
      expected = next;
      report('committed', canvasChunk.id);
      opts.onFirstPaintApplied?.();
      startIdx = 1;
    }
    const fetchedRemaining: Array<{ chunk: SeedManifestChunk; notebook: SeedManifestNotebook | undefined; rows: SeedRow[]; noteIds: string[] }> = [];
    for (let i = startIdx; i < plan.length; i += 4) {
      // Bounded parallel fetches keep cold-import memory bounded while avoiding sequential HTTP stalls.
      const batch = plan.slice(i, i + 4);
      const batchResults = await Promise.all(batch.map(async (chunk) => {
        const notebook = manifest.notebooks?.find((n) => n.notebookId === chunk.id);
        const { rows, noteIds } = await this.fetchChunkData(chunk, notebook, meta, opts, report);
        return { chunk, notebook, rows, noteIds };
      }));
      fetchedRemaining.push(...batchResults);
    }
    const writes: SeedChunkWrite[] = [];
    for (const item of fetchedRemaining) {
      const next = buildChunkMeta(item.chunk, item.notebook, item.noteIds);
      writes.push({ chunkId: item.chunk.id, rows: item.rows, manifest, expectedMeta: expected, meta: next });
      meta = next;
      expected = next;
    }
    for (const chunkId of vanished) {
      const chunks = { ...meta.chunks };
      delete chunks[chunkId];
      const next = { ...meta, chunks, importedAt: this.now() };
      writes.push({ chunkId, rows: [], manifest, expectedMeta: expected, meta: next });
      meta = next;
      expected = next;
    }
    const finalMeta = { ...meta, schema: SEED_SCHEMA, seedVersion: manifest.version, builtAt: manifest.builtAt, importedAt: this.now() };
    writes.push({ chunkId: null, rows: [], manifest, expectedMeta: expected, meta: finalMeta });
    if (writes.length > 0) {
      if (fetchedRemaining.length > 0) report('applying', fetchedRemaining[0].chunk.id);
      if (this.storage.applyChunks) {
        const committed = await this.storage.applyChunks(writes);
        accumulate(committed);
        result.appliedChunks += fetchedRemaining.length;
        for (const item of fetchedRemaining) report('committed', item.chunk.id);
      } else {
        for (const w of writes) {
          const committed = await this.storage.applyChunk(w);
          accumulate(committed);
          if (w.chunkId && fetchedRemaining.some((item) => item.chunk.id === w.chunkId)) {
            result.appliedChunks++;
            report('committed', w.chunkId);
          }
        }
      }
    }
    report('finalizing', null);
    return result;
  }

  private async fetchChunkData(
    chunk: SeedManifestChunk,
    notebook: SeedManifestNotebook | undefined,
    meta: SeedMetaRecord,
    opts: FeedImportOptions,
    report: (phase: FeedImportProgress['phase'], chunkId: string | null, recordId?: string | null, completedRecords?: number, totalRecords?: number) => void,
  ): Promise<{ rows: SeedRow[]; noteIds: string[] }> {
    let rows: SeedRow[];
    let records = chunk.records;
    const isIncremental = Boolean(meta.chunks[chunk.id] && opts.granularRecords && (notebook?.indexPath || chunk.records));
    const useGranular = isIncremental || Boolean(opts.granularRecords && chunk.records && chunk.records.length > 0);
    if (useGranular) {
      if (notebook?.indexPath) {
        const fetchedIndex = assertNotebookIndex(await this.source.fetchChunk(notebook.indexPath));
        records = fetchedIndex.records;
      }
      if (records && records.length > 0) {
        const commits = (!opts.forceAll && this.storage.getNoteCommits)
          ? await this.storage.getNoteCommits(records.map((r) => r.uuid))
          : undefined;
        const neededRecords = commits
          ? records.filter((r) => commits.get(r.uuid) !== r.commit)
          : records;
        if (isIncremental && neededRecords.length > records.length / 2) {
          report('fetching', chunk.id);
          const fetched = await this.source.fetchChunk(chunk.path);
          rows = assertSeedRows(fetched);
          if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
        } else {
          const fetchedRows: SeedRow[] = [];
          const CONCURRENCY = 8;
          for (let j = 0; j < neededRecords.length; j += CONCURRENCY) {
            const slice = neededRecords.slice(j, j + CONCURRENCY);
            report('fetching', chunk.id, slice[0]?.uuid, j, neededRecords.length);
            const results = await Promise.all(slice.map(async (rec) => {
              const fetched = await this.source.fetchChunk(rec.recordPath);
              return Array.isArray(fetched) ? assertSeedRows(fetched) : [assertSeedRow(fetched)];
            }));
            for (const r of results) fetchedRows.push(...r);
          }
          rows = fetchedRows;
        }
      } else {
        report('fetching', chunk.id);
        const fetched = await this.source.fetchChunk(chunk.path);
        rows = assertSeedRows(fetched);
        if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
      }
    } else {
      report('fetching', chunk.id);
      const fetched = await this.source.fetchChunk(chunk.path);
      rows = assertSeedRows(fetched);
      if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
    }
    // Granular membership is the manifest's complete record list, not the
    // fetched subset: unchanged siblings must stay declared so they are
    // not treated as vanished.
    const noteIds = records && records.length > 0
      ? records.map((r) => r.uuid)
      : await Promise.all(rows.map((r) => seedNoteId(r.path)));
    return { rows, noteIds };
  }
}
