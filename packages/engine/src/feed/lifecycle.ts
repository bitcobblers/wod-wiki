import type { Note } from '@bitcobblers/wod-wiki-core';
import { parseEffortFile, parseEquipmentFile } from '@bitcobblers/wod-wiki-lang';
import type { IStorage, IStorageTransaction } from '@bitcobblers/wod-wiki-storage';
import {
  FEED_INDEX_META_PREFIX,
  emptySeedMeta,
  seedMetaKey,
  seedPrecedenceRank,
  type FeedOfflinePolicy,
  type SeedMetaRecord,
} from '../seed/contract';

export const FEED_SUBSCRIPTIONS_META_KEY = 'feed:subscriptions';
export const FEED_REGISTRY_META_KEY = 'feed:registry';

export interface FeedSubscriptionEntry {
  subscribed: boolean;
  notebookIds?: string[] | null;
  offlinePolicy?: FeedOfflinePolicy;
  autoSync?: boolean;
  checkedAt?: number | null;
  hidden?: boolean;
  url?: string;
  name?: string;
  updatedAt: number;
}

export interface FeedSubscriptionsMetaRecord {
  key: typeof FEED_SUBSCRIPTIONS_META_KEY;
  entries: Record<string, FeedSubscriptionEntry>;
  migratedFromLocalStorage?: boolean;
}

export interface RegisteredCustomFeedEntry {
  id: string;
  label: string;
  url: string;
  repositoryUrl?: string;
  addedAt?: number;
}

export interface FeedRegistryMetaRecord {
  key: typeof FEED_REGISTRY_META_KEY;
  customFeeds: RegisteredCustomFeedEntry[];
  hiddenFeedIds: string[];
  updatedAt: number;
  migratedFromLocalStorage?: boolean;
}

export interface RemoveSeedSourceResult {
  deleted: number;
  preservedPinned: number;
}

type RetentionNote = Note & {
  retention?: 'indexed' | 'cached' | 'session-pinned';
  upstreamStatus?: 'live' | 'unsubscribed' | 'removed';
};

async function noteHasSessions(tx: IStorageTransaction, noteId: string): Promise<boolean> {
  const sessionStore = tx.readonly('sessions');
  try {
    if (typeof sessionStore.countFromIndex === 'function') {
      return (await sessionStore.countFromIndex('by-note', noteId)) > 0;
    }
    const rows = await sessionStore.getAllFromIndex('by-note', noteId);
    return rows.length > 0;
  } catch {
    const all = await sessionStore.getAll();
    return all.some((s) => s.noteId === noteId);
  }
}

/**
 * Remove one seed/feed source's imported notes, tags, index rows, bundled
 * definitions (falling back to the next highest-precedence checkpoint),
 * property overrides, and checkpoint record. User-authored notes and
 * session-pinned feed notes (with `retention === 'session-pinned'` or
 * attached `sessions` rows) are never deleted.
 */
