import { assertNotebookIndex, assertSeedManifest, assertSeedRows, assertSeedRow, seedNoteId, type SeedChunkResult, type SeedRow, type SeedManifest } from '@bitcobblers/wod-wiki-engine';
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
    for (let i = 0; i < plan.length;) {
      // ponytail: four fetches bound cold-import memory; tune from actual import traces.
      const batch = plan.slice(i, i + (plan[i]?.id === CANVAS_CHUNK_ID ? 1 : 4));
      for (const chunk of batch) {
        let rows: SeedRow[];
        const notebook = manifest.notebooks?.find((n) => n.notebookId === chunk.id);
        let records = chunk.records;
        const isIncremental = Boolean(meta.chunks[chunk.id] && opts.granularRecords && (notebook?.indexPath || chunk.records));
        const useGranular = isIncremental || Boolean(opts.granularRecords && chunk.records && chunk.records.length > 0);
        if (useGranular) {
          if (isIncremental && notebook?.indexPath) {
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
              // Fall back to bulk chunk fetch when >50% changed
              report('fetching', chunk.id);
              const fetched = await this.source.fetchChunk(chunk.path);
              rows = assertSeedRows(fetched);
              if (rows.length !== chunk.count) throw new Error('Seed chunk count mismatch');
            } else {
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
        const next: SeedMetaRecord = {
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
        };
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
