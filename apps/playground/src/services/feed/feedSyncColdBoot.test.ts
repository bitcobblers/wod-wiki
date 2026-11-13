import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileNoteBlocks, SEED_SCHEMA, seedNoteId, type SeedManifest, type SeedRow } from '@bitcobblers/wod-wiki-engine';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { IndexedDBStorage } from '@bitcobblers/wod-wiki-storage/idb';
import { IndexedDBFeedImportStorage } from './FeedImportStorage';
import type { SeedChunkPayload } from './IFeedSource';
import { InMemoryFeedSource } from './InMemoryFeedSource';
import { runSourceSyncCore } from './feedSyncCore';
import { resetFeedReadinessForTest, startFeedBootstrap } from './feedReadiness';
import { resetFeedSubscriptionsForTest } from './feedSubscriptions';
import type { FeedSourceSpec } from './feedSync';
import { seedMetaKey } from '@/types/seed';
import { StorageService } from '@/services/storage/StorageService';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';

function makeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => [...map.keys()][i] ?? null,
  };
}

function makeManifest(version: number, chunks: Array<{ id: string; path: string; row: SeedRow; recordPath?: string }>): {
  manifest: SeedManifest;
  chunksMap: Record<string, SeedChunkPayload>;
} {
  const manifestChunks = chunks.map((c, i) => ({
    id: c.id,
    path: c.path,
    sha256: String(version * 10 + i).padStart(64, 'a'),
    bytes: 100,
    count: 1,
    ...(c.recordPath
      ? {
          records: [
            {
              uuid: c.row.uuid ?? `uuid-${c.id}`,
              path: c.row.path,
              recordPath: c.recordPath,
              commit: `commit-${version}-${i}`,
              version,
              sha256: String(version * 10 + i).padStart(64, 'b'),
              title: c.id,
            },
          ],
        }
      : {}),
  }));
  const chunksMap: Record<string, SeedChunkPayload> = {};
  for (const c of chunks) {
    chunksMap[c.path] = [c.row];
    if (c.recordPath) chunksMap[c.recordPath] = c.row as unknown as SeedChunkPayload;
  }
  return {
    manifest: {
      schema: SEED_SCHEMA,
      version,
      commit: `seed-commit-${version}`,
      builtAt: new Date(version * 1000).toISOString(),
      chunks: manifestChunks,
    },
    chunksMap,
  };
}

