import type {
  EventRecord,
  Note,
  Page,
  PageNote,
} from '@bitcobblers/wod-wiki-core';
import {
  bundledEfforts,
  type IEffort,
} from '@bitcobblers/wod-wiki-lang';
import type {
  IStorage,
  KeyDTO,
  RangeDTO,
} from '@bitcobblers/wod-wiki-storage';
import {
  coalescingEventStore,
  type BlockQueryStore,
  type EffortQueryStore,
  type EventStore,
  type FeedCatalogQueryStore,
  type NoteQueryStore,
  type QueryServiceStores,
} from '@bitcobblers/wod-wiki-wql';
import { seedMetaKey } from '../seed/contract';

export type DatasetStore = {
  getDataset(name: string): { events: EventRecord[]; notes: Note[] } | undefined;
};

export interface BuildQueryServiceStoresOptions {
  coalesce?: boolean;
  effortStore?: EffortQueryStore;
  feedCatalogStore?: FeedCatalogQueryStore;
  datasetStore?: DatasetStore;
  isNotebookSubscribed?: (feedId: string, chunkId: string) => Promise<boolean> | boolean;
}

/**
 * Build a canonical `QueryServiceStores` adapter directly over any `IStorage`
 * (`IndexedDBStorage`, `ApiStorage`, `SqlStorage`, or `InMemoryStorage`).
 */
