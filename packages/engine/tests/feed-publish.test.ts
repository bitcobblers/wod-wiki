import { describe, expect, it } from 'vitest';
import {
  HttpFeedTree,
  MemoryFeedTree,
  QueryService,
  checkUnpublishedFeedChanges,
  cloneRemoteRecord,
  composeNoteMarkdown,
  csvToTelemetryBundle,
  derivePublicationVisibility,
  exportPortableFilesFromStorage,
  getNotePublicationSummary,
  ingestPortableFilesIntoStorage,
  parseNoteBundleFromJsonl,
  parseNoteMarkdown,
  parseQuery,
  previewRemoteNotebook,
  previewRemoteRecord,
  publishFeedFromStorage,
  reconcileNoteBlocks,
  serializeNoteBundleToJsonl,
  setNotebookPublic,
  setSessionPublic,
  telemetryBundleToCsv,
  type Note,
  type Session,
} from '../src/index';
import type { IStorage, IReadOnlyStore, IReadWriteStore, IStorageTransaction, StoreName, StoreType } from '@bitcobblers/wod-wiki-storage';

class MapStore<T> implements IReadWriteStore<T> {
  private readonly rows = new Map<string, T>();
  constructor(private readonly keyOf: (v: T) => string) {}

  private keyStr(key: IDBValidKey): string {
    return Array.isArray(key) ? key.map(String).join('\u0000') : String(key);
  }

  async get(key: IDBValidKey): Promise<T | undefined> {
    return this.rows.get(this.keyStr(key));
  }
  async getMany(keys: IDBValidKey[]): Promise<(T | undefined)[]> {
    return keys.map((k) => this.rows.get(this.keyStr(k)));
  }
  async getAll(): Promise<T[]> {
    return [...this.rows.values()];
  }
  async getAllFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
    if (query === undefined) return this.getAll();
    const target = String(query);
    return [...this.rows.values()].filter((row) => {
      const r = row as Record<string, unknown>;
      if (indexName === 'by-note') return r.noteId === target;
      if (indexName === 'by-result') return r.resultId === target;
      return false;
    });
  }
  async getAllFromIndexMany(indexName: string, keys: IDBValidKey[]): Promise<T[][]> {
    return Promise.all(keys.map((k) => this.getAllFromIndex(indexName, k)));
  }
  async count(): Promise<number> {
    return this.rows.size;
  }
  async countFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange): Promise<number> {
    return (await this.getAllFromIndex(indexName, query)).length;
  }
  async put(value: T, key?: IDBValidKey): Promise<IDBValidKey> {
    const k = key !== undefined ? this.keyStr(key) : this.keyOf(value);
    this.rows.set(k, value);
    return k;
  }
  async putMany(values: T[]): Promise<IDBValidKey[]> {
    return Promise.all(values.map((v) => this.put(v)));
  }
  async delete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    this.rows.delete(this.keyStr(key as IDBValidKey));
  }
  async clear(): Promise<void> {
    this.rows.clear();
  }
}

function createTestStorage(): IStorage {
  const stores = new Map<string, MapStore<unknown>>();
  const keyFnFor = (name: StoreName): ((v: unknown) => string) => {
    if (name === 'block_revisions') {
      return (v) => {
        const r = v as { noteId: string; blockId: string; version: number };
        return `${r.noteId}\u0000${r.blockId}\u0000${r.version}`;
      };
    }
    if (name === 'meta') {
      return (v) => String((v as { key: string }).key);
    }
    if (name === 'efforts' || name === 'equipment') {
      return (v) => String((v as { slug: string }).slug);
    }
    return (v) => String((v as { id: string }).id);
  };
  const getStore = <K extends StoreName>(name: K): MapStore<StoreType<K>> => {
    let s = stores.get(name);
    if (!s) {
      s = new MapStore(keyFnFor(name));
      stores.set(name, s);
    }
    return s as MapStore<StoreType<K>>;
  };
  const txView: IStorageTransaction = {
    readonly: <K extends StoreName>(s: K): IReadOnlyStore<StoreType<K>> => getStore(s),
    readwrite: <K extends StoreName>(s: K): IReadWriteStore<StoreType<K>> => getStore(s),
  };
  return {
    readonly: (s) => getStore(s),
    readwrite: (s) => getStore(s),
    transaction: async (_stores, _mode, fn) => fn(txView),
    wipe: async () => {
      for (const s of stores.values()) await s.clear();
    },
    close: async () => {},
  };
}

