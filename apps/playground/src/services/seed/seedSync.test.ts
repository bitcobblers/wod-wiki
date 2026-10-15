import { describe, expect, it } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { SEED_SCHEMA, emptySeedMeta, seedMetaKey } from '@/types/seed';
import { InMemorySeedStorage, type SeedChunkWrite, type SeedChunkResult } from './SeedImportStorage';
import { CountingSeedSource, InMemorySeedSource } from './InMemorySeedSource';
import { seedFixture as fixture } from './seedFixture';
import { runSeedSync, readSeedCoverage, syncSeedSource, SEED_IMPORT_FLAG, isSeedImportEnabled, type SeedSourceSpec, type SeedSyncProgress } from './seedSync';
import type { ISeedSource } from './ISeedSource';

function spec(source: ISeedSource, id = 'core', embeddedVersion = 0): SeedSourceSpec { return { source, id, label: id, embeddedVersion }; }
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
    expect(progress.filter((p) => p.phase === 'committed').map((p) => p.chunkId)).toEqual(['canvas']);
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