export function buildQueryServiceStoresFromStorage(
  storage: IStorage,
  options: BuildQueryServiceStoresOptions = {},
): QueryServiceStores {
  const asRange = (lower: KeyDTO, upper: KeyDTO): RangeDTO =>
    typeof IDBKeyRange !== 'undefined'
      ? (IDBKeyRange.bound(lower, upper) as unknown as RangeDTO)
      : ({ lower, upper } as RangeDTO);
  const resultRows = (key: string): RangeDTO => asRange([key, ''], [`${key}\uffff`, '\uffff']);

  const rawEventStore: EventStore = {
    getEventsByTimeRange: async (start, end) =>
      storage.readonly('events').getAllFromIndex('by-timestamp', asRange(start, end) as unknown as IDBKeyRange),
    getEventsByMetricDates: async (dates) => {
      const store = storage.readonly('events');
      const byId = new Map<string, EventRecord>();
      for (const date of dates) {
        for (const row of await store.getAllFromIndex('by-metric-date', date)) {
          byId.set(row.id, row);
        }
      }
      return Array.from(byId.values());
    },
    getEventsByResult: async (resultId) =>
      storage.readonly('events').getAllFromIndex('by-result-grain', resultRows(resultId) as unknown as IDBKeyRange),
    getEventsForNote: async (noteId) =>
      (await storage.readonly('events').getAll()).filter((row) => row.noteId === noteId),
    getEventsByContent: async (cid) =>
      storage.readonly('events').getAllFromIndex('by-content-grain', resultRows(cid) as unknown as IDBKeyRange),
    scanAll: () => storage.readonly('events').getAll(),
    appendEvents: async (rows) => {
      if (rows.length > 0) await storage.readwrite('events').putMany(rows);
    },
    finalizeSummaries: async (resultId, rows) => {
      await storage.transaction(['events'], 'readwrite', async (tx) => {
        const allForResult = (await tx.readonly('events').getAll()).filter(
          (r) => r.resultId === resultId && r.grain === 'summary' && r.origin !== 'user',
        );
        for (const r of allForResult) await tx.readwrite('events').delete(r.id);
        if (rows.length > 0) await tx.readwrite('events').putMany(rows);
      });
    },
    deleteEvents: async (ids) => {
      for (const id of ids) await storage.readwrite('events').delete(id);
    },
  };

  const eventStore: EventStore = options.coalesce !== false
    ? (coalescingEventStore(rawEventStore) as EventStore)
    : rawEventStore;

  const noteStore: NoteQueryStore = {
    getAllNotes: () => storage.readonly('notes').getAll(),
    getNotesByIds: async (ids) => {
      const rows = await storage.readonly('notes').getMany([...ids]);
      return rows.filter((row): row is Note => row !== undefined);
    },
    getNoteIdsForTag: async (label) => {
      const ids = new Set<string>();
      for (const tag of await storage.readonly('tags').getAllFromIndex('by-label', label)) {
        for (const link of await storage.readonly('note_tags').getAllFromIndex('by-tag', tag.id)) {
          ids.add(link.noteId);
        }
      }
      return ids;
    },
    getNoteTagLabels: async (noteId) => {
      const links = await storage.readonly('note_tags').getAllFromIndex('by-note', noteId);
      const tags = await storage.readonly('tags').getMany(links.map((l) => l.tagId));
      return tags.flatMap((t) => (t ? [t.label] : []));
    },
    queryDomain: async (request) => {
      if (!storage.queryDomain) return undefined;
      const result = await storage.queryDomain({ ...request, plan: 'notes' });
      return result && result.plan === 'notes' ? result : undefined;
    },
  };

  const blockStore: BlockQueryStore = {
    getAllBlocks: () => storage.readonly('block_index').getAll(),
    queryDomain: async (request) => {
      if (!storage.queryDomain) return undefined;
      const result = await storage.queryDomain({ ...request, plan: 'blocks' });
      return result && result.plan === 'blocks' ? result : undefined;
    },
  };

  const effortStore: EffortQueryStore = options.effortStore ?? {
    getAllEfforts: async () => {
      const stored = await storage.readonly('efforts').getAll();
      const bySlug = new Map<string, IEffort>();
      for (const eff of bundledEfforts) bySlug.set(eff.slug, eff);
      for (const eff of stored) bySlug.set(eff.slug, eff);
      return [...bySlug.values()];
    },
  };

  const feedCatalogStore: FeedCatalogQueryStore = options.feedCatalogStore ?? {
    getAllFeeds: async () => {
      const rows: Array<{
        id: string;
        label: string;
        url: string;
        tier: 'imported';
        subscribed: boolean;
        installed: boolean;
        notebookCount: number;
        itemCount: number;
      }> = [];
      for (const row of await storage.readonly('meta').getAll()) {
        const key = (row as { key?: unknown }).key;
        if (typeof key !== 'string' || !key.startsWith('seed:') || key === seedMetaKey('user')) continue;
        const id = key.slice('seed:'.length);
        rows.push({
          id,
          label: id,
          url: `https://${id}.example/feed/`,
          tier: 'imported',
          subscribed: true,
          installed: true,
          notebookCount: 0,
          itemCount: 0,
        });
      }
      return rows;
    },
    getAllNotebooks: async () => {
      const links = await storage.readonly('notebook_links').getAll().catch(() => []);
      const notes = await storage.readonly('notes').getAll();
      const memberCount = new Map<string, number>();
      for (const link of links) {
        if (link.targetKind === 'note') {
          memberCount.set(link.notebookId, (memberCount.get(link.notebookId) ?? 0) + 1);
        }
      }
      const rows: Array<{
        id: string;
        feedId: string;
        feedLabel: string;
        chunkId: string;
        slug: string;
        label: string;
        count: number;
        subscribed: boolean;
        installed: boolean;
        origin: 'user' | 'feed';
        public?: boolean;
      }> = [];
      for (const [notebookId, count] of memberCount) {
        const slug = notebookId.startsWith('notebook/') ? notebookId.slice('notebook/'.length) : notebookId;
        const landing = notes.find((n) => n.id === notebookId);
        const feedSourceId = landing?.feedSourceId;
        const chunkId = `notebook.${slug}`;
        const feedId = feedSourceId ?? 'local';
        let subscribed = feedSourceId !== undefined;
        if (options.isNotebookSubscribed) {
          const res = options.isNotebookSubscribed(feedId, chunkId);
          subscribed = typeof res === 'boolean' ? res : Boolean(await res);
        }
        rows.push({
          id: notebookId,
          feedId,
          feedLabel: feedSourceId ?? 'Yours (Local)',
          chunkId,
          slug,
          label: landing?.title ?? slug,
          count,
          subscribed,
          installed: true,
          origin: feedSourceId ? 'feed' : 'user',
          ...(landing?.public !== undefined ? { public: landing.public } : {}),
        });
      }
      return rows;
    },
  };

  const stores: QueryServiceStores = {
    eventStore,
    noteStore,
    blockStore,
    effortStore,
    blockEffortsStore: {
      getAllFromIndex: (index, key) => storage.readonly('block_efforts').getAllFromIndex(index, key),
    },
    blockEquipmentStore: {
      getAllFromIndex: (index, key) => storage.readonly('block_equipment').getAllFromIndex(index, key),
    },
    tagsStore: {
      getAllFromIndex: (index, key) => storage.readonly('tags').getAllFromIndex(index, key),
      getAll: () => storage.readonly('tags').getAll(),
    },
    noteTagsStore: {
      getAllFromIndex: (index, key) => storage.readonly('note_tags').getAllFromIndex(index, key),
    },
    pageStore: {
      getNotePages: (noteId) => storage.readonly('page_notes').getAllFromIndex('by-note', noteId),
      getPage: (pageId) => storage.readonly('page').get(pageId),
      getAllPages: () => storage.readonly('page').getAll(),
      getAllLinks: () => storage.readonly('page_notes').getAll(),
    },
    relationStore: {
      getBatches: async (noteIds) => {
        const bundles = new Map<
          string,
          { tags: ReadonlyArray<{ label: string; type?: string }>; links: PageNote[]; pages: Page[] }
        >();
        const uniqueIds = [...new Set(noteIds)];
        if (uniqueIds.length === 0) return bundles;
        // Prefer chunked server-side detail reads when queryDomain is supported
        // (ApiStorage / SqlStorage) to avoid 2N unbatched HTTP GETs (WW-036).
        // Fall back to the direct store transaction if queryDomain returned no
        // note rows (e.g. unit tests with relation rows without parent notes).
        if (storage.queryDomain) {
          const CHUNK_SIZE = 100;
          let usedDomain = true;
          let matchedRows = 0;
          for (let offset = 0; offset < uniqueIds.length; offset += CHUNK_SIZE) {
            const chunk = uniqueIds.slice(offset, offset + CHUNK_SIZE);
            const result = await storage.queryDomain({
              plan: 'detail',
              selection: [{ field: 'id', values: chunk }],
            });
            if (!result || result.plan !== 'detail') {
              usedDomain = false;
              bundles.clear();
              break;
            }
            matchedRows += result.rows.length;
            for (const row of result.rows) {
              bundles.set(row.note.id, {
                tags: row.tags.map((t) => ({ label: t.label, ...(t.type ? { type: t.type } : {}) })),
                links: [...row.links],
                pages: [...row.pages],
              });
            }
          }
          if (usedDomain && matchedRows > 0) {
            for (const id of uniqueIds) {
              if (!bundles.has(id)) {
                bundles.set(id, { tags: [], links: [], pages: [] });
              }
            }
            return bundles;
          }
          bundles.clear();
        }
        return storage.transaction(['page_notes', 'note_tags', 'tags', 'page'], 'readonly', async (tx) => {
          const [pageLinkGroups, tagLinkGroups] = await Promise.all([
            tx.readonly('page_notes').getAllFromIndexMany('by-note', uniqueIds),
            tx.readonly('note_tags').getAllFromIndexMany('by-note', uniqueIds),
          ]);
          const tagIds = new Set<string>();
          const pageIds = new Set<string>();
          for (const group of tagLinkGroups) for (const link of group) tagIds.add(link.tagId);
          for (const group of pageLinkGroups) for (const link of group) pageIds.add(link.pageId);
          const [tagRows, pageRows] = await Promise.all([
            tx.readonly('tags').getMany([...tagIds]),
            tx.readonly('page').getMany([...pageIds]),
          ]);
          const tagById = new Map([...tagIds].map((id, i) => [id, tagRows[i]]));
          const pageById = new Map([...pageIds].map((id, i) => [id, pageRows[i]]));
          for (let i = 0; i < uniqueIds.length; i++) {
            const noteId = uniqueIds[i]!;
            const links = pageLinkGroups[i] ?? [];
            const tagLinks = tagLinkGroups[i] ?? [];
            bundles.set(noteId, {
              tags: tagLinks.flatMap((l) => {
                const t = tagById.get(l.tagId);
                return t ? [{ label: t.label, ...(t.type ? { type: t.type } : {}) }] : [];
              }),
              links,
              pages: links.flatMap((l) => {
                const p = pageById.get(l.pageId);
                return p ? [p] : [];
              }),
            });
          }
          return bundles;
        });
      },
    },
    feedCatalogStore,
  };

  const scheduleStore = {
    getAll: async () => storage.readonly('schedule_items').getAll().catch(() => []),
    getForNote: async (noteId: string) =>
      storage.readonly('schedule_items').getAllFromIndex('by-note', noteId).catch(() => []),
    getByDateRange: async (fromDate: string, toDate: string) => {
      try {
        return (await storage.readonly('schedule_items').getAll()).filter(
          (item) => item.date >= fromDate && item.date <= toDate,
        );
      } catch {
        return [];
      }
    },
  };

  const sessionStore = {
    getAll: async () => {
      const rows = await storage.readonly('sessions').getAll();
      return rows.map((s) => ({
        id: s.id,
        noteId: s.noteId,
        startedAt: s.startTime,
        ...(s.completed ? { completedAt: s.endTime } : {}),
        ...(typeof s.duration === 'number' ? { duration: s.duration } : {}),
        createdAt: s.createdAt,
        ...(s.notebookIds ? { notebookIds: s.notebookIds } : {}),
        ...(s.blockContentId ? { blockContentId: s.blockContentId } : {}),
        ...(s.completed !== undefined ? { completed: s.completed } : {}),
        ...(s.sessionDate ? { sessionDate: s.sessionDate } : {}),
        ...(s.scheduleItemId ? { scheduleItemId: s.scheduleItemId } : {}),
      }));
    },
  };

  Object.assign(stores, { scheduleStore, sessionStore });

  if (options.datasetStore) {
    stores.datasetStore = options.datasetStore;
  }

  if (options.isNotebookSubscribed) {
    stores.isNotebookSubscribed = (feedId, chunkId) => {
      const res = options.isNotebookSubscribed!(feedId, chunkId);
      return typeof res === 'boolean' ? res : true;
    };
  }

  return stores;
}

