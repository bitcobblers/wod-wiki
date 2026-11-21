import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { libsqlDatabase, SqlStorage } from '@bitcobblers/wod-wiki-storage/sql';
import type { Note, Session } from '@bitcobblers/wod-wiki-storage';
import {
  MemoryFeedTree,
  SEED_SCHEMA,
  applySeedChunk,
  assertNotebookIndex,
  assertSeedManifest,
  cloneRemoteRecord,
  compileSeedRowFromMarkdown,
  emptySeedMeta,
  makeNotebookLinkId,
  materializeCachedRemoteRecord,
  previewRemoteRecord,
  reconcileRemovedFeedRecords,
  removeFeedNotebookContent,
  removeSeedSourceContent,
  seedMetaKey,
  seedNoteId,
  type SeedManifest,
  type SeedMetaRecord,
  type SeedRecordRef,
  type SeedRow,
} from '../../src/index';

function createRealStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

describe('index-first feed contract, lazy .md compilation, session pinning, and clone provenance', () => {
  it('validates distributed index-first manifests without chunks/*.json or strict schema === 9', () => {
    const manifest = assertSeedManifest({
      name: 'Community Kettlebells',
      schema: 10,
      version: 42,
      builtAt: '2026-11-21T00:00:00.000Z',
      indexBytes: 1200,
      chunkBytes: 0,
      chunks: [],
      notebooks: [
        {
          notebookId: 'notebook.kb-classics',
          label: 'KB Classics',
          indexPath: 'indexes/notebooks/notebook.kb-classics.json',
          version: 42,
          commit: 'abc1234',
          builtAt: '2026-11-21T00:00:00.000Z',
          sha256: 'e'.repeat(64),
          bytes: 1200,
          indexBytes: 1200,
          count: 2,
        },
      ],
    });
    expect(manifest.schema).toBe(10);
    expect(manifest.chunks).toEqual([]);
    expect(manifest.notebooks).toHaveLength(1);
    expect(manifest.notebooks![0]!.indexBytes).toBe(1200);

    // Rejects chunk-only manifest missing chunks array, invalid schema, or inline records on notebooks
    expect(() =>
      assertSeedManifest({
        schema: 9,
        version: 1,
        builtAt: '2026-11-21T00:00:00.000Z',
      }),
    ).toThrow(/shape validation/);

    expect(() =>
      assertSeedManifest({
        schema: 10,
        version: 1,
        builtAt: '2026-11-21T00:00:00.000Z',
        chunks: [],
        notebooks: [
          {
            notebookId: 'notebook.bad',
            label: 'Bad',
            indexPath: 'indexes/notebooks/notebook.bad.json',
            count: 1,
            records: [],
          },
        ],
      }),
    ).toThrow(/inline records/);

    // Accepts NotebookIndex with raw .md / rawUrl records without precompiled recordPath
    const idx = assertNotebookIndex({
      notebookId: 'notebook.kb-classics',
      label: 'KB Classics',
      indexPath: 'indexes/notebooks/notebook.kb-classics.json',
      version: 42,
      commit: 'abc1234',
      builtAt: '2026-11-21T00:00:00.000Z',
      sha256: 'e'.repeat(64),
      bytes: 1200,
      count: 1,
      records: [
        {
          uuid: '01950000-0000-7000-8000-000000000101',
          path: 'markdown/notebooks/kb-classics/armor-building.md',
          rawUrl: 'raw/armor-building.md',
          commit: 'abc1234',
          version: 42,
          sha256: 'f'.repeat(64),
          title: 'Armor Building Complex',
        },
      ],
    });
    expect(idx.records[0]!.rawUrl).toBe('raw/armor-building.md');
    expect(idx.records[0]!.recordPath).toBeUndefined();
  });

  it('lazily compiles raw .md remote records (including 404 recordPath fallback) and caches cleanly under canonical uuid', async () => {
    const md = [
      '---',
      'title: Armor Building Complex',
      'date: 2026-11-01',
      '---',
      '',
      '# Armor Building Complex',
      '',
      '```time',
      '5:00 AMRAP',
      '  10 Burpees',
      '  200m Rowing',
      '```',
      '',
    ].join('\n');

    const tree = new MemoryFeedTree({
      'raw/armor-building.md': md,
    });
    const ref: SeedRecordRef = {
      uuid: '01950000-0000-7000-8000-000000000201',
      path: 'markdown/notebooks/kb/armor-building.md',
      recordPath: 'records/missing-not-published.json',
      rawUrl: 'raw/armor-building.md',
      commit: 'deadbeef',
      version: 7,
      sha256: '1'.repeat(64),
      title: 'Armor Building Complex',
      date: Date.parse('2026-11-01T00:00:00.000Z'),
    };

    const row = await previewRemoteRecord(tree, ref);
    expect(row.uuid).toBe(ref.uuid);
    expect(row.content).toBe(md);
    expect(Object.keys(row.blocks).length).toBeGreaterThan(0);
    expect(row.blockIndex.length).toBeGreaterThan(0);
    expect(row.blockEfforts.length).toBeGreaterThan(0);

    const storage = createRealStorage();
    const cached = await materializeCachedRemoteRecord(storage, {
      feedId: 'kb-feed',
      notebookSlug: 'kb',
      record: ref,
      seedRow: row,
    });
    expect(cached.id).toBe(ref.uuid);
    expect(cached.retention).toBe('cached');
    expect(cached.upstreamStatus).toBe('live');
    expect(cached.feedSourceId).toBe('kb-feed');

    // Never overwrites user-owned or session-pinned copies
    const userNote: Note = {
      id: ref.uuid,
      title: 'My Custom ABC',
      rawContent: '# Custom',
      sourceRevision: 3,
      blocks: {},
      createdAt: 100,
      seedOrigin: 'user',
    };
    await storage.readwrite('notes').put(userNote);
    const preservedUser = await materializeCachedRemoteRecord(storage, {
      feedId: 'kb-feed',
      record: ref,
      seedRow: row,
    });
    expect(preservedUser.title).toBe('My Custom ABC');
    expect(preservedUser.seedOrigin).toBe('user');
  });

  it('protects session-pinned and sessions-attached notes on removeSeedSourceContent, vanish sweeps, and notebook unsubscribes', async () => {
    const storage = createRealStorage();
    const mkRow = async (path: string, md: string): Promise<{ row: SeedRow; noteId: string }> => {
      const noteId = await seedNoteId(path);
      const row = await compileSeedRowFromMarkdown({ path, markdown: md, uuid: noteId, version: 1, commit: 'c1' });
      return { row, noteId };
    };

    const { row: rPinned, noteId: pinnedId } = await mkRow(
      'markdown/notebooks/demo/pinned.md',
      '# Pinned\n\n```time\n5:00 AMRAP\n  Burpees\n```\n',
    );
    const { row: rWithSession, noteId: withSessionId } = await mkRow(
      'markdown/notebooks/demo/with-session.md',
      '# Session Attached\n\n```time\n10:00 For Time\n  100m Run\n```\n',
    );
    const { row: rEphemeral, noteId: ephemeralId } = await mkRow(
      'markdown/notebooks/demo/ephemeral.md',
      '# Ephemeral\n\n```time\n1:00 Plank\n```\n',
    );

    const m1: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: '2026-11-21T00:00:00.000Z',
      chunks: [{ id: 'notebook.demo', path: 'chunks/notebook.demo.json', sha256: 'a'.repeat(64), bytes: 10, count: 3 }],
    };
    const meta1: SeedMetaRecord = {
      ...emptySeedMeta(seedMetaKey('peer-feed')),
      schema: SEED_SCHEMA,
      seedVersion: 1,
      builtAt: m1.builtAt,
      importedAt: 100,
      chunks: {
        'notebook.demo': {
          sha256: 'a'.repeat(64),
          noteIds: [pinnedId, withSessionId, ephemeralId],
        },
      },
    };
    await applySeedChunk(storage, {
      chunkId: 'notebook.demo',
      rows: [rPinned, rWithSession, rEphemeral],
      manifest: m1,
      expectedMeta: undefined,
      meta: meta1,
    });

    // Pin the first note explicitly; attach a completed Session to the second note
    const storedPinned = (await storage.readonly('notes').get(pinnedId))!;
    await storage.readwrite('notes').put({
      ...storedPinned,
      retention: 'session-pinned',
    } as Note);

    const sessionRow: Session = {
      id: 'session-attached-1',
      noteId: withSessionId,
      blockId: Object.keys(rWithSession.blocks)[0]!,
      blockVersion: 1,
      status: 'completed',
      startTime: 1000,
      endTime: 1300,
      duration: 300_000,
      completed: true,
      createdAt: 1300,
    };
    await storage.readwrite('sessions').put(sessionRow);

    // 0. Re-importing updated upstream content preserves retention: 'session-pinned' and prior BlockRevision v1
    const { row: rPinnedUpdated } = await mkRow(
      'markdown/notebooks/demo/pinned.md',
      '# Pinned\n\n```time\n8:00 AMRAP\n  Burpees\n  Rowing\n```\n',
    );
    await applySeedChunk(storage, {
      chunkId: 'notebook.demo',
      rows: [rPinnedUpdated, rWithSession, rEphemeral],
      manifest: { ...m1, version: 10 },
      expectedMeta: meta1,
      meta: {
        ...meta1,
        seedVersion: 10,
        chunks: {
          'notebook.demo': {
            sha256: 'c'.repeat(64),
            noteIds: [pinnedId, withSessionId, ephemeralId],
          },
        },
      },
    });
    const pinnedAfterUpdate = (await storage.readonly('notes').get(pinnedId)) as Note & {
      retention?: string;
      upstreamStatus?: string;
    };
    expect(pinnedAfterUpdate.retention).toBe('session-pinned');
    expect(pinnedAfterUpdate.upstreamStatus).toBe('live');
    const pinnedRevs = await storage.readonly('block_revisions').getAllFromIndex('by-note', pinnedId);
    expect(pinnedRevs.some((r) => r.version === 1)).toBe(true);
    expect(pinnedRevs.some((r) => r.version === 2)).toBe(true);

    // 1. Vanished-chunk sweep removes rEphemeral, keeps rPinned & rWithSession with upstreamStatus: 'removed'
    const currentMetaBeforeSweep = (await storage.readonly('meta').get(seedMetaKey('peer-feed'))) as SeedMetaRecord;
    const meta2: SeedMetaRecord = {
      ...currentMetaBeforeSweep,
      seedVersion: 11,
      chunks: {
        'notebook.demo': { sha256: 'b'.repeat(64), noteIds: [] },
      },
    };
    const sweepRes = await applySeedChunk(storage, {
      chunkId: 'notebook.demo',
      rows: [],
      manifest: { ...m1, version: 11 },
      expectedMeta: currentMetaBeforeSweep,
      meta: meta2,
    });
    expect(sweepRes.deleted).toBe(1);
    expect(sweepRes.preservedPinned).toBe(2);
    expect(await storage.readonly('notes').get(ephemeralId)).toBeUndefined();

    const pinnedAfterSweep = (await storage.readonly('notes').get(pinnedId)) as Note & {
      retention?: string;
      upstreamStatus?: string;
    };
    const sessionAfterSweep = (await storage.readonly('notes').get(withSessionId)) as Note & {
      retention?: string;
      upstreamStatus?: string;
    };
    expect(pinnedAfterSweep.upstreamStatus).toBe('removed');
    expect(sessionAfterSweep.retention).toBe('session-pinned');
    expect(sessionAfterSweep.upstreamStatus).toBe('removed');
    expect((await storage.readonly('block_revisions').getAllFromIndex('by-note', withSessionId)).length).toBeGreaterThan(0);
    expect((await storage.readonly('block_index').getAllFromIndex('by-note', withSessionId)).length).toBeGreaterThan(0);

    // 2. Unsubscribe (removeSeedSourceContent) preserves session-pinned notes and stamps upstreamStatus: 'unsubscribed'
    const { row: rUncachedEphemeral, noteId: uncachedId } = await mkRow(
      'markdown/notebooks/demo/extra.md',
      '# Extra\n',
    );
    await materializeCachedRemoteRecord(storage, {
      feedId: 'peer-feed',
      notebookSlug: 'demo',
      seedRow: rUncachedEphemeral,
    });
    const unsubRes = await removeSeedSourceContent(storage, meta2);
    expect(unsubRes.deleted).toBe(1);
    expect(unsubRes.preservedPinned).toBe(2);
    expect(await storage.readonly('notes').get(uncachedId)).toBeUndefined();
    const sessionAfterUnsub = (await storage.readonly('notes').get(withSessionId)) as Note & {
      retention?: string;
      upstreamStatus?: string;
    };
    expect(sessionAfterUnsub.retention).toBe('session-pinned');
    expect(sessionAfterUnsub.upstreamStatus).toBe('unsubscribed');

    // 3. Index-only removeFeedNotebookContent & reconcileRemovedFeedRecords also preserve pinned/sessions copies
    const { row: cachedOnly } = await mkRow(
      'markdown/notebooks/demo/cached-only.md',
      '# Cached Only\n',
    );
    await materializeCachedRemoteRecord(storage, {
      feedId: 'peer-feed',
      notebookSlug: 'demo',
      seedRow: cachedOnly,
    });
    const reconciled = await reconcileRemovedFeedRecords(
      storage,
      'peer-feed',
      'notebook.demo',
      new Set([pinnedId]),
    );
    expect(reconciled.deleted).toBe(1);
    expect(reconciled.preservedPinned).toBe(1);

    const nbRemoved = await removeFeedNotebookContent(storage, 'peer-feed', 'notebook.demo');
    expect(nbRemoved.preservedPinned).toBe(2);
  });

  it('cloneRemoteRecord rejects read-only system notebooks, stamps structured provenance, and writes notebook_links', async () => {
    const storage = createRealStorage();
    const md = '# Murph\n\n```time\nFor Time\n  1 Mile Run\n  100 Pull-ups\n```\n';
    const row = await compileSeedRowFromMarkdown({
      path: 'markdown/notebooks/hero-wods/murph.md',
      markdown: md,
      uuid: '01950000-0000-7000-8000-000000000401',
      version: 9,
      commit: 'commit999',
    });
    const reader = new MemoryFeedTree({
      'records/murph.json': JSON.stringify(row),
    });
    const ref: SeedRecordRef = {
      uuid: row.uuid!,
      path: row.path,
      recordPath: 'records/murph.json',
      commit: 'commit999',
      version: 9,
      sha256: 'c'.repeat(64),
      title: 'Murph',
    };

    // System read-only notebooks must reject cleanly
    for (const roTarget of [
      'notebook/defaults',
      'notebook/guides',
      'notebook/efforts',
      'notebook/equipment',
      'notebook/dashboards',
    ]) {
      await expect(
        cloneRemoteRecord(storage, reader, {
          feedId: 'hero-feed',
          record: ref,
          targetNotebookId: roTarget,
        }),
      ).rejects.toThrow(/read-only/i);
    }

    // Valid target notebook stamps structured NoteProvenance and writes notebook_links row
    const cloned = await cloneRemoteRecord(storage, reader, {
      feedId: 'hero-feed',
      record: ref,
      targetNotebookId: 'notebook/my-training',
    });
    expect(cloned.notebookId).toBe('notebook/my-training');
    expect(cloned.seedOrigin).toBe('user');
    expect(cloned.provenance).toMatchObject({
      sourceNoteId: ref.uuid,
      sourceVersion: 9,
      sourceCommit: 'commit999',
      feedSourceId: 'hero-feed',
      sourceNotebookId: 'notebook/hero-wods',
      sourcePath: row.path,
    });
    expect(typeof cloned.provenance?.clonedAt).toBe('number');

    const link = await storage.readonly('notebook_links').get(
      makeNotebookLinkId('notebook/my-training', 'note', cloned.id),
    );
    expect(link).toBeTruthy();
    expect(link?.noteId).toBe(cloned.id);
    expect(link?.notebookId).toBe('notebook/my-training');
  });
});
