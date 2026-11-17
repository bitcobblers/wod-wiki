import { parseEffortFile, parseEquipmentFile } from '@bitcobblers/wod-wiki-lang';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { seedMetaKey, seedPrecedenceRank, type SeedMetaRecord } from '../seed/contract';

export const FEED_SUBSCRIPTIONS_META_KEY = 'feed:subscriptions';

export interface FeedSubscriptionEntry {
  subscribed: boolean;
  notebookIds?: string[] | null;
  hidden?: boolean;
  url?: string;
  name?: string;
  updatedAt: number;
}

export interface FeedSubscriptionsMetaRecord {
  key: typeof FEED_SUBSCRIPTIONS_META_KEY;
  entries: Record<string, FeedSubscriptionEntry>;
}

/**
 * Remove one seed/feed source's imported notes, tags, index rows, bundled
 * definitions (falling back to the next highest-precedence checkpoint),
 * property overrides, and checkpoint record. User-authored notes are never
 * touched.
 */
export async function removeSeedSourceContent(
  storage: IStorage,
  meta: SeedMetaRecord,
): Promise<number> {
  return storage.transaction(
    [
      'notes',
      'attachments',
      'tags',
      'note_tags',
      'block_index',
      'block_efforts',
      'block_equipment',
      'page_notes',
      'efforts',
      'equipment',
      'property_overrides',
      'meta',
    ],
    'readwrite',
    async (tx) => {
      const targetIds = new Set<string>();
      const legacyChunks: string[] = [];
      for (const [chunkId, chunk] of Object.entries(meta.chunks)) {
        if (chunk.noteIds?.length) {
          for (const id of chunk.noteIds) targetIds.add(id);
        } else {
          legacyChunks.push(chunkId);
        }
      }
      if (legacyChunks.length) {
        for (const note of await tx.readwrite('notes').getAll()) {
          if (note.seedOrigin === 'seed' && note.seedChunkId && legacyChunks.includes(note.seedChunkId)) {
            targetIds.add(note.id);
          }
        }
      }

      const metaStore = tx.readwrite('meta');
      const otherCheckpoints: Array<{
        key: string;
        sourceId: string;
        rank: number;
        meta: SeedMetaRecord;
        noteIds: Set<string>;
      }> = [];
      for (const row of await metaStore.getAll()) {
        const other = row as unknown as SeedMetaRecord | undefined;
        if (!other || typeof other.key !== 'string' || !other.key.startsWith('seed:') || other.key === meta.key) {
          continue;
        }
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
      const noteTags = tx.readwrite('note_tags');
      let deleted = 0;
      const removedPaths = new Set<string>();
      const touchedTagIds = new Set<string>();

      for (const id of targetIds) {
        if (isClaimedByOther(id)) continue;
        const note = await notes.get(id);
        if (!note || note.seedOrigin !== 'seed') continue;
        if (note.seedChunkId && !meta.chunks[note.seedChunkId]) continue;
        if (note.sourcePath) removedPaths.add(note.sourcePath);
        await notes.delete(id);

        const attachments = tx.readwrite('attachments');
        for (const attachment of await attachments.getAllFromIndex('by-note', id)) {
          await attachments.delete(attachment.id);
        }
        for (const link of await noteTags.getAllFromIndex('by-note', id)) {
          touchedTagIds.add(link.tagId);
          await noteTags.delete(link.id);
        }
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

      if (touchedTagIds.size > 0) {
        const tagsStore = tx.readwrite('tags');
        for (const tagId of touchedTagIds) {
          const remainingLinks = await noteTags.countFromIndex('by-tag', tagId);
          if (remainingLinks > 0) continue;
          const tag = await tagsStore.get(tagId);
          if (!tag) continue;
          if (tag.contributions && tag.contributions.length > 0) continue;
          const refNote = await notes.get(`t/${tag.type ?? 'tag'}/${tag.label}`);
          if (refNote) continue;
          await tagsStore.delete(tagId);
        }
      }

      const defFamilies = [
        { storeName: 'efforts' as const, familyPathPrefix: 'markdown/efforts/', parse: parseEffortFile },
        { storeName: 'equipment' as const, familyPathPrefix: 'markdown/equipment/', parse: parseEquipmentFile },
      ];
      for (const { storeName, familyPathPrefix, parse } of defFamilies) {
        const store = tx.readwrite(storeName);
        for (const row of await store.getAll()) {
          if (row.registrySource !== 'bundled') continue;
          const owned =
            row.sourceId === removedSourceId ||
            (row.ownerNoteId !== undefined && targetIds.has(row.ownerNoteId) && (!row.sourceId || row.sourceId === storeName)) ||
            (row.sourcePath !== undefined && row.sourcePath.startsWith(familyPathPrefix) && removedPaths.has(row.sourcePath));
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
                  feedSourceId: cp.sourceId,
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

      try {
        const overrideStore = tx.readwrite('property_overrides');
        for (const ov of await overrideStore.getAll()) {
          if (ov.seedOrigin === 'seed' && ov.feedSourceId === removedSourceId) {
            await overrideStore.delete(ov.id);
          }
        }
      } catch {
        // Optional store
      }

      await metaStore.delete(meta.key);
      return deleted;
    },
  );
}

async function readFeedSubscriptionsMap(storage: IStorage): Promise<Record<string, FeedSubscriptionEntry>> {
  const row = (await storage.readonly('meta').get(FEED_SUBSCRIPTIONS_META_KEY)) as
    | FeedSubscriptionsMetaRecord
    | undefined;
  return { ...(row?.entries ?? {}) };
}

async function writeFeedSubscriptionEntry(
  storage: IStorage,
  sourceId: string,
  entry: FeedSubscriptionEntry,
): Promise<void> {
  await storage.transaction(['meta'], 'readwrite', async (tx) => {
    const metaStore = tx.readwrite('meta');
    const existing = (await metaStore.get(FEED_SUBSCRIPTIONS_META_KEY)) as
      | FeedSubscriptionsMetaRecord
      | undefined;
    const entries = { ...(existing?.entries ?? {}), [sourceId]: entry };
    await metaStore.put({ key: FEED_SUBSCRIPTIONS_META_KEY, entries } as unknown as Record<string, unknown>);
  });
}

export async function listFeedSubscriptionsHeadless(
  storage: IStorage,
): Promise<Record<string, FeedSubscriptionEntry>> {
  return readFeedSubscriptionsMap(storage);
}

export async function subscribeFeedSourceHeadless(
  storage: IStorage,
  sourceId: string,
  options?: { notebookIds?: string[]; url?: string; name?: string },
): Promise<{ sourceId: string; subscribed: true; notebookIds: string[] | null }> {
  const notebookIds = options?.notebookIds && options.notebookIds.length > 0 ? options.notebookIds : null;
  await writeFeedSubscriptionEntry(storage, sourceId, {
    subscribed: true,
    notebookIds,
    hidden: false,
    ...(options?.url ? { url: options.url } : {}),
    ...(options?.name ? { name: options.name } : {}),
    updatedAt: Date.now(),
  });
  return { sourceId, subscribed: true, notebookIds };
}

export async function unsubscribeFeedSourceHeadless(
  storage: IStorage,
  sourceId: string,
): Promise<{ sourceId: string; unsubscribed: true; deletedNotes: number }> {
  if (sourceId === 'core') {
    throw new Error('Core feed cannot be unsubscribed.');
  }
  const meta = (await storage.readonly('meta').get(seedMetaKey(sourceId))) as SeedMetaRecord | undefined;
  const deletedNotes = meta ? await removeSeedSourceContent(storage, meta) : 0;
  await writeFeedSubscriptionEntry(storage, sourceId, {
    subscribed: false,
    hidden: false,
    updatedAt: Date.now(),
  });
  return { sourceId, unsubscribed: true, deletedNotes };
}

export async function deleteFeedSourceHeadless(
  storage: IStorage,
  sourceId: string,
): Promise<{ sourceId: string; deleted: true; deletedNotes: number }> {
  if (sourceId === 'core') {
    throw new Error('Core feed cannot be deleted.');
  }
  const meta = (await storage.readonly('meta').get(seedMetaKey(sourceId))) as SeedMetaRecord | undefined;
  const deletedNotes = meta ? await removeSeedSourceContent(storage, meta) : 0;
  await writeFeedSubscriptionEntry(storage, sourceId, {
    subscribed: false,
    hidden: true,
    updatedAt: Date.now(),
  });
  return { sourceId, deleted: true, deletedNotes };
}
