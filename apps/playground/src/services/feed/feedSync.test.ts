import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { SEED_SCHEMA, emptySeedMeta, seedMetaKey, type SeedMetaRecord } from '@/types/seed';
import { InMemoryFeedStorage, type SeedChunkWrite, type SeedChunkResult } from './FeedImportStorage';
import { CountingFeedSource, InMemoryFeedSource } from './InMemoryFeedSource';
import { feedFixture as fixture } from './feedFixture';
import { adoptLegacyCoreRegistryCheckpoint, adoptLegacyFeedCheckpoints, runBootFeedSync, runFeedSync, readFeedCoverage, readFeedStatus, syncFeedSource, FEED_IMPORT_FLAG, isFeedImportEnabled, type FeedSourceSpec, type FeedSyncProgress } from './feedSync';
import type { IFeedSource } from './IFeedSource';

function spec(source: IFeedSource, id = 'core', embeddedVersion = 0): FeedSourceSpec { return { source, id, label: id, url: `https://feed.test/${id}/`, embeddedVersion }; }
const source = () => fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');

describe('seed sync orchestration', () => {
  it('disabled sync never fetches', async () => {
    const counting = new CountingFeedSource(source());
    expect(await runFeedSync({ sources: [spec(counting)], storage: new InMemoryFeedStorage(), isEnabled: () => false })).toBe('disabled');
    expect(counting.fetchManifestCalls).toBe(0);
  });
  it('current embedded version skips fetch, other sources remain independently scoped', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1 });
    const counting = new CountingFeedSource(source());
    expect(await runFeedSync({ sources: [spec(counting, 'core', 1)], storage, isEnabled: () => true })).toBe('current');
    expect(counting.fetchManifestCalls).toBe(0);
    expect(await syncFeedSource('community', { sources: [spec(source(), 'core'), spec(source(), 'community')], storage, isEnabled: () => true })).toBe('imported');
    expect((await storage.getSeedMeta(seedMetaKey('community')))?.seedVersion).toBe(1);
  });
  it('refuses incompatible checkpoints without migration', async () => {
    const storage = new InMemoryFeedStorage();
    const old = { ...emptySeedMeta(seedMetaKey('core')), schema: SEED_SCHEMA - 1, seedVersion: 1 };
    await storage.putSeedMeta(old);
    expect(await runFeedSync({ sources: [spec(source())], storage, isEnabled: () => true })).toBe('error');
    expect(await storage.getSeedMeta(old.key)).toEqual(old);
  });
  it('fresh competing claim reports busy and preserves its owner', async () => {
    const storage = new InMemoryFeedStorage();
    const meta = { ...emptySeedMeta(seedMetaKey('core')), claim: { owner: 'other', at: 50 } };
    await storage.putSeedMeta(meta);
    expect(await runFeedSync({ sources: [spec(source())], storage, isEnabled: () => true, now: () => 100, owner: 'mine' })).toBe('busy');
    expect(await storage.getSeedMeta(meta.key)).toEqual(meta);
  });
  it('releases its claim on failed chunk and publishes only committed progress', async () => {
    class FailingStorage extends InMemoryFeedStorage {
      async applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult> {
        if (write.chunkId === 'notebook.beta') throw new Error('beta failed');
        return super.applyChunk(write);
      }
    }
    const a = compileSeedRow('markdown/canvas/a.md', '# A');
    const b = compileSeedRow('markdown/notebooks/beta/b.md', '# B');
    const src = new InMemoryFeedSource({ schema: SEED_SCHEMA, version: 1, builtAt: new Date(1).toISOString(), chunks: [
      { id: 'canvas', path: 'chunks/canvas.json', sha256: 'a'.repeat(64), bytes: 1, count: 1 },
      { id: 'notebook.beta', path: 'chunks/beta.json', sha256: 'b'.repeat(64), bytes: 1, count: 1 },
    ] }, { 'chunks/canvas.json': [a], 'chunks/beta.json': [b] });
    const storage = new FailingStorage(), progress: FeedSyncProgress[] = [];
    expect(await runFeedSync({ sources: [spec(src)], storage, isEnabled: () => true, onProgress: (p) => progress.push(p) })).toBe('error');
    const checkpoint = await storage.getSeedMeta(seedMetaKey('core'));
    expect(Object.keys(checkpoint!.chunks)).toEqual(['canvas']);
    expect(checkpoint!.claim).toBeNull();
    expect(progress.filter((p): p is FeedSyncProgress & { chunkId: string | null } => p.phase === 'committed').map((p) => p.chunkId)).toEqual(['canvas']);
    expect(await storage.storageInstance.readonly('notes').count()).toBe(1);
  });
  it('coverage needs no remote read and default flag can be disabled', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1 });
    expect(await readFeedCoverage({ storage, sources: [spec(source())] })).toEqual({ coreImported: true, libraryImported: false });
    localStorage.removeItem(FEED_IMPORT_FLAG);
    expect(isFeedImportEnabled()).toBe(true);
    localStorage.setItem(FEED_IMPORT_FLAG, '0');
    expect(isFeedImportEnabled()).toBe(false);
    localStorage.removeItem(FEED_IMPORT_FLAG);
  });
});