describe('Cold boot seed sync & user data survival (WW-019, WW-020)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeLocalStorage(), configurable: true });
    resetFeedReadinessForTest();
    resetFeedSubscriptionsForTest();
  });

  it('WW-019: cold boot uses bulk chunk fetches instead of per-record fetches and commits non-canvas chunks atomically', async () => {
    const dbName = `ww019-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idb = new IndexedDBStorage({ dbName });
    const storage = new IndexedDBFeedImportStorage(idb);

    const canvasRow = compileSeedRow('markdown/canvas/home.md', '# Home\n');
    const alphaRow = compileSeedRow('markdown/notebooks/alpha/a.md', '# Alpha\n');
    const betaRow = compileSeedRow('markdown/notebooks/beta/b.md', '# Beta\n');
    canvasRow.uuid = await seedNoteId(canvasRow.path);
    alphaRow.uuid = await seedNoteId(alphaRow.path);
    betaRow.uuid = await seedNoteId(betaRow.path);

    const { manifest, chunksMap } = makeManifest(1, [
      { id: 'canvas', path: 'chunks/canvas.json', row: canvasRow, recordPath: 'records/canvas.json' },
      { id: 'notebook.alpha', path: 'chunks/notebook.alpha.json', row: alphaRow, recordPath: 'records/alpha.json' },
      { id: 'notebook.beta', path: 'chunks/notebook.beta.json', row: betaRow, recordPath: 'records/beta.json' },
    ]);

    const fetchedPaths: string[] = [];
    const baseSource = new InMemoryFeedSource(manifest, chunksMap);
    const trackingSource = {
      fetchManifest: () => baseSource.fetchManifest(),
      fetchChunk: async (path: string) => {
        fetchedPaths.push(path);
        return baseSource.fetchChunk(path);
      },
    };

    let applyChunksCalls = 0;
    const origApplyChunks = storage.applyChunks.bind(storage);
    storage.applyChunks = async (writes) => {
      applyChunksCalls++;
      return origApplyChunks(writes);
    };

    try {
      const result = await runSourceSyncCore(
        {
          id: 'core',
          label: 'Core',
          source: trackingSource,
          embeddedVersion: 1,
          autoSyncOn: true,
          granularRecords: true,
        },
        { storage, owner: 'test-owner', now: () => 1000, background: false },
      );

      expect(result.outcome).toBe('imported');
      // Cold boot MUST fetch bulk chunks, never per-record paths.
      expect(fetchedPaths).toEqual([
        'chunks/canvas.json',
        'chunks/notebook.alpha.json',
        'chunks/notebook.beta.json',
      ]);
      // Non-canvas chunks commit in one atomic applyChunks transaction.
      expect(applyChunksCalls).toBe(1);
      expect(await idb.readonly('notes').count()).toBe(3);
    } finally {
      await idb.close();
    }
  });

  it('WW-019: interrupted partial checkpoint (missing chunk) is repaired instead of short-circuiting as current', async () => {
    const dbName = `ww019-partial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idb = new IndexedDBStorage({ dbName });
    const storage = new IndexedDBFeedImportStorage(idb);

    const canvasRow = compileSeedRow('markdown/canvas/home.md', '# Home\n');
    const alphaRow = compileSeedRow('markdown/notebooks/alpha/a.md', '# Alpha\n');
    const { manifest, chunksMap } = makeManifest(1, [
      { id: 'canvas', path: 'chunks/canvas.json', row: canvasRow },
      { id: 'notebook.alpha', path: 'chunks/notebook.alpha.json', row: alphaRow },
    ]);

    try {
      // Simulate an interrupted cold boot where only canvas landed in meta.chunks
      // while seedVersion & builtAt were already stamped.
      await storage.putSeedMeta({
        key: seedMetaKey('core'),
        schema: SEED_SCHEMA,
        seedVersion: manifest.version,
        builtAt: manifest.builtAt,
        importedAt: 500,
        chunks: {
          canvas: { sha256: manifest.chunks[0]!.sha256, noteIds: [await seedNoteId(canvasRow.path)] },
        },
        claim: null,
      });

      const result = await runSourceSyncCore(
        {
          id: 'core',
          label: 'Core',
          source: new InMemoryFeedSource(manifest, chunksMap),
          embeddedVersion: 1,
          autoSyncOn: true,
        },
        { storage, owner: 'test-owner', now: () => 1000, background: true, probeManifests: true },
      );

      expect(result.outcome).toBe('imported');
      const meta = await storage.getSeedMeta(seedMetaKey('core'));
      expect(Object.keys(meta?.chunks ?? {}).sort()).toEqual(['canvas', 'notebook.alpha']);
      expect(await idb.readonly('notes').count()).toBe(1); // notebook.alpha landed
    } finally {
      await idb.close();
    }
  });

  it('WW-020: user-authored notes (2/2) and recorded sessions (2/2) survive cold boot and seed re-import churn in IndexedDB', async () => {
    const dbName = `ww020-idb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idb = new IndexedDBStorage({ dbName });
    const feedStorage = new IndexedDBFeedImportStorage(idb);
    const service = new StorageService(idb);
    const provider = new IndexedDBContentProvider(service);
    const persistence = new IndexedDBNotePersistence(service, provider);

    const canvasRowV1 = compileSeedRow('markdown/canvas/home.md', '# Home v1\n');
    const sampleRowV1 = compileSeedRow('markdown/notebooks/samples/fran.md', '# Fran\n\n```time\n21-15-9\n  Thrusters\n```\n');
    const { manifest: coreV1, chunksMap: coreChunksV1 } = makeManifest(1, [
      { id: 'canvas', path: 'chunks/canvas.json', row: canvasRowV1 },
    ]);
    const { manifest: sampleV1, chunksMap: sampleChunksV1 } = makeManifest(1, [
      { id: 'notebook.samples', path: 'chunks/notebook.samples.json', row: sampleRowV1 },
    ]);

    const sourcesV1: FeedSourceSpec[] = [
      { id: 'core', label: 'Core', source: new InMemoryFeedSource(coreV1, coreChunksV1), url: 'https://feed.test/core/', embeddedVersion: 1 },
      { id: 'samples-movement', label: 'Samples', source: new InMemoryFeedSource(sampleV1, sampleChunksV1), url: 'https://feed.test/samples/', embeddedVersion: 0, autoImport: false },
    ];

    try {
      // 1. Initial cold boot
      await startFeedBootstrap({ sources: sourcesV1, storage: feedStorage, isEnabled: () => true });

      // 2. User authors 2 notes and records 2 sessions
      const wodContent1 = '# User WOD 1\n\n```time\n10 Push-ups\n```\n';
      const wodContent2 = '# User WOD 2\n\n```time\n20 Air Squats\n```\n';
      const blocks1 = reconcileNoteBlocks(wodContent1, { sourceRevision: 1 });
      const blocks2 = reconcileNoteBlocks(wodContent2, { sourceRevision: 1 });
      const blockId1 = Object.keys(blocks1)[0]!;
      const blockId2 = Object.keys(blocks2)[0]!;

      const started1 = await persistence.startSession(
        { noteId: 'user-note-1', rawContent: wodContent1, blocks: blocks1, expectedSourceRevision: 0, metadata: { title: 'User WOD 1' } },
        { id: 'user-sess-1', noteId: 'user-note-1', blockId: blockId1, origin: 'journal', startTime: 1000, endTime: 1000, duration: 0, completed: false, createdAt: 1000 },
      );
      await persistence.finishSession(started1.session.id, {
        startTime: 1000, endTime: 61_000, duration: 60_000, completed: true, logs: [],
      }, 61_000);

      const started2 = await persistence.startSession(
        { noteId: 'user-note-2', rawContent: wodContent2, blocks: blocks2, expectedSourceRevision: 0, metadata: { title: 'User WOD 2' } },
        { id: 'user-sess-2', noteId: 'user-note-2', blockId: blockId2, origin: 'playground', startTime: 2000, endTime: 2000, duration: 0, completed: false, createdAt: 2000 },
      );
      await persistence.finishSession(started2.session.id, {
        startTime: 2000, endTime: 122_000, duration: 120_000, completed: true, logs: [],
      }, 122_000);

      expect(await idb.readonly('notes').get('user-note-1')).toBeDefined();
      expect(await idb.readonly('notes').get('user-note-2')).toBeDefined();
      expect(await idb.readonly('sessions').get('user-sess-1')).toBeDefined();
      expect(await idb.readonly('sessions').get('user-sess-2')).toBeDefined();

      // 3. Simulate fresh browser launch with bumped seed versions (re-import churn)
      resetFeedReadinessForTest();
      const canvasRowV2 = compileSeedRow('markdown/canvas/home.md', '# Home v2\n');
      const sampleRowV2 = compileSeedRow('markdown/notebooks/samples/fran.md', '# Fran v2\n\n```time\n21-15-9\n  Thrusters\n```\n');
      const { manifest: coreV2, chunksMap: coreChunksV2 } = makeManifest(2, [
        { id: 'canvas', path: 'chunks/canvas.json', row: canvasRowV2 },
      ]);
      const { manifest: sampleV2, chunksMap: sampleChunksV2 } = makeManifest(2, [
        { id: 'notebook.samples', path: 'chunks/notebook.samples.json', row: sampleRowV2 },
      ]);
      const sourcesV2: FeedSourceSpec[] = [
        { id: 'core', label: 'Core', source: new InMemoryFeedSource(coreV2, coreChunksV2), url: 'https://feed.test/core/', embeddedVersion: 2 },
        { id: 'samples-movement', label: 'Samples', source: new InMemoryFeedSource(sampleV2, sampleChunksV2), url: 'https://feed.test/samples/', embeddedVersion: 0, autoImport: false },
      ];

      await startFeedBootstrap({ sources: sourcesV2, storage: feedStorage, isEnabled: () => true });

      // 4. Verify 2/2 user-authored notes and 2/2 recorded sessions survived
      expect(await idb.readonly('notes').get('user-note-1')).toMatchObject({ id: 'user-note-1', title: 'User WOD 1', rawContent: wodContent1 });
      expect(await idb.readonly('notes').get('user-note-2')).toMatchObject({ id: 'user-note-2', title: 'User WOD 2', rawContent: wodContent2 });
      expect(await idb.readonly('sessions').get('user-sess-1')).toMatchObject({ id: 'user-sess-1', completed: true, duration: 60_000 });
      expect(await idb.readonly('sessions').get('user-sess-2')).toMatchObject({ id: 'user-sess-2', completed: true, duration: 120_000 });
    } finally {
      await idb.close();
    }
  });
});
