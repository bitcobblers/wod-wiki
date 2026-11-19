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
        for (const noteId of noteIds) {
          const links = await storage.readonly('page_notes').getAllFromIndex('by-note', noteId);
          const tagLinks = await storage.readonly('note_tags').getAllFromIndex('by-note', noteId);
          const tags = await storage.readonly('tags').getMany(tagLinks.map((l) => l.tagId));
          const pages = await storage.readonly('page').getMany([...new Set(links.map((l) => l.pageId))]);
          bundles.set(noteId, {
            tags: tags.flatMap((t) => (t ? [{ label: t.label, ...(t.type ? { type: t.type } : {}) }] : [])),
            links,
            pages: pages.filter((p): p is Page => p !== undefined),
          });
        }
        return bundles;
      },
    },
    feedCatalogStore,
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
      }));
    },
  };

  Object.assign(stores, { sessionStore });

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
