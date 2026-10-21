import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { SEED_SCHEMA, emptySeedMeta, seedMetaKey } from '@/types/seed';
import { InMemorySeedStorage, type SeedChunkWrite, type SeedChunkResult } from './SeedImportStorage';
import { CountingSeedSource, InMemorySeedSource } from './InMemorySeedSource';
import { seedFixture as fixture } from './seedFixture';
import { adoptLegacySeedCheckpoints, runSeedSync, readSeedCoverage, readSeedStatus, syncSeedSource, SEED_IMPORT_FLAG, isSeedImportEnabled, type SeedSourceSpec, type SeedSyncProgress } from './seedSync';
import type { ISeedSource } from './ISeedSource';

function spec(source: ISeedSource, id = 'core', embeddedVersion = 0): SeedSourceSpec { return { source, id, label: id, url: `https://seed.test/${id}/`, embeddedVersion }; }
const source = () => fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');

describe('seed sync orchestration', () => {
  it('disabled sync never fetches', async () => {
    const counting = new CountingSeedSource(source());
    expect(await runSeedSync({ sources: [spec(counting)], storage: new InMemorySeedStorage(), isEnabled: () => false })).toBe('disabled');
    expect(counting.fetchManifestCalls).toBe(0);
  });
  it('current embedded version skips fetch, other sources remain independently scoped', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1 });
    const counting = new CountingSeedSource(source());
    expect(await runSeedSync({ sources: [spec(counting, 'core', 1)], storage, isEnabled: () => true })).toBe('current');
    expect(counting.fetchManifestCalls).toBe(0);
    expect(await syncSeedSource('community', { sources: [spec(source(), 'core'), spec(source(), 'community')], storage, isEnabled: () => true })).toBe('imported');
    expect((await storage.getSeedMeta(seedMetaKey('community')))?.seedVersion).toBe(1);
  });
  it('refuses incompatible checkpoints without migration', async () => {
    const storage = new InMemorySeedStorage();
    const old = { ...emptySeedMeta(seedMetaKey('core')), schema: SEED_SCHEMA - 1, seedVersion: 1 };
    await storage.putSeedMeta(old);
    expect(await runSeedSync({ sources: [spec(source())], storage, isEnabled: () => true })).toBe('error');
    expect(await storage.getSeedMeta(old.key)).toEqual(old);
  });
  it('fresh competing claim reports busy and preserves its owner', async () => {
    const storage = new InMemorySeedStorage();
    const meta = { ...emptySeedMeta(seedMetaKey('core')), claim: { owner: 'other', at: 50 } };
    await storage.putSeedMeta(meta);
    expect(await runSeedSync({ sources: [spec(source())], storage, isEnabled: () => true, now: () => 100, owner: 'mine' })).toBe('busy');
    expect(await storage.getSeedMeta(meta.key)).toEqual(meta);
  });
  it('releases its claim on failed chunk and publishes only committed progress', async () => {
    class FailingStorage extends InMemorySeedStorage {
      async applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult> {
        if (write.chunkId === 'collection.beta') throw new Error('beta failed');
        return super.applyChunk(write);
      }
    }
    const a = compileSeedRow('markdown/canvas/a.md', '# A');
    const b = compileSeedRow('markdown/collections/beta/b.md', '# B');
    const src = new InMemorySeedSource({ schema: SEED_SCHEMA, version: 1, builtAt: new Date(1).toISOString(), chunks: [
      { id: 'canvas', path: 'chunks/canvas.json', sha256: 'a'.repeat(64), bytes: 1, count: 1 },
      { id: 'collection.beta', path: 'chunks/beta.json', sha256: 'b'.repeat(64), bytes: 1, count: 1 },
    ] }, { 'chunks/canvas.json': [a], 'chunks/beta.json': [b] });
    const storage = new FailingStorage(), progress: SeedSyncProgress[] = [];
    expect(await runSeedSync({ sources: [spec(src)], storage, isEnabled: () => true, onProgress: (p) => progress.push(p) })).toBe('error');
    const checkpoint = await storage.getSeedMeta(seedMetaKey('core'));
    expect(Object.keys(checkpoint!.chunks)).toEqual(['canvas']);
    expect(checkpoint!.claim).toBeNull();
    expect(progress.filter((p): p is SeedSyncProgress & { chunkId: string | null } => p.phase === 'committed').map((p) => p.chunkId)).toEqual(['canvas']);
    expect(await storage.storageInstance.readonly('notes').count()).toBe(1);
  });
  it('coverage needs no remote read and default flag can be disabled', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1 });
    expect(await readSeedCoverage({ storage, sources: [spec(source())] })).toEqual({ coreImported: true, libraryImported: false });
    localStorage.removeItem(SEED_IMPORT_FLAG);
    expect(isSeedImportEnabled()).toBe(true);
    localStorage.setItem(SEED_IMPORT_FLAG, '0');
    expect(isSeedImportEnabled()).toBe(false);
    localStorage.removeItem(SEED_IMPORT_FLAG);
  });
});