describe('seed-level identity', () => {
  const games = compileSeedRow('markdown/notebooks/crossfit-games/g.md', '# Games');
  const heroes = compileSeedRow('markdown/notebooks/crossfit-heroes/h.md', '# Heroes');
  /** One seed publishing TWO notebooks — the case the seed unit exists for. */
  const twoNotebookSeed = () => {
    const chunks = [
      { id: 'notebook.crossfit-games', rows: [games] },
      { id: 'notebook.crossfit-heroes', rows: [heroes] },
    ].map(({ id, rows }) => {
      const body = JSON.stringify(rows);
      return {
        id,
        rows,
        entry: {
          id,
          path: `chunks/${id}.json`,
          sha256: createHash('sha256').update(body).digest('hex'),
          bytes: new TextEncoder().encode(body).length,
          count: rows.length,
        },
      };
    });
    return new InMemoryFeedSource(
      { schema: SEED_SCHEMA, version: 3, builtAt: new Date(3).toISOString(), chunks: chunks.map((c) => c.entry) },
      Object.fromEntries(chunks.map((c) => [c.entry.path, c.rows])),
    );
  };

  it('stamps the source tier on the checkpoint, so the built-in corpus keeps its precedence', async () => {
    const storage = new InMemoryFeedStorage();
    const sources = [{ ...spec(twoNotebookSeed(), 'seed-crossfit'), tier: 'community' as const }];
    expect(await runFeedSync({ sources, storage, isEnabled: () => true })).toBe('imported');
    const meta = await storage.getSeedMeta(seedMetaKey('seed-crossfit'));
    expect(meta?.tier).toBe('community');
    expect(Object.keys(meta!.chunks).sort()).toEqual(['notebook.crossfit-games', 'notebook.crossfit-heroes']);
  });

  it('one Subscribe applies every notebook the seed publishes', async () => {
    const storage = new InMemoryFeedStorage();
    const sources = [spec(twoNotebookSeed(), 'seed-crossfit')];
    expect(await syncFeedSource('seed-crossfit', { sources, storage, isEnabled: () => true })).toBe('imported');
    const status = await readFeedStatus({ sources, storage, now: () => 7 });
    expect(status.sources[0]!.notebooks.map((n) => ({ label: n.label, chunkId: n.chunkId, imported: n.imported }))).toEqual([
      { label: 'CrossFit Games', chunkId: 'notebook.crossfit-games', imported: true },
      { label: 'CrossFit Heroes', chunkId: 'notebook.crossfit-heroes', imported: true },
    ]);
    expect(status.sources[0]!.count).toBe(2);
  });

  it('names the notebooks from the registry when the manifest is unreachable', async () => {
    const storage = new InMemoryFeedStorage();
    const offline: IFeedSource = {
      fetchManifest: () => Promise.reject(new Error('offline')),
      fetchChunk: () => Promise.resolve([]),
    };
    const status = await readFeedStatus({ sources: [spec(offline, 'seed-crossfit')], storage });
    expect(status.sources[0]!.remote).toBeNull();
    expect(status.sources[0]!.notebooks.map((n) => n.chunkId)).toEqual([
      'notebook.crossfit-games',
      'notebook.crossfit-girls',
      'notebook.crossfit-heroes',
      'notebook.crossfit-programming',
    ]);
    expect(status.sources[0]!.notebooks.every((n) => !n.imported)).toBe(true);
  });
});

