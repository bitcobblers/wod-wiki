import { applySeedChunk, type SeedChunkResult, type SeedChunkWrite } from '@bitcobblers/wod-wiki-engine';
import type { SeedMetaRecord } from '@/types/seed';
import type { IStorage } from '@/services/storage/IStorage';
import { storage } from '@/services/storage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
export type { SeedChunkWrite, SeedChunkResult } from '@bitcobblers/wod-wiki-engine';

export interface SeedImportStorage {
  getSeedMeta(key: string): Promise<SeedMetaRecord | undefined>;
  putSeedMeta(meta: SeedMetaRecord, expected?: SeedMetaRecord | null): Promise<void>;
  applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult>;
}
export class IndexedDBSeedImportStorage implements SeedImportStorage {
  constructor(readonly storageInstance: IStorage = storage) {}
  async getSeedMeta(key: string): Promise<SeedMetaRecord | undefined> {
    return await this.storageInstance.readonly('meta').get(key) as SeedMetaRecord | undefined;
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
}
export class InMemorySeedStorage extends IndexedDBSeedImportStorage {
  applyCount = 0;
  constructor() { super(new InMemoryStorage()); }
  async applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult> {
    const result = await super.applyChunk(write);
    this.applyCount++;
    return result;
  }
}