describe('seed-level identity', () => {
  const games = compileSeedRow('markdown/collections/crossfit-games/g.md', '# Games');
  const heroes = compileSeedRow('markdown/collections/crossfit-heroes/h.md', '# Heroes');
  /** One seed publishing TWO notebooks — the case the seed unit exists for. */
  const twoNotebookSeed = () => {
    const chunks = [
      { id: 'collection.crossfit-games', rows: [games] },
      { id: 'collection.crossfit-heroes', rows: [heroes] },
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
    return new InMemorySeedSource(
      { schema: SEED_SCHEMA, version: 3, builtAt: new Date(3).toISOString(), chunks: chunks.map((c) => c.entry) },
      Object.fromEntries(chunks.map((c) => [c.entry.path, c.rows])),
    );
  };

  it('stamps the source tier on the checkpoint, so the built-in corpus keeps its precedence', async () => {
    const storage = new InMemorySeedStorage();
    const sources = [{ ...spec(twoNotebookSeed(), 'seed-crossfit'), tier: 'community' as const }];
    expect(await runSeedSync({ sources, storage, isEnabled: () => true })).toBe('imported');
    const meta = await storage.getSeedMeta(seedMetaKey('seed-crossfit'));
    expect(meta?.tier).toBe('community');
    expect(Object.keys(meta!.chunks).sort()).toEqual(['collection.crossfit-games', 'collection.crossfit-heroes']);
  });

  it('one Subscribe applies every notebook the seed publishes', async () => {
    const storage = new InMemorySeedStorage();
    const sources = [spec(twoNotebookSeed(), 'seed-crossfit')];
    expect(await syncSeedSource('seed-crossfit', { sources, storage, isEnabled: () => true })).toBe('imported');
    const status = await readSeedStatus({ sources, storage, now: () => 7 });
    expect(status.sources[0]!.notebooks.map((n) => ({ label: n.label, chunkId: n.chunkId, imported: n.imported }))).toEqual([
      { label: 'CrossFit Games', chunkId: 'collection.crossfit-games', imported: true },
      { label: 'CrossFit Heroes', chunkId: 'collection.crossfit-heroes', imported: true },
    ]);
    expect(status.sources[0]!.count).toBe(2);
  });

  it('names the notebooks from the registry when the manifest is unreachable', async () => {
    const storage = new InMemorySeedStorage();
    const offline: ISeedSource = {
      fetchManifest: () => Promise.reject(new Error('offline')),
      fetchChunk: () => Promise.resolve([]),
    };
    const status = await readSeedStatus({ sources: [spec(offline, 'seed-crossfit')], storage });
    expect(status.sources[0]!.remote).toBeNull();
    expect(status.sources[0]!.notebooks.map((n) => n.chunkId)).toEqual([
      'collection.crossfit-games',
      'collection.crossfit-girls',
      'collection.crossfit-heroes',
      'feed.crossfit-programming',
    ]);
    expect(status.sources[0]!.notebooks.every((n) => !n.imported)).toBe(true);
  });
});

describe('legacy checkpoint adoption', () => {
  it('folds pre-seed-unit per-notebook checkpoints into the seed checkpoint once', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('community-crossfit-games')),
      seedVersion: 4, builtAt: 'b4', importedAt: 40, tier: 'community',
      chunks: { 'collection.crossfit-games': { sha256: 'a'.repeat(64), noteIds: ['note-games'] } },
    });
    await storage.putSeedMeta({
      ...emptySeedMeta(seedMetaKey('community-crossfit-heroes')),
      seedVersion: 7, builtAt: 'b7', importedAt: 70,
      chunks: { 'collection.crossfit-heroes': { sha256: 'b'.repeat(64), noteIds: ['note-heroes'] } },
    });

    expect(await adoptLegacySeedCheckpoints({ storage })).toBe(1);
    const merged = await storage.getSeedMeta(seedMetaKey('seed-crossfit'));
    expect(merged).toMatchObject({ seedVersion: 7, builtAt: 'b7', importedAt: 70, tier: 'community' });
    expect(merged!.chunks['collection.crossfit-games'].noteIds).toEqual(['note-games']);
    expect(merged!.chunks['collection.crossfit-heroes'].noteIds).toEqual(['note-heroes']);
    // Ownership lives in exactly one record after the fold.
    expect((await storage.getSeedMeta(seedMetaKey('community-crossfit-games')))?.chunks).toEqual({});
    expect((await storage.getSeedMeta(seedMetaKey('community-crossfit-heroes')))?.seedVersion).toBe(0);
    // Idempotent: the seed checkpoint now exists and is never clobbered.
    expect(await adoptLegacySeedCheckpoints({ storage })).toBe(0);
    expect((await storage.getSeedMeta(seedMetaKey('seed-crossfit')))?.seedVersion).toBe(7);
  });

  it('adopts nothing when no seed has legacy rows', async () => {
    expect(await adoptLegacySeedCheckpoints({ storage: new InMemorySeedStorage() })).toBe(0);
  });
});