export interface BuildContextualPageSourceScope {
  resultId?: string;
  blockContentId?: string;
  noteId?: string;
  notebookSlug?: string;
}

/**
 * Materialize contextual `@session`, `@block`, `@notebook`, and `@note` page
 * datasets from `IStorage` for historical inspection pages (`/results/:id`)
 * and workout-bound dashboards.
 */
export async function buildContextualPageSource(
  storage: IStorage,
  scope: BuildContextualPageSourceScope,
): Promise<Map<string, { events: EventRecord[]; notes: Note[] }>> {
  const result = new Map<string, { events: EventRecord[]; notes: Note[] }>();
  const [allNotes, noteRecord] = await Promise.all([
    scope.notebookSlug ? storage.readonly('notes').getAll() : Promise.resolve([] as Note[]),
    scope.noteId ? storage.readonly('notes').get(scope.noteId) : Promise.resolve(undefined),
  ]);

  if (scope.resultId) {
    const events = (await storage.readonly('events').getAll()).filter((e) => e.resultId === scope.resultId);
    result.set('@session', {
      events,
      notes: noteRecord ? [noteRecord] : [],
    });
  }

  if (scope.blockContentId) {
    const events = (await storage.readonly('events').getAll()).filter(
      (e) => e.blockContentId === scope.blockContentId,
    );
    result.set('@block', {
      events,
      notes: noteRecord ? [noteRecord] : [],
    });
  }

  if (scope.noteId) {
    const events = (await storage.readonly('events').getAll()).filter((e) => e.noteId === scope.noteId);
    result.set('@note', {
      events,
      notes: noteRecord ? [noteRecord] : [],
    });
  }

  if (scope.notebookSlug) {
    const targetSlug = scope.notebookSlug.replace(/^notebook\//, '');
    const targetId = `notebook/${targetSlug}`;
    const nbNotes = allNotes.filter((n) => {
      if (n.notebookId === targetId) return true;
      if (n.notebookIds?.some((id) => id === targetId || id === targetSlug)) return true;
      if (n.tags?.some((t) => t === `notebook:${targetSlug}` || t === targetId)) return true;
      if (targetSlug === 'journal' && !n.feedOrigin && !n.feedSourceId && !n.sourcePath?.startsWith('markdown/') && n.type !== 'dashboard' && n.type !== 'playground') {
        return !n.notebookId;
      }
      if (targetSlug === 'playground' && (n.sourceId === 'playground' || n.type === 'playground')) return true;
      return n.sourceId?.startsWith(`notebook:${targetSlug}`) ?? false;
    });
    const noteIds = new Set(nbNotes.map((n) => n.id));
    const events = (await storage.readonly('events').getAll()).filter((e) => noteIds.has(e.noteId));
    result.set('@notebook', {
      events,
      notes: nbNotes,
    });
  }

  return result;
}
