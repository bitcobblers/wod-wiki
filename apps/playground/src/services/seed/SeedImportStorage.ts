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
  /**
   * Delete one seed source's imported rows and its checkpoint row in ONE
   * transaction. Ownership is exact: only note ids recorded in the given
   * checkpoint's chunk memberships (legacy checkpoints: rows stamped with
   * one of its chunk ids) that still carry `seedOrigin: 'seed'`. User notes
   * are never touched; failures throw — a swallowed deletion would leave a
   * stale checkpoint that re-imports removed content.
   */
  removeSourceContent(meta: SeedMetaRecord): Promise<number>;
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
  async removeSourceContent(meta: SeedMetaRecord): Promise<number> {
    return await this.storageInstance.transaction(
      ['notes', 'attachments', 'note_tags', 'block_index', 'block_efforts', 'block_equipment', 'page_notes', 'efforts', 'equipment', 'meta'],
      'readwrite',
      async (tx) => {
        const targetIds = new Set<string>();
        const legacyChunks: string[] = [];
        for (const [chunkId, chunk] of Object.entries(meta.chunks)) {
          if (chunk.noteIds?.length) for (const id of chunk.noteIds) targetIds.add(id);
          else legacyChunks.push(chunkId);
        }
        if (legacyChunks.length) {
          // Pre-`noteIds` checkpoints recorded no membership: rows are
          // matched by their exact chunk stamp, never by catalog or slug.
          for (const note of await tx.readwrite('notes').getAll()) {
            if (note.seedOrigin === 'seed' && note.seedChunkId && legacyChunks.includes(note.seedChunkId)) {
              targetIds.add(note.id);
            }
          }
        }
        const notes = tx.readwrite('notes');
        let deleted = 0;
        const removedPaths = new Set<string>();
        for (const id of targetIds) {
          const note = await notes.get(id);
          if (!note || note.seedOrigin !== 'seed') continue;
          if (note.seedChunkId && !meta.chunks[note.seedChunkId]) continue;
          if (note.sourcePath) removedPaths.add(note.sourcePath);
          await notes.delete(id);
          const attachments = tx.readwrite('attachments');
          for (const attachment of await attachments.getAllFromIndex('by-note', id)) await attachments.delete(attachment.id);
          const noteTags = tx.readwrite('note_tags');
          for (const link of await noteTags.getAllFromIndex('by-note', id)) await noteTags.delete(link.id);
          const blockIndex = tx.readwrite('block_index');
          for (const row of await blockIndex.getAllFromIndex('by-note', id)) await blockIndex.delete(row.id);
          const blockEfforts = tx.readwrite('block_efforts');
          for (const row of await blockEfforts.getAllFromIndex('by-note', id)) await blockEfforts.delete(row.id);
          const blockEquipment = tx.readwrite('block_equipment');
          for (const row of await blockEquipment.getAllFromIndex('by-note', id)) await blockEquipment.delete(row.id);
          const pageNotes = tx.readwrite('page_notes');
          for (const link of await pageNotes.getAllFromIndex('by-note', id)) await pageNotes.delete(link.id);
          deleted++;
        }
        // Bundled definition projections owned by this source die with it —
        // matched by exact owner note id, with the corpus path as the
        // legacy fallback. Custom (`user`) copies are never touched.
        for (const [storeName, familyPathPrefix] of [['efforts', 'markdown/efforts/'], ['equipment', 'markdown/equipment/']] as const) {
          const store = tx.readwrite(storeName);
          for (const row of await store.getAll()) {
            if (row.registrySource !== 'bundled') continue;
            const owned = (row.ownerNoteId !== undefined && targetIds.has(row.ownerNoteId))
              || (row.sourcePath !== undefined && row.sourcePath.startsWith(familyPathPrefix) && removedPaths.has(row.sourcePath));
            if (owned) await store.delete(row.slug);
          }
        }
        await tx.readwrite('meta').delete(meta.key);
        return deleted;
      },
    );
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