describe('Engine FeedPublisher, VaultIngestor, Visibility & Distributed WQL Planes', () => {
  it('tracks Publication Visibility across Private, Published Note, and Published Note + Data, and detects unpublished changes', async () => {
    const storage = createTestStorage();
    const raw = '# Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wodBlock = Object.values(blocks)[0]!;

    const note: Note = {
      id: '01950000-0000-7000-8000-000000000010',
      title: 'Cindy',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      date: Date.parse('2026-11-10T12:00:00Z'),
      createdAt: 1000,
      notebookId: 'notebook/benchmarks',
      seedOrigin: 'user',
    };
    await storage.readwrite('notes').put(note);
    await storage.readwrite('block_revisions').put({
      noteId: note.id,
      blockId: wodBlock.id,
      version: 1,
      kind: 'wod',
      rawContent: raw.slice(wodBlock.from, wodBlock.to),
      savedAt: 1000,
      dialect: 'time',
    });

    const s1: Session = {
      id: 'sess-private',
      noteId: note.id,
      blockId: wodBlock.id,
      blockVersion: 1,
      blockContentId: 'cid-cindy',
      status: 'completed',
      startTime: 2000,
      endTime: 3000,
      duration: 1000,
      completed: true,
      createdAt: 3000,
    };
    await storage.readwrite('sessions').put(s1);

    // 1. Default notebook is Private
    expect((await getNotePublicationSummary(storage, note.id)).visibility).toBe('Private');

    // 2. Mark notebook Public → Published Note (0 public sessions)
    await setNotebookPublic(storage, 'notebook/benchmarks', true);
    expect((await getNotePublicationSummary(storage, note.id)).visibility).toBe('Published Note');

    // 3. Opt in session → Published Note + Data
    await setSessionPublic(storage, s1.id, true);
    const visWithData = await getNotePublicationSummary(storage, note.id);
    expect(visWithData.visibility).toBe('Published Note + Data');
    expect(visWithData.publicSessions).toBe(1);

    // 4. Before first publish, dirty === true
    const preStatus = await checkUnpublishedFeedChanges(storage);
    expect(preStatus.dirty).toBe(true);
    expect(preStatus.publicNotebooks).toBe(1);
    expect(preStatus.publicSessions).toBe(1);

    // 5. Publish to MemoryFeedTree (simulating wod server /feed/)
    const serverTree = new MemoryFeedTree();
    const published = await publishFeedFromStorage(storage, serverTree, {
      layout: 'feed',
      name: 'Self-Hosted Test Feed',
    });
    expect(published.manifest.version).toBe(1);
    expect(published.totalNotes).toBe(1);
    expect(published.totalPublicSessions).toBe(1);

    // 6. Immediately after publish, dirty === false
    const cleanStatus = await checkUnpublishedFeedChanges(storage, serverTree);
    expect(cleanStatus.dirty).toBe(false);

    // 7. Remote subscriber previews & clones Cindy via HttpFeedTree without full import
    const fakeFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const rel = url.pathname.replace(/^\/feed\//, '');
      try {
        const bytes = await serverTree.read(rel);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return new Response(copy.buffer, { status: 200 });
      } catch {
        return new Response('not found', { status: 404 });
      }
    };
    const remoteReader = new HttpFeedTree('https://peer.example.com/feed/', fakeFetch);
    const nbIndex = await previewRemoteNotebook(remoteReader, 'indexes/notebooks/notebook.benchmarks.json');
    expect(nbIndex.records).toHaveLength(1);
    expect(nbIndex.records[0]!.title).toBe('Cindy');

    const previewedRow = await previewRemoteRecord(remoteReader, nbIndex.records[0]!.recordPath);
    expect(previewedRow.telemetry?.sessions).toHaveLength(1);

    const subscriberStorage = createTestStorage();
    const cloned = await cloneRemoteRecord(subscriberStorage, remoteReader, {
      feedId: 'peer-feed',
      record: nbIndex.records[0]!,
      targetNotebookId: 'notebook/my-clones',
    });
    expect(cloned.title).toBe('Cindy');
    expect(cloned.notebookId).toBe('notebook/my-clones');
    expect(cloned.seedOrigin).toBe('user');
  });

  it('round-trips portable .md and .jsonl / .csv files across vaults and executes :feed{} and :notebook{type:notebook} WQL planes', async () => {
    const srcStorage = createTestStorage();
    const mdRaw = '# Helen\n\n```time\n(3)\n  400m Run\n  21 Kettlebell Swings\n  12 Pull-ups\n```\n';
    const blocks = reconcileNoteBlocks(mdRaw, { sourceRevision: 1 });
    const b = Object.values(blocks)[0]!;
    const noteId = '01950000-0000-7000-8000-000000000077';
    await srcStorage.readwrite('notes').put({
      id: noteId,
      title: 'Helen',
      rawContent: mdRaw,
      sourceRevision: 1,
      blocks,
      date: Date.parse('2026-08-01T12:00:00Z'),
      createdAt: 500,
      notebookId: 'notebook/girls',
      seedOrigin: 'user',
    });
    await srcStorage.readwrite('block_revisions').put({
      noteId,
      blockId: b.id,
      version: 1,
      kind: 'wod',
      rawContent: mdRaw.slice(b.from, b.to),
      savedAt: 500,
      dialect: 'time',
    });
    await srcStorage.readwrite('sessions').put({
      id: 'helen-s1',
      noteId,
      blockId: b.id,
      blockVersion: 1,
      blockContentId: 'cid-helen',
      status: 'completed',
      startTime: 1000,
      endTime: 1500,
      duration: 500,
      completed: true,
      createdAt: 1500,
      public: true,
    });

    const exported = await exportPortableFilesFromStorage(srcStorage, { telemetryFormat: 'both' });
    expect(exported.some((f) => f.path.endsWith('.md'))).toBe(true);
    expect(exported.some((f) => f.path.endsWith('.jsonl'))).toBe(true);
    expect(exported.some((f) => f.path.endsWith('.csv'))).toBe(true);

    const destStorage = createTestStorage();
    const report = await ingestPortableFilesIntoStorage(destStorage, exported);
    expect(report.errors).toEqual([]);
    expect(report.notesImported).toBe(1);
    expect(report.sessionsImported).toBe(1);

    // WQL :feed{} and :notebook{} container + remote preview planes
    const qs = new QueryService({
      feedCatalogStore: {
        getAllFeeds: async () => [
          {
            id: 'local',
            label: 'My Published Feed',
            url: 'https://me.example/feed/',
            tier: 'local',
            subscribed: true,
            installed: true,
            notebookCount: 1,
            itemCount: 1,
            unpublishedChanges: true,
          },
          {
            id: 'peer-kb',
            label: 'Peer Kettlebell Feed',
            url: 'https://peer.example/feed/',
            tier: 'imported',
            subscribed: false,
            installed: false,
            notebookCount: 1,
            itemCount: 12,
          },
        ],
        getAllNotebooks: async () => [
          {
            id: 'notebook/girls',
            feedId: 'local',
            feedLabel: 'Yours (Local)',
            chunkId: 'notebook.girls',
            slug: 'girls',
            label: 'Girls',
            count: 1,
            subscribed: true,
            installed: true,
            origin: 'user',
            public: true,
          },
          {
            id: 'peer-kb:notebook.snatch-cycle',
            feedId: 'peer-kb',
            feedLabel: 'Peer Kettlebell Feed',
            chunkId: 'notebook.snatch-cycle',
            slug: 'snatch-cycle',
            label: 'Snatch Cycle',
            count: 12,
            subscribed: false,
            installed: false,
            origin: 'feed',
          },
        ],
        getRemoteNotebookNotes: async (slug) =>
          slug === 'snatch-cycle'
            ? [
                {
                  id: 'remote:peer-kb:uuid-1',
                  title: 'Day 1 Snatch Test',
                  rawContent: '',
                  sourceRevision: 1,
                  blocks: {},
                  createdAt: 1000,
                  notebookId: 'notebook/snatch-cycle',
                  sourceId: 'notebook:snatch-cycle/day-1',
                  feedOrigin: 'feed',
                  feedSourceId: 'peer-kb',
                  seedOrigin: 'seed',
                },
              ]
            : [],
      },
    });

    const feedsRes = await qs.runFind(parseQuery(':feed{}') as never);
    expect(feedsRes.notes.map((n) => n.id)).toEqual(['feed/local', 'feed/peer-kb']);

    const subNotebooksRes = await qs.runFind(parseQuery(':notebook{subscribed:true}') as never, {
      notebookPlane: 'containers',
    });
    expect(subNotebooksRes.notes.map((n) => n.id)).toEqual(['notebook/girls']);

    const unsubNotebooksRes = await qs.runFind(parseQuery(':notebook{subscribed:false}') as never, {
      notebookPlane: 'containers',
    });
    expect(unsubNotebooksRes.notes.map((n) => n.id)).toEqual(['feed-notebook/peer-kb/snatch-cycle']);

    const remotePreviewRes = await qs.runFind(
      parseQuery(':note{notebook:snatch-cycle,subscribed:true,false}') as never,
    );
    expect(remotePreviewRes.notes.map((n) => n.title)).toEqual(['Day 1 Snatch Test']);

    // Verify unused imports aren't stripped or broken
    expect(typeof composeNoteMarkdown).toBe('function');
    expect(typeof parseNoteMarkdown).toBe('function');
    expect(typeof serializeNoteBundleToJsonl).toBe('function');
    expect(typeof parseNoteBundleFromJsonl).toBe('function');
    expect(typeof telemetryBundleToCsv).toBe('function');
    expect(typeof csvToTelemetryBundle).toBe('function');
    expect(typeof derivePublicationVisibility).toBe('function');
  });
});
