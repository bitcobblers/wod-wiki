/** seedSync orchestrator: flag gate, fast path, claim, decision, broadcast — per seed source. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { SeedMetaRecord, SeedRow } from '@/types/seed';
import { emptySeedMeta, LEGACY_SEED_META_KEY, SEED_SCHEMA, seedMetaKey, seedNoteSourceId } from '@/types/seed';
import type { Note } from '@/types/storage';
import { CountingSeedSource, InMemorySeedSource } from './InMemorySeedSource';
import type { ISeedSource } from './ISeedSource';
import { seedNoteId } from './SeedImporter';
import { InMemorySeedStorage, type SeedChunkWrite } from './SeedImportStorage';
import { isSeedImportEnabled, readSeedCoverage, runSeedSync, SEED_BROADCAST_CHANNEL, SEED_IMPORT_FLAG, syncSeedSource, type SeedSourceSpec, type SeedSyncProgress } from './seedSync';

const row = (path: string): SeedRow => ({ path, content: `content of ${path}` });

const META_KEY = seedMetaKey('core');

function source(version: number): InMemorySeedSource {
  return new InMemorySeedSource(
    {
      schema: 1,
      version,
      builtAt: new Date(version).toISOString(),
      chunks: [{ id: 'canvas', path: 'chunks/canvas.json', sha256: 'cafe'.repeat(16), bytes: 1, count: 1 }],
    },
    { 'chunks/canvas.json': [row('markdown/canvas/a.md')] },
  );
}

const spec = (src: ISeedSource, embeddedVersion: number, id = 'core'): SeedSourceSpec => ({
  id,
  label: id,
  source: src,
  embeddedVersion,
});

const stored = (patch: Partial<SeedMetaRecord>): SeedMetaRecord => ({ ...emptySeedMeta(META_KEY), ...patch });

describe('runSeedSync', () => {
  it('is disabled unless the flag is on', async () => {
    const counting = new CountingSeedSource(source(1000));
    const outcome = await runSeedSync({
      sources: [spec(counting, 1000)],
      storage: new InMemorySeedStorage(),
      isEnabled: () => false,
    });
    expect(outcome).toBe('disabled');
    expect(counting.fetchManifestCalls).toBe(0);
  });

  it('takes the skip-fetch fast path when stored === embedded', async () => {
    const counting = new CountingSeedSource(source(1000));
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta(stored({ seedVersion: 1000 }));
    const outcome = await runSeedSync({
      sources: [spec(counting, 1000)],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('current');
    expect(counting.fetchManifestCalls).toBe(0);
  });

  it('imports a stale-schema checkpoint even when the manifest version is unchanged', async () => {
    const counting = new CountingSeedSource(source(1000));
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta(stored({ seedVersion: 1000, schema: SEED_SCHEMA - 1 }));
    const outcome = await runSeedSync({
      sources: [spec(counting, 1000)],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');
    expect(counting.fetchChunkCalls).toEqual(['chunks/canvas.json']);
    expect((await storage.getSeedMeta(META_KEY))!.schema).toBe(SEED_SCHEMA);
  });

  it('keeps the server-stale refusal for a stale schema over an older manifest', async () => {
    const counting = new CountingSeedSource(source(500));
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta(stored({ seedVersion: 1000, schema: SEED_SCHEMA - 1 }));
    const outcome = await runSeedSync({
      sources: [spec(counting, 1000)],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('server-stale');
    expect(counting.fetchChunkCalls).toEqual([]);
    expect((await storage.getSeedMeta(META_KEY))!.schema).toBe(SEED_SCHEMA - 1);
  });

  it('force re-sync bypasses the fast path and re-imports an unchanged seed', async () => {
    const counting = new CountingSeedSource(source(1000));
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta(stored({ seedVersion: 1000 }));
    const outcome = await runSeedSync({
      sources: [spec(counting, 1000)],
      storage,
      isEnabled: () => true,
      force: true,
    });
    expect(outcome).toBe('imported');
    expect(counting.fetchManifestCalls).toBe(2) // orchestrator check + importer fetch;
    expect(counting.fetchChunkCalls).toEqual(['chunks/canvas.json']);
    // The claim is released and the checkpoint still says current.
    const meta = await storage.getSeedMeta(META_KEY);
    expect(meta?.claim).toBeNull();
    expect(meta?.seedVersion).toBe(1000);
  });

  it('reports busy while another tab holds a fresh claim', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta(stored({ claim: { owner: 'other-tab', at: Date.now() } }));
    const outcome = await runSeedSync({
      sources: [spec(source(2000), 1000)],
      storage,
      owner: 'this-tab',
      now: () => 1000,
      isEnabled: () => true,
    });
    expect(outcome).toBe('busy');
  });

  it('refuses a server rollback without importing', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta(stored({ seedVersion: 5000 }));
    const outcome = await runSeedSync({
      sources: [spec(source(1000), 1000)],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('server-stale');
    expect(storage.allNotes()).toHaveLength(0);
  });

  it('imports, releases its claim, and broadcasts the new version', async () => {
    const storage = new InMemorySeedStorage();
    const broadcasts: unknown[] = [];
    const outcome = await runSeedSync({
      sources: [spec(source(1000), 0)],
      storage,
      owner: 'tab-1',
      isEnabled: () => true,
      broadcast: (m) => broadcasts.push(m),
    });
    expect(outcome).toBe('imported');
    expect(storage.allNotes()).toHaveLength(1);
    const meta = await storage.getSeedMeta(META_KEY);
    expect(meta!.seedVersion).toBe(1000);
    expect(meta!.claim).toBeNull();
    expect(broadcasts).toEqual([{ kind: 'seed-imported', source: 'core', version: 1000 }]);
  });

  it('releases the claim even when the import throws', async () => {
    const storage = new InMemorySeedStorage();
    const outcome = await runSeedSync({
      sources: [
        spec(
          {
            fetchManifest: () =>
              Promise.resolve({
                schema: 1,
                version: 1000,
                builtAt: '',
                chunks: [{ id: 'canvas', path: 'chunks/canvas.json', sha256: 'a', bytes: 1, count: 1 }],
              }),
            fetchChunk: () => Promise.reject(new Error('chunk fetch blew up')),
          },
          0,
        ),
      ],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('error');
    expect((await storage.getSeedMeta(META_KEY))!.claim).toBeNull();
    expect(SEED_BROADCAST_CHANNEL).toBe('wodwiki.seed');
  });
});

describe('multi-seed sources', () => {
  const collectionSource = (version: number): InMemorySeedSource =>
    new InMemorySeedSource(
      {
        schema: 1,
        version,
        builtAt: new Date(version).toISOString(),
        chunks: [
          { id: 'collection.a', path: 'chunks/collection.a.json', sha256: 'beef'.repeat(16), bytes: 1, count: 1 },
        ],
      },
      { 'chunks/collection.a.json': [row('markdown/collections/a/fran.md')] },
    );

  it('keeps an independent checkpoint per source', async () => {
    const storage = new InMemorySeedStorage();
    const outcome = await runSeedSync({
      sources: [spec(source(1000), 0), spec(collectionSource(50), 0, 'community')],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');
    const coreMeta = await storage.getSeedMeta(META_KEY);
    const communityMeta = await storage.getSeedMeta(seedMetaKey('community'));
    expect(Object.keys(coreMeta!.chunks)).toEqual(['canvas']);
    expect(Object.keys(communityMeta!.chunks)).toEqual(['collection.a']);
    expect(communityMeta!.seedVersion).toBe(50);
    expect(storage.allNotes().map((n) => n.sourcePath).sort()).toEqual([
      'markdown/canvas/a.md',
      'markdown/collections/a/fran.md',
    ]);
  });

  it('never deletes another source\'s rows when a chunk vanishes from this source', async () => {
    const storage = new InMemorySeedStorage();
    await runSeedSync({
      sources: [spec(source(1000), 0), spec(collectionSource(50), 0, 'community')],
      storage,
      isEnabled: () => true,
    });
    // The community library drops its only chunk entirely (empty manifest).
    const outcome = await runSeedSync({
      sources: [
        spec(source(1000), 1000),
        spec(
          new InMemorySeedSource(
            { schema: 1, version: 60, builtAt: '', chunks: [] },
            {},
          ),
          0,
          'community',
        ),
      ],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');
    // The core row survives; only the community note is reaped.
    expect(storage.allNotes().map((n) => n.sourcePath)).toEqual(['markdown/canvas/a.md']);
    expect((await storage.getSeedMeta(seedMetaKey('community')))!.chunks['collection.a']!.noteIds).toEqual([]);
  });

  it('aggregates outcomes worst-first across sources', async () => {
    const storage = new InMemorySeedStorage();
    const outcome = await runSeedSync({
      sources: [
        spec(source(1000), 1000), // current
        spec(
          {
            fetchManifest: () => Promise.reject(new Error('offline')),
            fetchChunk: () => Promise.reject(new Error('offline')),
          },
          0,
          'community',
        ), // error
      ],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('error');
  });

  it('removes the legacy single-seed checkpoint record', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(LEGACY_SEED_META_KEY), seedVersion: 42 });
    const outcome = await runSeedSync({
      sources: [spec(source(1000), 0)],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');
    expect(await storage.getSeedMeta(LEGACY_SEED_META_KEY)).toBeUndefined();
    expect((await storage.getSeedMeta(META_KEY))!.seedVersion).toBe(1000);
  });
});

describe('isSeedImportEnabled (default-on with opt-out)', () => {
  it('runs unless localStorage flag is explicitly 0', () => {
    localStorage.removeItem(SEED_IMPORT_FLAG);
    expect(isSeedImportEnabled()).toBe(true);
    localStorage.setItem(SEED_IMPORT_FLAG, '0');
    expect(isSeedImportEnabled()).toBe(false);
    localStorage.setItem(SEED_IMPORT_FLAG, '1');
    expect(isSeedImportEnabled()).toBe(true);
    localStorage.removeItem(SEED_IMPORT_FLAG);
  });
});

describe('syncSeedSource', () => {
  it('syncs only the named source', async () => {
    const countingCore = new CountingSeedSource(source(1000));
    const countingOther = new CountingSeedSource(source(2000));
    const storage = new InMemorySeedStorage();

    const outcome = await syncSeedSource('core', {
      sources: [spec(countingCore, 0), spec(countingOther, 0, 'community')],
      storage,
      isEnabled: () => true,
    });

    expect(outcome).toBe('imported');
    // The unselected source is never touched.
    expect(countingOther.fetchManifestCalls).toBe(0);
    expect(await storage.getSeedMeta(META_KEY)).toBeDefined();
    expect(await storage.getSeedMeta(seedMetaKey('community'))).toBeUndefined();
  });

  it('reports error for an unknown source id', async () => {
    const counting = new CountingSeedSource(source(1000));
    const outcome = await syncSeedSource('gone', {
      sources: [spec(counting, 0)],
      storage: new InMemorySeedStorage(),
      isEnabled: () => true,
    });
    expect(outcome).toBe('error');
    expect(counting.fetchManifestCalls).toBe(0);
  });
});

describe('readSeedCoverage', () => {
  it('classifies core vs library checkpoints without network', async () => {
    const storage = new InMemorySeedStorage();
    const offline: SeedSourceSpec = {
      id: 'community',
      label: 'community',
      source: new InMemorySeedSource({ schema: 1, version: 1, builtAt: '', chunks: [] }, {}),
      embeddedVersion: 0,
      autoImport: false,
    };
    const core = spec(source(1), 1);

    expect(await readSeedCoverage({ sources: [core, offline], storage })).toEqual({
      coreImported: false,
      libraryImported: false,
    });

    await storage.putSeedMeta(stored({ seedVersion: 1000 }));
    expect(await readSeedCoverage({ sources: [core, offline], storage })).toEqual({
      coreImported: true,
      libraryImported: false,
    });

    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('community')), seedVersion: 7 });
    expect(await readSeedCoverage({ sources: [core, offline], storage })).toEqual({
      coreImported: true,
      libraryImported: true,
    });
  });
});

describe('runSeedSync progress', () => {
  const shaOf = (rows: SeedRow[]): string =>
    createHash('sha256').update(JSON.stringify(rows)).digest('hex');

  // Real in-memory adapters; chunk `collection.beta` fails at commit time —
  // exactly the window where un-applied writes could leak into progress.
  class FailingAtCollectionBeta extends InMemorySeedStorage {
    async applyChunk(write: SeedChunkWrite): Promise<void> {
      if (write.notes.some((n) => n.seedChunkId === 'collection.beta')) throw new Error('chunk collection.beta exploded');
      await super.applyChunk(write);
    }
  }

  it('committed progress survives a later chunk failure and never counts failed writes', async () => {
    const keptPath = 'markdown/notes/kept.md';
    const freshPath = 'markdown/notes/fresh.md';
    const lostPath = 'markdown/notes/lost.md';
    const rows0 = [row(keptPath), row(freshPath)];
    const rows1 = [row(lostPath)];
    const coreSource = new InMemorySeedSource(
      {
        schema: SEED_SCHEMA,
        version: 1000,
        builtAt: new Date(1000).toISOString(),
        chunks: [rows0, rows1].map((rows, i) => ({
          id: `collection.${i === 0 ? 'alpha' : 'beta'}`,
          path: `chunks/collection.${i === 0 ? 'alpha' : 'beta'}.json`,
          sha256: shaOf(rows),
          bytes: 1,
          count: rows.length,
        })),
      },
      { 'chunks/collection.alpha.json': rows0, 'chunks/collection.beta.json': rows1 },
    );

    const storage = new FailingAtCollectionBeta();
    // Ownership invariant input: kept.md is already user-owned — its
    // rewrite must be reported skipped, never written, by the committed
    // chunk (before the failure ever happens).
    const userId = await seedNoteId(keptPath);
    const userNote: Note = {
      id: userId,
      title: 'User rewrite',
      createdAt: 42,
      type: 'note',
      sourceId: seedNoteSourceId(keptPath, `content of ${keptPath}`, 'collection.alpha')!,
      seedOrigin: 'user',
      sourcePath: keptPath,
    };
    await storage.applyChunk({
      notes: [userNote], segments: [], efforts: [], blocks: [], blockEfforts: [],
      deleteNoteIds: [], deleteEffortSlugs: [], deleteBlockIds: [], deleteBlockEffortIds: [],
      meta: emptySeedMeta(META_KEY),
    });

    const progress: SeedSyncProgress[] = [];
    const outcome = await runSeedSync({
      sources: [spec(coreSource, 0), spec(source(1000), 0, 'second')],
      storage,
      isEnabled: () => true,
      onProgress: (p) => progress.push(p),
    });

    // Sync All continues past the failing source.
    expect(outcome).toBe('error');
    expect(progress[0]).toEqual({
      phase: 'checking', sourceId: 'core', sourceLabel: 'core', sourceIndex: 1, totalSources: 2,
    });

    // Committed snapshot: seed row counted, user-owned row skipped, and the
    // failed chunk's writes nowhere in any event.
    const committed = progress.filter((p) => p.phase === 'committed');
    expect(committed[0]).toEqual({
      phase: 'committed',
      chunkId: 'collection.alpha',
      completedChunks: 1,
      totalChunks: 2,
      totalNotes: 1,
      totalEfforts: 0,
      totalBlocks: 0,
      skippedUserOwned: 1,
      deleted: 0,
      sourceId: 'core',
      sourceLabel: 'core',
      sourceIndex: 1,
      totalSources: 2,
    });
    expect(committed.map((p) => p.chunkId)).toEqual(['collection.alpha', 'canvas']);
    expect(progress.find((p) => p.phase === 'applying' && p.chunkId === 'collection.beta'))
      .toMatchObject({ completedChunks: 1, totalNotes: 1, skippedUserOwned: 1, deleted: 0 });

    // finished closes every attempted source with the real failure message.
    expect(progress.filter((p) => p.phase === 'finished')).toEqual([
      { phase: 'finished', outcome: 'error', error: 'chunk collection.beta exploded', sourceId: 'core', sourceLabel: 'core', sourceIndex: 1, totalSources: 2 },
      { phase: 'finished', outcome: 'imported', error: null, sourceId: 'second', sourceLabel: 'second', sourceIndex: 2, totalSources: 2 },
    ]);
    expect(progress.at(-1)).toMatchObject({ phase: 'finished', sourceId: 'second' });

    // Checkpoint survived for the committed chunk only, the claim was
    // released, and user-owned content is untouched.
    const checkpoint = (await storage.getSeedMeta(META_KEY))!;
    expect(Object.keys(checkpoint.chunks)).toEqual(['collection.alpha']);
    expect(checkpoint.claim).toBeNull();
    const notes = storage.allNotes();
    expect(notes.find((n) => n.id === userId)).toMatchObject({ title: 'User rewrite', seedOrigin: 'user' });
    expect(notes.some((n) => n.sourcePath === freshPath)).toBe(true);
    expect(notes.some((n) => n.sourcePath === lostPath)).toBe(false);
  });
});
