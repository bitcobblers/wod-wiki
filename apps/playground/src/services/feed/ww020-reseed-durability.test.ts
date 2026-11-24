import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { runSourceSyncCore } from './feedSyncCore';
import type { IFeedSource } from './IFeedSource';
import { SEED_SCHEMA, seedMetaKey, type SeedManifest } from '@/types/seed';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('WW-020 — Feed checkpoint stability & user-write durability across reseeds', () => {
  it('does not treat virtual manifest.notebooks chunks as vanished on subsequent boots', async () => {
    const storage = new InMemoryFeedStorage();
    const canvasRows = [compileSeedRow('markdown/canvas/a.md', '# A')];
    const nbIndex = {
      schema: 1,
      notebookId: 'notebook.custom-index-only',
      label: 'Custom Index Only',
      indexPath: 'indexes/custom-index-only.json',
      version: 1,
      commit: 'abc1234',
      builtAt: '2026-11-23T00:00:00Z',
      sha256: sha('nb-index'),
      bytes: 0,
      count: 0,
      records: [],
    };
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 100,
      builtAt: '2026-11-23T00:00:00Z',
      commit: 'abc1234',
      chunks: [
        {
          id: 'canvas',
          path: 'chunks/canvas.json',
          sha256: sha(JSON.stringify(canvasRows)),
          bytes: JSON.stringify(canvasRows).length,
          count: canvasRows.length,
        },
      ],
      notebooks: [
        {
          notebookId: 'notebook.custom-index-only',
          label: 'Custom Index Only',
          indexPath: 'indexes/custom-index-only.json',
          sha256: nbIndex.sha256,
          version: 1,
          commit: 'abc1234',
          builtAt: '2026-11-23T00:00:00Z',
          bytes: JSON.stringify(nbIndex).length,
          count: 0,
        },
      ],
    };

    const source: IFeedSource = {
      fetchManifest: async () => manifest,
      fetchChunk: async (path) => (path === 'chunks/canvas.json' ? canvasRows : nbIndex),
    };

    // First boot imports and records both canvas + virtual notebook chunk in meta.chunks.
    const first = await runSourceSyncCore(
      {
        id: 'core',
        label: 'Core',
        source,
        embeddedVersion: 100,
        autoSyncOn: true,
        offlinePolicy: 'offline-full',
      },
      { storage, owner: 'boot-1', now: () => 1_000, probeManifests: true, background: false },
    );
    expect(first.outcome).toBe('imported');
    const metaAfterFirst = await storage.getSeedMeta(seedMetaKey('core'));
    expect(metaAfterFirst?.seedVersion).toBe(100);
    expect(metaAfterFirst?.builtAt).toBe('2026-11-23T00:00:00Z');
    expect(metaAfterFirst?.claim).toBeNull();
    expect(metaAfterFirst?.chunks['notebook.custom-index-only']).toBeDefined();

    const applyCountBeforeSecond = storage.applyCount;

    // Second cold boot with probeManifests=true must see outcome='current' and 0 chunk re-applies.
    const second = await runSourceSyncCore(
      {
        id: 'core',
        label: 'Core',
        source,
        embeddedVersion: 100,
        autoSyncOn: true,
        offlinePolicy: 'offline-full',
      },
      { storage, owner: 'boot-2', now: () => 2_000, probeManifests: true, background: true },
    );
    expect(second.outcome).toBe('current');
    expect(storage.applyCount).toBe(applyCountBeforeSecond);
  });

  it('preserves user-authored notes, custom efforts, and user scoped overrides across forced reseeds', async () => {
    const storage = new InMemoryFeedStorage();
    const rawStorage = storage.storageInstance;

    await rawStorage.transaction(['notes', 'efforts', 'property_overrides'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        id: 'user-note-1',
        title: 'My Custom Journal',
        rawContent: '# My Custom Journal\n\nRecovery session notes.\n',
        sourceRevision: 1,
        blocks: {},
        createdAt: 1_000,
        type: 'journal',
        seedOrigin: 'user',
      });
      await tx.readwrite('efforts').put({
        id: 'effort-user-1',
        slug: 'my-custom-lift',
        label: 'My Custom Lift',
        aliases: [],
        baseAttributes: { met: 6.0 },
        registrySource: 'user',
        ownerNoteId: 'effort/my-custom-lift',
        sourceId: 'user:efforts',
        sourcePath: 'effort/my-custom-lift',
        createdAt: '2026-11-23T00:00:00Z',
        updatedAt: '2026-11-23T00:00:00Z',
      });
      await tx.readwrite('property_overrides').put({
        id: 'notebook/custom::effort::back-squat',
        notebookId: 'notebook/custom',
        kind: 'effort',
        slug: 'back-squat',
        label: 'My Back Squat Override',
        ownerNoteId: 'effort/back-squat',
        rawContent: '# Back Squat',
        payload: { slug: 'back-squat', label: 'My Back Squat Override' },
        seedOrigin: 'user',
        updatedAt: 1_000,
      });
    });

    const canvasRows = [compileSeedRow('markdown/canvas/a.md', '# A')];
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 200,
      builtAt: '2026-11-23T01:00:00Z',
      commit: 'def4567',
      chunks: [
        {
          id: 'canvas',
          path: 'chunks/canvas.json',
          sha256: sha(JSON.stringify(canvasRows)),
          bytes: JSON.stringify(canvasRows).length,
          count: canvasRows.length,
        },
      ],
    };
    const source: IFeedSource = {
      fetchManifest: async () => manifest,
      fetchChunk: async () => canvasRows,
    };

    const res = await runSourceSyncCore(
      {
        id: 'core',
        label: 'Core',
        source,
        embeddedVersion: 200,
        autoSyncOn: true,
        offlinePolicy: 'offline-full',
      },
      { storage, owner: 'reseed-1', now: () => 5_000, force: true, background: false },
    );
    expect(res.outcome).toBe('imported');

    expect((await rawStorage.readonly('notes').get('user-note-1'))?.title).toBe('My Custom Journal');
    expect((await rawStorage.readonly('efforts').get('my-custom-lift'))?.registrySource).toBe('user');
    expect((await rawStorage.readonly('property_overrides').get('notebook/custom::effort::back-squat'))?.seedOrigin).toBe('user');
  });
});