describe('feed identity in the sync surface', () => {
  it('reports one id for the feed — the registry id it syncs from', async () => {
    const storage = new InMemoryFeedStorage();
    const sources = [spec(source(), 'seed-crossfit')];
    const status = await readFeedStatus({ sources, storage, now: () => 7 });
    const reported = status.sources[0]!;
    expect(reported.id).toBe('seed-crossfit');
    // The checkpoint, the URL, and the precedence are unchanged.
    expect(reported.url).toBe('https://feed.test/seed-crossfit/');
    expect(reported.stored).toBeNull();
  });

  it('names the feed on every progress event', async () => {
    const storage = new InMemoryFeedStorage();
    const progress: FeedSyncProgress[] = [];
    await runFeedSync({
      sources: [spec(source(), 'community')],
      storage,
      isEnabled: () => true,
      onProgress: (event) => progress.push(event),
    });
    expect(progress.length).toBeGreaterThan(0);
    for (const event of progress) {
      expect(event.sourceId).toBe('community');
      expect(event.sourceLabel).toBe('community');
    }
  });
});

describe('legacy checkpoint adoption', () => {
  it('folds pre-seed-unit per-notebook checkpoints into the seed checkpoint once', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('community-crossfit-games')),
      seedVersion: 4, builtAt: 'b4', importedAt: 40, tier: 'community',
      chunks: { 'notebook.crossfit-games': { sha256: 'a'.repeat(64), noteIds: ['note-games'] } },
    });
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('community-crossfit-heroes')),
      seedVersion: 7, builtAt: 'b7', importedAt: 70,
      chunks: { 'notebook.crossfit-heroes': { sha256: 'b'.repeat(64), noteIds: ['note-heroes'] } },
    });

    expect(await adoptLegacyFeedCheckpoints({ storage })).toBe(1);
    const merged = await storage.getSeedMeta(seedMetaKey('seed-crossfit'));
    expect(merged).toMatchObject({ seedVersion: 7, builtAt: 'b7', importedAt: 70, tier: 'community' });
    expect(merged!.chunks['notebook.crossfit-games'].noteIds).toEqual(['note-games']);
    expect(merged!.chunks['notebook.crossfit-heroes'].noteIds).toEqual(['note-heroes']);
    // Ownership lives in exactly one record after the fold.
    expect((await storage.getSeedMeta(seedMetaKey('community-crossfit-games')))?.chunks).toEqual({});
    expect((await storage.getSeedMeta(seedMetaKey('community-crossfit-heroes')))?.seedVersion).toBe(0);
    // Idempotent: the seed checkpoint now exists and is never clobbered.
    expect(await adoptLegacyFeedCheckpoints({ storage })).toBe(0);
    expect((await storage.getSeedMeta(seedMetaKey('seed-crossfit')))?.seedVersion).toBe(7);
  });

  it('adopts nothing when no seed has legacy rows', async () => {
    expect(await adoptLegacyFeedCheckpoints({ storage: new InMemoryFeedStorage() })).toBe(0);
  });
});

