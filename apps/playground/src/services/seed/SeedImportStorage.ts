import { applySeedChunk, seedPrecedenceRank, type SeedChunkResult, type SeedChunkWrite } from '@bitcobblers/wod-wiki-engine';
import { parseEffortFile, parseEquipmentFile } from '@bitcobblers/wod-wiki-lang';
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
        const metaStore = tx.readwrite('meta');
        const otherCheckpoints: Array<{ key: string; sourceId: string; rank: number; meta: SeedMetaRecord; noteIds: Set<string> }> = [];
        for (const row of await metaStore.getAll()) {
          const other = row as unknown as SeedMetaRecord | undefined;
          if (!other || typeof other.key !== 'string' || !other.key.startsWith('seed:') || other.key === meta.key) continue;
          const noteIds = new Set<string>();
          for (const chunk of Object.values(other.chunks ?? {})) {
            for (const id of chunk.noteIds ?? []) noteIds.add(id);
          }
          otherCheckpoints.push({
            key: other.key,
            sourceId: other.key.slice(5),
            rank: seedPrecedenceRank(other.key, other.tier),
            meta: other,
            noteIds,
          });
        }
        otherCheckpoints.sort((a, b) => b.rank - a.rank);
        const isClaimedByOther = (noteId: string): boolean => otherCheckpoints.some((cp) => cp.noteIds.has(noteId));
        const removedSourceId = meta.key.startsWith('seed:') ? meta.key.slice(5) : meta.key;

        const notes = tx.readwrite('notes');
        let deleted = 0;
        const removedPaths = new Set<string>();
        for (const id of targetIds) {
          if (isClaimedByOther(id)) continue;
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
        // Bundled definition projections owned by this source fall back to the
        // highest remaining seed tier when one declares the same slug, or die
        // with this source otherwise. Custom (`user`) copies are never touched.
        const defFamilies = [
          { storeName: 'efforts' as const, familyPathPrefix: 'markdown/efforts/', parse: parseEffortFile },
          { storeName: 'equipment' as const, familyPathPrefix: 'markdown/equipment/', parse: parseEquipmentFile },
        ];
        for (const { storeName, familyPathPrefix, parse } of defFamilies) {
          const store = tx.readwrite(storeName);
          for (const row of await store.getAll()) {
            if (row.registrySource !== 'bundled') continue;
            const owned = row.sourceId === removedSourceId
              || (row.ownerNoteId !== undefined && targetIds.has(row.ownerNoteId) && (!row.sourceId || row.sourceId === storeName))
              || (row.sourcePath !== undefined && row.sourcePath.startsWith(familyPathPrefix) && removedPaths.has(row.sourcePath));
            if (!owned) continue;
            let restored = false;
            for (const cp of otherCheckpoints) {
              const candidateIds = cp.meta.chunks?.[storeName]?.noteIds ?? [];
              for (const candidateId of candidateIds) {
                const candidateNote = await notes.get(candidateId);
                if (!candidateNote || candidateNote.seedOrigin !== 'seed') continue;
                const parsed = parse(candidateNote.rawContent);
                if (parsed && parsed.slug === row.slug) {
                  await (store as unknown as { put(v: unknown): Promise<unknown> }).put({
                    ...parsed,
                    registrySource: 'bundled' as const,
                    ownerNoteId: candidateNote.id,
                    sourceId: cp.sourceId,
                    sourcePath: candidateNote.sourcePath ?? '',
                  });
                  restored = true;
                  break;
                }
              }
              if (restored) break;
            }
            if (!restored) await store.delete(row.slug);
          }
        }
        await metaStore.delete(meta.key);
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
