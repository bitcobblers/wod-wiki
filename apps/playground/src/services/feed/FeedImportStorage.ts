import {
  applySeedChunk,
  applySeedChunks,
  backfillFeedProvenance,
  migrateNotebookVocabulary,
  reconcileRemovedFeedRecords,
  removeFeedNotebookContent,
  removeFeedSourceContentById,
  removeSeedSourceContent,
  type RemoveSeedSourceResult,
  type SeedChunkResult,
  type SeedChunkWrite,
} from '@bitcobblers/wod-wiki-engine';
import type { SeedMetaRecord } from '@/types/seed';
import type { IStorage } from '@/services/storage/IStorage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
export type { SeedChunkWrite, SeedChunkResult, RemoveSeedSourceResult } from '@bitcobblers/wod-wiki-engine';

export interface FeedImportStorage {
  readonly storageInstance?: IStorage;
  getSeedMeta(key: string): Promise<SeedMetaRecord | undefined>;
  putSeedMeta(meta: SeedMetaRecord, expected?: SeedMetaRecord | null): Promise<void>;
  applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult>;
  applyChunks?(writes: SeedChunkWrite[]): Promise<SeedChunkResult>;
  /**
   * Stamp feed provenance on notes imported before the feed stamp existed —
   * a deterministic, idempotent repair driven by the existing checkpoints.
   * Returns the number of notes stamped.
   */
  backfillFeedProvenance(): Promise<number>;
  /**
   * Migrate the retired collection/feed wire identities (chunk ids,
   * sourceIds, corpus paths, the dropped `catalog` field, note type 'feed')
   * to the notebook vocabulary. Deterministic and idempotent; runs before
   * the first notebook-vocabulary sync. Returns the number of rows rewritten.
   */
  migrateNotebookVocabulary(): Promise<number>;
  /**
   * Delete one feed's non-pinned imported rows and its checkpoint row in ONE
   * transaction. Notes with `retention === 'session-pinned'` or attached
   * `sessions` rows are preserved and stamped `upstreamStatus: 'unsubscribed'`.
   */
  removeSourceContent(meta: SeedMetaRecord): Promise<RemoveSeedSourceResult>;
  removeSourceContentById?(sourceId: string): Promise<RemoveSeedSourceResult>;
  removeNotebookContent?(feedId: string, chunkId: string): Promise<RemoveSeedSourceResult>;
  reconcileRemovedRecords?(
    feedId: string,
    notebookId: string,
    liveUuids: ReadonlySet<string>,
  ): Promise<RemoveSeedSourceResult>;
  getNoteCommits?(noteIds: string[]): Promise<Map<string, string | undefined>>;
  getMeta?<T = unknown>(key: string): Promise<T | undefined>;
  putMeta?<T = unknown>(row: T): Promise<void>;
  deleteMeta?(key: string): Promise<void>;
  getAllMeta?(): Promise<unknown[]>;
}
export class IndexedDBFeedImportStorage implements FeedImportStorage {
  // The instance is required, never defaulted: '@/services/storage' touches
  // localStorage at module load, so importing it here would make this module
  // unusable inside the feed-sync Web Worker (feedSync.worker.ts injects its
  // own IndexedDBStorage). Main-thread callers use mainThreadFeedImportStorage().
  constructor(readonly storageInstance: IStorage) {}
  async getSeedMeta(key: string): Promise<SeedMetaRecord | undefined> {
    return await this.storageInstance.readonly('meta').get(key) as SeedMetaRecord | undefined;
  }
  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    return await this.storageInstance.readonly('meta').get(key) as T | undefined;
  }
  async putMeta<T = unknown>(row: T): Promise<void> {
    await this.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put(row);
    });
  }
  async deleteMeta(key: string): Promise<void> {
    await this.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').delete(key);
    });
  }
  async getAllMeta(): Promise<unknown[]> {
    return await this.storageInstance.readonly('meta').getAll();
  }
  async getNoteCommits(noteIds: string[]): Promise<Map<string, string | undefined>> {
    const notes = await this.storageInstance.readonly('notes').getMany(noteIds);
    const map = new Map<string, string | undefined>();
    for (let i = 0; i < noteIds.length; i++) {
      const note = notes[i] as { seedCommit?: string } | undefined;
      map.set(noteIds[i], note?.seedCommit);
    }
    return map;
  }
  async putSeedMeta(meta: SeedMetaRecord, expected?: SeedMetaRecord | null): Promise<void> {
    await this.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      const store = tx.readwrite('meta');
      const current = await store.get(meta.key);
      if (expected !== undefined && JSON.stringify(current ?? null) !== JSON.stringify(expected)) throw new Error('Seed checkpoint changed during claim');
      await store.put(meta);
    });
  }
  applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult> {
    return applySeedChunk(this.storageInstance, write);
  }
  applyChunks(writes: SeedChunkWrite[]): Promise<SeedChunkResult> {
    return applySeedChunks(this.storageInstance, writes);
  }
  backfillFeedProvenance(): Promise<number> {
    return backfillFeedProvenance(this.storageInstance);
  }
  migrateNotebookVocabulary(): Promise<number> {
    return migrateNotebookVocabulary(this.storageInstance);
  }
  async removeSourceContent(meta: SeedMetaRecord): Promise<RemoveSeedSourceResult> {
    return removeSeedSourceContent(this.storageInstance, meta);
  }
  async removeSourceContentById(sourceId: string): Promise<RemoveSeedSourceResult> {
    return removeFeedSourceContentById(this.storageInstance, sourceId);
  }
  async removeNotebookContent(feedId: string, chunkId: string): Promise<RemoveSeedSourceResult> {
    return removeFeedNotebookContent(this.storageInstance, feedId, chunkId);
  }
  async reconcileRemovedRecords(
    feedId: string,
    notebookId: string,
    liveUuids: ReadonlySet<string>,
  ): Promise<RemoveSeedSourceResult> {
    return reconcileRemovedFeedRecords(this.storageInstance, feedId, notebookId, liveUuids);
  }
}
export class InMemoryFeedStorage extends IndexedDBFeedImportStorage {
  applyCount = 0;
  constructor() { super(new InMemoryStorage()); }
  async applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult> {
    const result = await super.applyChunk(write);
    this.applyCount++;
    return result;
  }
  async applyChunks(writes: SeedChunkWrite[]): Promise<SeedChunkResult> {
    if (this.applyChunk !== InMemoryFeedStorage.prototype.applyChunk) {
      const total: SeedChunkResult = { totalNotes: 0, totalEfforts: 0, totalEquipment: 0, totalBlocks: 0, skippedUserOwned: 0, deleted: 0, preservedPinned: 0, addedNotes: 0, updatedNotes: 0 };
      for (const w of writes) {
        const part = await this.applyChunk(w);
        total.totalNotes += part.totalNotes;
        total.totalEfforts += part.totalEfforts;
        total.totalEquipment += part.totalEquipment;
        total.totalBlocks += part.totalBlocks;
        total.skippedUserOwned += part.skippedUserOwned;
        total.deleted += part.deleted;
        total.preservedPinned = (total.preservedPinned ?? 0) + (part.preservedPinned ?? 0);
        total.addedNotes += part.addedNotes;
        total.updatedNotes += part.updatedNotes;
      }
      return total;
    }
    const result = await super.applyChunks(writes);
    this.applyCount++;
    return result;
  }
}