export async function removeSeedSourceContent(
  storage: IStorage,
  meta: SeedMetaRecord,
): Promise<RemoveSeedSourceResult> {
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
      'sessions',
      'meta',
    ],
    'readwrite',
    async (tx) => {
      const removedSourceId = meta.key.startsWith('seed:') ? meta.key.slice(5) : meta.key;
      const chunkKeys = Object.keys(meta.chunks);
      const isWholeFeedSweep = chunkKeys.length === 0 || Object.values(meta.chunks).length > 0;

      const targetIds = new Set<string>();
      const legacyChunks: string[] = [];
      for (const [chunkId, chunk] of Object.entries(meta.chunks)) {
        if (chunk.noteIds?.length) {
          for (const id of chunk.noteIds) targetIds.add(id);
        } else {
          legacyChunks.push(chunkId);
        }
      }
      const allNotes = (legacyChunks.length || isWholeFeedSweep)
        ? await tx.readwrite('notes').getAll()
        : [];
      if (legacyChunks.length) {
        for (const note of allNotes) {
          if (note.seedOrigin === 'seed' && note.seedChunkId && legacyChunks.includes(note.seedChunkId)) {
            targetIds.add(note.id);
          }
        }
      }
      if (isWholeFeedSweep) {
        for (const note of allNotes) {
          const rNote = note as RetentionNote;
          if (
            note.seedOrigin === 'seed' &&
            note.feedSourceId === removedSourceId &&
            (chunkKeys.length === 0 || rNote.retention === 'cached' || rNote.retention === 'session-pinned')
          ) {
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
      const indexKeysToDelete: string[] = [];
      const indexPrefix = `${FEED_INDEX_META_PREFIX}${removedSourceId}:`;
      for (const row of await metaStore.getAll()) {
        const key = (row as { key?: unknown } | undefined)?.key;
        if (typeof key === 'string' && key.startsWith(indexPrefix)) {
          indexKeysToDelete.push(key);
        }
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

      const notes = tx.readwrite('notes');
      let deleted = 0;
      let preservedPinned = 0;
      const removedPaths = new Set<string>();
      const touchedTagIds = new Set<string>();

      for (const id of targetIds) {
        if (isClaimedByOther(id)) continue;
        const note = (await notes.get(id)) as RetentionNote | undefined;
        if (!note || note.seedOrigin !== 'seed') continue;
        const ownedByFeedStamp =
          note.feedSourceId === removedSourceId &&
          (chunkKeys.length === 0 || note.retention === 'cached' || note.retention === 'session-pinned');
        if (!ownedByFeedStamp && note.seedChunkId && !meta.chunks[note.seedChunkId]) continue;

        const outcome = await deleteOrPreserveFeedNote(
          tx,
          note,
          'unsubscribed',
          touchedTagIds,
          removedPaths,
        );
        if (outcome === 'pinned') preservedPinned++;
        else deleted++;
      }

      await pruneOrphanTags(tx, touchedTagIds);

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

      for (const idxKey of indexKeysToDelete) {
        await metaStore.delete(idxKey);
      }
      await metaStore.delete(meta.key);
      return { deleted, preservedPinned };
    },
  );
}

async function pruneOrphanTags(
  tx: IStorageTransaction,
  touchedTagIds: ReadonlySet<string>,
): Promise<void> {
  if (touchedTagIds.size === 0) return;
  const notes = tx.readwrite('notes');
  const noteTags = tx.readwrite('note_tags');
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

async function deleteOrPreserveFeedNote(
  tx: IStorageTransaction,
  note: RetentionNote,
  upstreamStatus: 'unsubscribed' | 'removed',
  touchedTagIds: Set<string>,
  removedPaths?: Set<string>,
): Promise<'deleted' | 'pinned'> {
  const notes = tx.readwrite('notes');
  const isPinned = note.retention === 'session-pinned' || (await noteHasSessions(tx, note.id));
  if (isPinned) {
    await notes.put({
      ...note,
      retention: 'session-pinned',
      upstreamStatus,
    } as RetentionNote);
    return 'pinned';
  }

  if (note.sourcePath && removedPaths) removedPaths.add(note.sourcePath);
  await notes.delete(note.id);

  const attachments = tx.readwrite('attachments');
  for (const attachment of await attachments.getAllFromIndex('by-note', note.id)) {
    await attachments.delete(attachment.id);
  }
  const noteTags = tx.readwrite('note_tags');
  for (const link of await noteTags.getAllFromIndex('by-note', note.id)) {
    touchedTagIds.add(link.tagId);
    await noteTags.delete(link.id);
  }
  const blockIndex = tx.readwrite('block_index');
  for (const row of await blockIndex.getAllFromIndex('by-note', note.id)) await blockIndex.delete(row.id);
  const blockEfforts = tx.readwrite('block_efforts');
  for (const row of await blockEfforts.getAllFromIndex('by-note', note.id)) await blockEfforts.delete(row.id);
  const blockEquipment = tx.readwrite('block_equipment');
  for (const row of await blockEquipment.getAllFromIndex('by-note', note.id)) await blockEquipment.delete(row.id);
  const pageNotes = tx.readwrite('page_notes');
  for (const link of await pageNotes.getAllFromIndex('by-note', note.id)) await pageNotes.delete(link.id);
  return 'deleted';
}

export async function removeFeedSourceContentById(
  storage: IStorage,
  sourceId: string,
): Promise<RemoveSeedSourceResult> {
  const meta = (await storage.readonly('meta').get(seedMetaKey(sourceId))) as SeedMetaRecord | undefined;
  return removeSeedSourceContent(storage, meta ?? emptySeedMeta(seedMetaKey(sourceId)));
}

/**
 * Remove one notebook's cached notes and cached index from `storage` for a feed,
 * preserving any `session-pinned` or `sessions`-attached notes and stamping them
 * `upstreamStatus: 'unsubscribed'`.
 */
export async function removeFeedNotebookContent(
  storage: IStorage,
  feedId: string,
  chunkId: string,
): Promise<RemoveSeedSourceResult> {
  return storage.transaction(
    ['notes', 'attachments', 'tags', 'note_tags', 'block_index', 'block_efforts', 'block_equipment', 'page_notes', 'sessions', 'meta'],
    'readwrite',
    async (tx) => {
      const notes = tx.readwrite('notes');
      const allNotes = await notes.getAll();
      let deleted = 0;
      let preservedPinned = 0;
      const touchedTagIds = new Set<string>();

      for (const rawNote of allNotes) {
        const note = rawNote as RetentionNote;
        if (note.seedOrigin !== 'seed') continue;
        if (note.feedSourceId !== feedId || note.seedChunkId !== chunkId) continue;
        const outcome = await deleteOrPreserveFeedNote(tx, note, 'unsubscribed', touchedTagIds);
        if (outcome === 'pinned') preservedPinned++;
        else deleted++;
      }

      await pruneOrphanTags(tx, touchedTagIds);
      await tx.readwrite('meta').delete(`${FEED_INDEX_META_PREFIX}${feedId}:${chunkId}`);
      return { deleted, preservedPinned };
    },
  );
}

/**
 * Reconcile locally cached notes for an index-only feed notebook when the
 * upstream index changes: removes disappeared unpinned cached notes and stamps
 * any `session-pinned` / `sessions`-attached copies with `upstreamStatus: 'removed'`.
 */
export async function reconcileRemovedFeedRecords(
  storage: IStorage,
  feedId: string,
  notebookId: string,
  liveUuids: ReadonlySet<string>,
): Promise<RemoveSeedSourceResult> {
  return storage.transaction(
    ['notes', 'attachments', 'tags', 'note_tags', 'block_index', 'block_efforts', 'block_equipment', 'page_notes', 'sessions'],
    'readwrite',
    async (tx) => {
      const notes = tx.readwrite('notes');
      const allNotes = await notes.getAll();
      let deleted = 0;
      let preservedPinned = 0;
      const touchedTagIds = new Set<string>();

      for (const rawNote of allNotes) {
        const note = rawNote as RetentionNote;
        if (note.seedOrigin !== 'seed') continue;
        if (note.feedSourceId !== feedId || note.seedChunkId !== notebookId) continue;
        if (liveUuids.has(note.id)) continue;
        const outcome = await deleteOrPreserveFeedNote(tx, note, 'removed', touchedTagIds);
        if (outcome === 'pinned') preservedPinned++;
        else deleted++;
      }

      await pruneOrphanTags(tx, touchedTagIds);
      return { deleted, preservedPinned };
    },
  );
}

export async function readFeedRegistryHeadless(storage: IStorage): Promise<FeedRegistryMetaRecord> {
  const row = (await storage.readonly('meta').get(FEED_REGISTRY_META_KEY)) as
    | FeedRegistryMetaRecord
    | undefined;
  return {
    key: FEED_REGISTRY_META_KEY,
    customFeeds: Array.isArray(row?.customFeeds) ? [...row.customFeeds] : [],
    hiddenFeedIds: Array.isArray(row?.hiddenFeedIds) ? [...row.hiddenFeedIds] : [],
    updatedAt: typeof row?.updatedAt === 'number' ? row.updatedAt : 0,
    ...(row?.migratedFromLocalStorage ? { migratedFromLocalStorage: true } : {}),
  };
}

export async function writeFeedRegistryHeadless(
  storage: IStorage,
  next: Omit<FeedRegistryMetaRecord, 'key'>,
): Promise<FeedRegistryMetaRecord> {
  const record: FeedRegistryMetaRecord = {
    key: FEED_REGISTRY_META_KEY,
    customFeeds: next.customFeeds,
    hiddenFeedIds: next.hiddenFeedIds,
    updatedAt: next.updatedAt,
    ...(next.migratedFromLocalStorage ? { migratedFromLocalStorage: true } : {}),
  };
  await storage.transaction(['meta'], 'readwrite', async (tx) => {
    await tx.readwrite('meta').put(record as unknown as Record<string, unknown>);
  });
  return record;
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
    await metaStore.put({
      key: FEED_SUBSCRIPTIONS_META_KEY,
      entries,
      ...(existing?.migratedFromLocalStorage ? { migratedFromLocalStorage: true } : {}),
    } as unknown as Record<string, unknown>);
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
  options?: {
    notebookIds?: string[];
    offlinePolicy?: FeedOfflinePolicy;
    autoSync?: boolean;
    url?: string;
    name?: string;
  },
): Promise<{
  sourceId: string;
  subscribed: true;
  notebookIds: string[] | null;
  offlinePolicy: FeedOfflinePolicy;
}> {
  const notebookIds = options?.notebookIds && options.notebookIds.length > 0 ? options.notebookIds : null;
  const existingMap = await readFeedSubscriptionsMap(storage);
  const prev = existingMap[sourceId];
  const offlinePolicy: FeedOfflinePolicy =
    sourceId === 'core'
      ? 'offline-full'
      : options?.offlinePolicy ?? prev?.offlinePolicy ?? 'index-only';
  await writeFeedSubscriptionEntry(storage, sourceId, {
    ...prev,
    subscribed: true,
    notebookIds,
    offlinePolicy,
    ...(options?.autoSync !== undefined ? { autoSync: options.autoSync } : {}),
    hidden: false,
    ...(options?.url ? { url: options.url } : {}),
    ...(options?.name ? { name: options.name } : {}),
    updatedAt: Date.now(),
  });
  return { sourceId, subscribed: true, notebookIds, offlinePolicy };
}

export async function unsubscribeFeedSourceHeadless(
  storage: IStorage,
  sourceId: string,
): Promise<{
  sourceId: string;
  unsubscribed: true;
  deletedNotes: number;
  deleted: number;
  preservedPinned: number;
}> {
  if (sourceId === 'core') {
    throw new Error('Core feed cannot be unsubscribed.');
  }
  const { deleted, preservedPinned } = await removeFeedSourceContentById(storage, sourceId);
  const existingMap = await readFeedSubscriptionsMap(storage);
  const prev = existingMap[sourceId];
  await writeFeedSubscriptionEntry(storage, sourceId, {
    ...prev,
    subscribed: false,
    autoSync: false,
    hidden: false,
    updatedAt: Date.now(),
  });
  return { sourceId, unsubscribed: true, deletedNotes: deleted, deleted, preservedPinned };
}

export async function deleteFeedSourceHeadless(
  storage: IStorage,
  sourceId: string,
): Promise<{
  sourceId: string;
  deleted: true;
  deletedNotes: number;
  preservedPinned: number;
}> {
  if (sourceId === 'core') {
    throw new Error('Core feed cannot be deleted.');
  }
  const { deleted, preservedPinned } = await removeFeedSourceContentById(storage, sourceId);
  const existingMap = await readFeedSubscriptionsMap(storage);
  const prev = existingMap[sourceId];
  await writeFeedSubscriptionEntry(storage, sourceId, {
    ...prev,
    subscribed: false,
    autoSync: false,
    hidden: true,
    updatedAt: Date.now(),
  });
  const registry = await readFeedRegistryHeadless(storage);
  const isCustom = registry.customFeeds.some((f) => f.id === sourceId);
  await writeFeedRegistryHeadless(storage, {
    customFeeds: isCustom ? registry.customFeeds.filter((f) => f.id !== sourceId) : registry.customFeeds,
    hiddenFeedIds: isCustom || registry.hiddenFeedIds.includes(sourceId)
      ? registry.hiddenFeedIds
      : [...registry.hiddenFeedIds, sourceId],
    updatedAt: Date.now(),
    migratedFromLocalStorage: registry.migratedFromLocalStorage,
  });
  await storage.transaction(['meta'], 'readwrite', async (tx) => {
    await tx.readwrite('meta').delete(`catalog:${sourceId}`);
  });
  return { sourceId, deleted: true, deletedNotes: deleted, preservedPinned };
}