describe('legacy core registry migration', () => {
  it('folds the retired remote registry into core, invalidated, and blanks the legacy record', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('core')),
      seedVersion: 5, builtAt: 'b5', importedAt: 50,
      chunks: {
        canvas: { sha256: 'c'.repeat(64), noteIds: ['note-canvas'] },
        efforts: { sha256: 'e'.repeat(64), noteIds: ['note-local-effort'] },
      },
    });
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('seed-core')),
      seedVersion: 3, builtAt: 'b3', importedAt: 30, tier: 'community',
      claim: { owner: 'old', at: 1 },
      chunks: {
        efforts: { sha256: 'x'.repeat(64), noteIds: ['note-remote-effort'] },
        dashboards: { sha256: 'd'.repeat(64), noteIds: ['note-dashboards'] },
      },
    });

    expect(await adoptLegacyCoreRegistryCheckpoint({ storage })).toBe(true);
    const core = await storage.getSeedMeta(seedMetaKey('core'));
    // Invalidated so the next core sync revalidates every folded record —
    // but the version survives: returning users stay offline-ready.
    expect(core).toMatchObject({ seedVersion: 5, builtAt: '', claim: null });
    // Core's own memberships survive; the registry's chunks fold in — a
    // chunk both own unions its note ids so neither build's rows lose ownership.
    expect(core!.chunks.canvas).toEqual({ sha256: 'c'.repeat(64), noteIds: ['note-canvas'] });
    expect(core!.chunks.efforts!.noteIds).toEqual(['note-local-effort', 'note-remote-effort']);
    expect(core!.chunks.dashboards).toEqual({ sha256: 'd'.repeat(64), noteIds: ['note-dashboards'] });
    // The legacy checkpoint is blanked — ownership lives in exactly one record.
    const legacy = await storage.getSeedMeta(seedMetaKey('seed-core'));
    expect(legacy).toMatchObject({ seedVersion: 0, builtAt: '', chunks: {}, claim: null });
  });

  it('is idempotent: a blanked legacy record is skipped and core is never clobbered', async () => {
    const storage = new InMemoryFeedStorage();
    const core = {
      ...emptySeedMeta(seedMetaKey('core')),
      seedVersion: 7, builtAt: 'b7', importedAt: 70,
      chunks: { canvas: { sha256: 'c'.repeat(64), noteIds: ['note-canvas'] } },
    };
    await storage.putSeedMeta(core);
    await storage.putSeedMeta(emptySeedMeta(seedMetaKey('seed-core')));

    expect(await adoptLegacyCoreRegistryCheckpoint({ storage })).toBe(false);
    expect(await storage.getSeedMeta(seedMetaKey('core'))).toEqual(core);
  });

  it('upgrades a partial legacy import: version 0 with nonblank chunks/claim, optional noteIds tolerated', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('core')),
      seedVersion: 4, builtAt: 'b4', importedAt: 40,
      // Older checkpoints may omit noteIds on their memberships.
      chunks: { canvas: { sha256: 'c'.repeat(64) }, efforts: { sha256: 'e'.repeat(64) } },
    });
    // A crashed sync left the retired registry at version 0 — but its
    // memberships and claim are real and must still fold.
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('seed-core')),
      claim: { owner: 'crashed', at: 1 },
      chunks: {
        efforts: { sha256: 'x'.repeat(64) },
        equipment: { sha256: 'q'.repeat(64) },
        dashboards: { sha256: 'd'.repeat(64), noteIds: ['note-dashboards'] },
      },
    });

    expect(await adoptLegacyCoreRegistryCheckpoint({ storage })).toBe(true);
    const core = await storage.getSeedMeta(seedMetaKey('core'));
    expect(core).toMatchObject({ seedVersion: 4, builtAt: '', claim: null });
    // Memberships fold without throwing; a chunk both own unions to an
    // (empty) note id list; newly folded chunks normalize noteIds to [].
    expect(core!.chunks.canvas).toEqual({ sha256: 'c'.repeat(64) });
    expect(core!.chunks.efforts).toEqual({ sha256: 'e'.repeat(64), noteIds: [] });
    expect(core!.chunks.equipment).toEqual({ sha256: 'q'.repeat(64), noteIds: [] });
    expect(core!.chunks.dashboards).toEqual({ sha256: 'd'.repeat(64), noteIds: ['note-dashboards'] });
    expect((await storage.getSeedMeta(seedMetaKey('seed-core')))?.chunks).toEqual({});
    // Idempotent: the now-truly-blank record is skipped on the next boot.
    expect(await adoptLegacyCoreRegistryCheckpoint({ storage })).toBe(false);
  });

  it('skips a legacy record missing its chunks map without throwing', async () => {
    const storage = new InMemoryFeedStorage();
    const core = {
      ...emptySeedMeta(seedMetaKey('core')),
      seedVersion: 2, builtAt: 'b2', importedAt: 20,
      chunks: { canvas: { sha256: 'c'.repeat(64), noteIds: ['note-canvas'] } },
    };
    await storage.putSeedMeta(core);
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('seed-core')), chunks: undefined } as SeedMetaRecord);

    expect(await adoptLegacyCoreRegistryCheckpoint({ storage })).toBe(false);
    expect(await storage.getSeedMeta(seedMetaKey('core'))).toEqual(core);
  });

  it('the invalidated core checkpoint makes the next boot sync re-import core', async () => {
    const storage = new InMemoryFeedStorage();
    // Stored core matches the manifest's version AND builtAt — without the
    // migration this returning visit would decide 'current' and skip.
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('core')),
      seedVersion: 5, builtAt: new Date(5).toISOString(), importedAt: 50,
      chunks: { canvas: { sha256: 'c'.repeat(64), noteIds: ['note-canvas'] } },
    });
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('seed-core')),
      seedVersion: 2, builtAt: 'b2', importedAt: 20,
      chunks: { efforts: { sha256: 'x'.repeat(64), noteIds: ['note-efforts'] } },
    });
    expect(await adoptLegacyCoreRegistryCheckpoint({ storage })).toBe(true);

    const counting = new CountingFeedSource(fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 5, 'canvas'));
    expect(await runBootFeedSync({ sources: [spec(counting, 'core', 5)], storage, isEnabled: () => true })).toBe('imported');
    // Two manifest reads: the boot decision probe, then the importer's own fetch.
    expect(counting.fetchManifestCalls).toBe(2);
    const core = await storage.getSeedMeta(seedMetaKey('core'));
    expect(core?.seedVersion).toBe(5);
    expect(core?.builtAt).toBe(new Date(5).toISOString());
    expect(core?.chunks.canvas).toBeTruthy();
    // The retired registry is no source — only the migration touched its record.
    expect((await storage.getSeedMeta(seedMetaKey('seed-core')))?.seedVersion).toBe(0);
  });

  it('repeated failed boot fetches leave the prior core version intact (offline-ready)', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('core')),
      seedVersion: 7, builtAt: new Date(7).toISOString(), importedAt: 70,
      chunks: { canvas: { sha256: 'c'.repeat(64), noteIds: ['note-canvas'] } },
    });
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('seed-core')),
      seedVersion: 3, builtAt: 'b3', importedAt: 30,
      chunks: { efforts: { sha256: 'x'.repeat(64), noteIds: ['note-efforts'] } },
    });
    const offline: IFeedSource = {
      fetchManifest: () => Promise.reject(new Error('offline')),
      fetchChunk: () => Promise.resolve([]),
    };
    for (let i = 0; i < 2; i++) {
      expect(await runBootFeedSync({ sources: [spec(offline, 'core', 7)], storage, isEnabled: () => true })).toBe('error');
    }
    const core = await storage.getSeedMeta(seedMetaKey('core'));
    // Still offline-ready: the imported verdict (version) survives repeated
    // failed boots; only the revalidation trigger (builtAt/claim) changed.
    expect(core?.seedVersion).toBe(7);
    expect(core?.claim ?? null).toBeNull();
    expect(core?.chunks.canvas).toEqual({ sha256: 'c'.repeat(64), noteIds: ['note-canvas'] });
    // The fold landed once; the legacy record stays blank across retries.
    expect(core?.chunks.efforts?.noteIds).toEqual(['note-efforts']);
    expect((await storage.getSeedMeta(seedMetaKey('seed-core')))?.seedVersion).toBe(0);
  });
});
