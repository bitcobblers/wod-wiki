/**
 * SeedImporter tests — ownership rules, checkpointing, idempotency, and
 * crash resume, on the InMemory adapters (no IndexedDB globals).
 * Contract: docs/prototypes/seed-data-unification.md § Ownership rules.
 */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { SeedManifest, SeedRow } from '@/types/seed';
import { EFFORTS_CHUNK_ID, emptySeedMeta, SEED_SCHEMA, seedMetaKey, seedSegmentId } from '@/types/seed';

const META_KEY = seedMetaKey('core');
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import { effortToDocument } from '@/repositories/effort-markdown';
import { CountingSeedSource, InMemorySeedSource } from './InMemorySeedSource';
import { InMemorySeedStorage, type SeedChunkWrite } from './SeedImportStorage';
import { seedNoteId, SeedImporter } from './SeedImporter';

const shaOf = (rows: SeedRow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

const row = (path: string, content = `content of ${path}`): SeedRow => ({ path, content });

const effortDoc = (slug: string): SeedRow => ({
  path: `markdown/efforts/${slug}.md`,
  content: effortToDocument({
    id: `effort-bundled-${slug}`,
    slug,
    label: slug,
    aliases: [],
    baseAttributes: { met: 5 },
    registrySource: 'bundled',
  } as IEffort),
});

function makeSource(chunks: Record<string, SeedRow[]>, version: number) {
  const manifest: SeedManifest = {
    schema: 2,
    version,
    builtAt: new Date(version).toISOString(),
    chunks: Object.keys(chunks)
      .sort()
      .map((id) => ({
        id,
        path: `chunks/${id}.json`,
        sha256: shaOf(chunks[id]!),
        bytes: JSON.stringify(chunks[id]).length,
        count: chunks[id]!.length,
      })),
  };
  const paths = Object.fromEntries(
    Object.entries(chunks).map(([id, rows]) => [`chunks/${id}.json`, rows]),
  );
  return { source: new InMemorySeedSource(manifest, paths), manifest };
}

async function importAll(storage: InMemorySeedStorage, source: InMemorySeedSource) {
  const counting = new CountingSeedSource(source);
  const result = await new SeedImporter(storage, counting, 'core').applyAll();
  return { result, counting };
}

describe('SeedImporter', () => {
  it('fresh import materializes notes + segments + checkpoint with provenance', async () => {
    const { source } = makeSource(
      {
        canvas: [row('markdown/canvas/a.md', '# A')],
        'collection.girls': [row('markdown/collections/girls/fran.md'), row('markdown/collections/girls/annie.md')],
      },
      1000,
    );
    const storage = new InMemorySeedStorage();
    const { result, counting } = await importAll(storage, source);

    expect(result.status).toBe('imported');
    expect(result.appliedChunks).toBe(2);
    expect(result.totalNotes).toBe(3);
    expect(counting.fetchChunkCalls).toHaveLength(2);

    const franId = await seedNoteId('markdown/collections/girls/fran.md');
    const fran = storage.allNotes().find((n) => n.id === franId);
    expect(fran).toBeDefined();
    expect(fran!.seedOrigin).toBe('seed');
    expect(fran!.seedVersion).toBe(1000);
    expect(fran!.seedChunkId).toBe('collection.girls');
    expect(fran!.catalog).toBe('girls');
    expect(fran!.createdAt).toBe(1000);

    const canvasNoteId = await seedNoteId('markdown/canvas/a.md');
    const canvasNote = storage.allNotes().find((n) => n.id === canvasNoteId);
    expect(canvasNote!.catalog).toBeUndefined();

    const segment = storage.allSegments().find((s) => s.noteId === fran!.id);
    expect(segment).toMatchObject({
      id: seedSegmentId(fran!.id),
      version: 1,
      rawContent: 'content of markdown/collections/girls/fran.md',
      dataType: 'markdown',
    });

    const meta = await storage.getSeedMeta(META_KEY);
    expect(meta!.seedVersion).toBe(1000);
    expect(meta!.chunks['collection.girls']!.noteIds).toHaveLength(2);
  });

  it('seed note ids are deterministic for the same path', async () => {
    expect(await seedNoteId('markdown/canvas/a.md')).toBe(await seedNoteId('markdown/canvas/a.md'));
    expect(await seedNoteId('markdown/canvas/a.md')).not.toBe(await seedNoteId('markdown/canvas/b.md'));
  });

  it('stamps every imported note with its real non-journal source family', async () => {
    const dashboardDoc = `---\ndashboard: true\ntags:\n  - training\n---\n\n# Recovery Readiness\n`;
    const canvasRoutable = `---\ntemplate: canvas\nroute: /guide/syntax/basics\n---\n# Basics\n`;
    const canvasFragment = `---\ntitle: Fragment\nsection: guide\n---\nFragment body\n`;
    const { source } = makeSource(
      {
        'collection.girls': [row('markdown/collections/girls/README.md'), row('markdown/collections/girls/fran.md')],
        'feed.log': [row('markdown/feeds/log/2026-01-02/entry.md')],
        dashboards: [row('markdown/dashboards/recovery-readiness.md', dashboardDoc)],
        canvas: [
          row('markdown/canvas/guide/syntax/basics.md', canvasRoutable),
          row('markdown/canvas/guide/fragment.md', canvasFragment),
        ],
        template: [row('apps/playground/app/templates/new-playground.md')],
        [EFFORTS_CHUNK_ID]: [effortDoc('air-squat')],
      },
      1000,
    );
    const storage = new InMemorySeedStorage();
    const { result } = await importAll(storage, source);

    expect(result.status).toBe('imported');
    const byPath = async (p: string) => {
      const id = await seedNoteId(p);
      return storage.allNotes().find((n) => n.id === id)!;
    };

    expect((await byPath('markdown/collections/girls/README.md')).sourceId).toBe('collection:girls');
    expect((await byPath('markdown/collections/girls/fran.md')).sourceId).toBe('collection:girls/fran');
    expect((await byPath('markdown/feeds/log/2026-01-02/entry.md')).sourceId).toBe('feed:feeds/log/2026-01-02/entry');
    expect((await byPath('markdown/canvas/guide/syntax/basics.md')).sourceId).toBe('guides:guide/syntax/basics');
    expect((await byPath('markdown/canvas/guide/fragment.md')).sourceId).toBe('guides:guide/fragment');
    expect((await byPath('apps/playground/app/templates/new-playground.md')).sourceId).toBe('playground');
    expect((await byPath('markdown/efforts/air-squat.md')).sourceId).toBe('efforts');

    const dashboard = await byPath('markdown/dashboards/recovery-readiness.md');
    expect(dashboard.sourceId).toBe('dashboards');
    expect(dashboard.type).toBe('dashboard');
    expect(storage.getTagsForNote(dashboard.id)).toEqual(['training']);
    const segment = storage.allSegments().find((s) => s.noteId === dashboard.id);
    expect(segment!.rawContent).toBe(dashboardDoc);

    // The leak annotation-1 fixes: no imported note classifies as `journal`
    // (`!sourceId || sourceId === 'journal'`).
    for (const note of storage.allNotes()) {
      expect(!!note.sourceId && note.sourceId !== 'journal').toBe(true);
    }
  });

  it('extracts typed frontmatter tags and leaves rawContent unchanged', async () => {
    const sampleContent = `---
domain: crossfit
format: for-time
intent: benchmark
tags:
  - girl
search: hidden
template: canvas
---

# Fran
21-15-9 Thrusters, Pull-ups
`;
    const { source } = makeSource(
      {
        'collection.girls': [row('markdown/collections/girls/fran.md', sampleContent)],
      },
      1000,
    );
    const storage = new InMemorySeedStorage();
    await importAll(storage, source);

    const franId = await seedNoteId('markdown/collections/girls/fran.md');
    const tags = storage.getTagsForNote(franId);
    expect(tags).toEqual(['girl', 'crossfit', 'for-time', 'benchmark']);

    const segment = storage.allSegments().find((s) => s.noteId === franId);
    expect(segment).toBeDefined();
    expect(segment!.rawContent).toBe(sampleContent);
    expect(storage.getTagObjectsForNote(franId)).toEqual([
      { label: 'girl' },
      { label: 'crossfit', type: 'domain' },
      { label: 'for-time', type: 'format' },
      { label: 'benchmark', type: 'intent' },
    ]);
  });

  it('parses type property into tags typed as type during seed import', async () => {
    const sampleContent = `---
type: syntax
tags:
  - guide
---

# Guide
`;
    const { source } = makeSource(
      {
        canvas: [row('markdown/canvas/guide.md', sampleContent)],
      },
      1000,
    );
    const storage = new InMemorySeedStorage();
    await importAll(storage, source);

    const guideId = await seedNoteId('markdown/canvas/guide.md');
    const tagObjects = storage.getTagObjectsForNote(guideId);
    expect(tagObjects).toEqual([
      { label: 'guide' },
      { label: 'syntax', type: 'type' },
    ]);

    const segment = storage.allSegments().find((s) => s.noteId === guideId);
    expect(segment!.rawContent).toBe(sampleContent);
  });

  it('re-import of an unchanged manifest is a no-op with zero chunk fetches', async () => {
    const { source } = makeSource({ canvas: [row('markdown/canvas/a.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, source);

    const { result, counting } = await importAll(storage, source);
    expect(result.status).toBe('current');
    expect(counting.fetchChunkCalls).toHaveLength(0);
    expect(storage.allNotes()).toHaveLength(1);
  });

  it('a changed chunk is refetched; unchanged chunks are left alone', async () => {
    const v1 = makeSource({ canvas: [row('markdown/canvas/a.md')], efforts: [row('markdown/efforts/e.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    const v2 = makeSource({ canvas: [row('markdown/canvas/a.md', 'edited')], efforts: [row('markdown/efforts/e.md')] }, 2000);
    const { result, counting } = await importAll(storage, v2.source);

    expect(result.status).toBe('imported');
    expect(result.appliedChunks).toBe(1);
    expect(counting.fetchChunkCalls).toEqual(['chunks/canvas.json']);
    const editedId = await seedNoteId('markdown/canvas/a.md');
    const edited = storage.allNotes().find((n) => n.id === editedId);
    const segment = storage.allSegments().find((s) => s.noteId === edited!.id);
    expect(segment!.rawContent).toBe('edited');
    expect(edited!.seedVersion).toBe(2000);
    expect(storage.allNotes()).toHaveLength(2);
  });

  it('never touches a user-owned row — not overwrite, not delete', async () => {
    const v1 = makeSource({ canvas: [row('markdown/canvas/a.md'), row('markdown/canvas/b.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    // Simulate user edits: retitle A (stays in corpus), and B (will vanish).
    const noteAId = await seedNoteId('markdown/canvas/a.md');
    const noteBId = await seedNoteId('markdown/canvas/b.md');
    const noteA = storage.allNotes().find((n) => n.id === noteAId)!;
    const noteB = storage.allNotes().find((n) => n.id === noteBId)!;
    await storage.applyChunk({
      notes: [
        { ...noteA, title: 'My A', seedOrigin: 'user' },
        { ...noteB, title: 'My B', seedOrigin: 'user' },
      ],
      segments: [],
      efforts: [],
      deleteNoteIds: [],
      deleteEffortSlugs: [],
      blocks: [],
      blockEfforts: [],
      deleteBlockIds: [],
      deleteBlockEffortIds: [],
      meta: (await storage.getSeedMeta(META_KEY))!,
    });

    const v2 = makeSource({ canvas: [row('markdown/canvas/a.md', 'upstream edit')] }, 2000);
    const { result } = await importAll(storage, v2.source);

    expect(result.skippedUserOwned).toBe(1);
    const afterA = storage.allNotes().find((n) => n.id === noteA.id)!;
    expect(afterA.title).toBe('My A'); // not overwritten
    const afterB = storage.allNotes().find((n) => n.id === noteB.id)!;
    expect(afterB).toBeDefined(); // vanished from corpus, still not deleted
    expect(afterB.title).toBe('My B');
    expect(result.deleted).toBe(0);
    // The user-owned row is dropped from the checkpoint's owned set.
    expect((await storage.getSeedMeta(META_KEY))!.chunks['canvas']!.noteIds).toEqual([noteA.id]);
  });

  it('deletes vanished seed-origin rows (note + segment) and records it', async () => {
    const v1 = makeSource({ canvas: [row('markdown/canvas/a.md'), row('markdown/canvas/b.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);
    const noteBId = await seedNoteId('markdown/canvas/b.md');
    const noteB = storage.allNotes().find((n) => n.id === noteBId)!;

    const v2 = makeSource({ canvas: [row('markdown/canvas/a.md')] }, 2000);
    const { result } = await importAll(storage, v2.source);

    expect(result.deleted).toBe(1);
    expect(storage.allNotes().find((n) => n.id === noteB.id)).toBeUndefined();
    expect(storage.allSegments().find((s) => s.noteId === noteB.id)).toBeUndefined();
    expect((await storage.getSeedMeta(META_KEY))!.chunks['canvas']!.noteIds).toHaveLength(1);
  });

  it('resumes after a crash: already-applied chunk shas are skipped, version still advances', async () => {
    const v1 = makeSource({ 'collection.a': [row('markdown/collections/a/one.md')], 'collection.b': [row('markdown/collections/b/two.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    // Simulate a crash after chunk 'a' but before the final version bump.
    const meta = (await storage.getSeedMeta(META_KEY))!;
    meta.seedVersion = 0;
    await storage.putSeedMeta(meta);

    const v2 = makeSource({ 'collection.a': [row('markdown/collections/a/one.md')], 'collection.b': [row('markdown/collections/b/two.md', 'new')] }, 2000);
    const { result, counting } = await importAll(storage, v2.source);

    expect(result.status).toBe('imported');
    expect(counting.fetchChunkCalls).toEqual(['chunks/collection.b.json']);
    expect((await storage.getSeedMeta(META_KEY))!.seedVersion).toBe(2000);
  });

  it('efforts chunk materializes IEffort records with seed provenance', async () => {
    const { source } = makeSource(
      { [EFFORTS_CHUNK_ID]: [effortDoc('air-squat'), effortDoc('burpee')] },
      1000,
    );
    const storage = new InMemorySeedStorage();
    const { result } = await importAll(storage, source);

    expect(result.totalEfforts).toBe(2);
    const efforts = storage.allEfforts();
    expect(efforts).toHaveLength(2);
    for (const effort of efforts) {
      expect(effort.registrySource).toBe('bundled');
      expect(effort.id).toBe(`effort-bundled-${effort.slug}`);
    }
    // Notes are still the content identity for the same rows.
    expect(storage.allNotes()).toHaveLength(2);
  });

  it('never overwrites or deletes a user effort at a seed slug', async () => {
    const v1 = makeSource({ [EFFORTS_CHUNK_ID]: [effortDoc('air-squat')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    // Simulate a user record that re-used the seed slug (hand-renamed clone).
    await storage.applyChunk({
      notes: [],
      segments: [],
      efforts: [{ id: 'effort-user-x', slug: 'air-squat', label: 'My Squat', aliases: [], baseAttributes: { met: 9 }, registrySource: 'user' }],
      deleteNoteIds: [],
      deleteEffortSlugs: [],
      blocks: [],
      blockEfforts: [],
      deleteBlockIds: [],
      deleteBlockEffortIds: [],
      meta: (await storage.getSeedMeta(META_KEY))!,
    });

    const v2 = makeSource({ [EFFORTS_CHUNK_ID]: [effortDoc('air-squat')] }, 2000);
    await importAll(storage, v2.source);

    const effort = await storage.getEffort('air-squat');
    expect(effort!.registrySource).toBe('user');
    expect(effort!.label).toBe('My Squat');
  });

  it('deletes a vanished effort only when it is still seed-owned', async () => {
    const v1 = makeSource({ [EFFORTS_CHUNK_ID]: [effortDoc('air-squat'), effortDoc('burpee')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    // User-clone burpee before it vanishes upstream.
    await storage.applyChunk({
      notes: [],
      segments: [],
      efforts: [{ id: 'effort-user-b', slug: 'burpee', label: 'My Burpee', aliases: [], baseAttributes: { met: 8 }, registrySource: 'user' }],
      deleteNoteIds: [],
      deleteEffortSlugs: [],
      blocks: [],
      blockEfforts: [],
      deleteBlockIds: [],
      deleteBlockEffortIds: [],
      meta: (await storage.getSeedMeta(META_KEY))!,
    });

    const v2 = makeSource({ [EFFORTS_CHUNK_ID]: [effortDoc('air-squat')] }, 2000);
    const { result } = await importAll(storage, v2.source);

    expect(result.totalEfforts).toBe(1);
    expect(await storage.getEffort('burpee')).toBeDefined(); // user-owned → kept
    expect(storage.allEfforts().map((e) => e.slug)).toEqual(['air-squat', 'burpee']);
  });

  it('re-applies every chunk when the stored checkpoint schema is older', async () => {
    const v1 = makeSource({ canvas: [row('markdown/canvas/a.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    const meta = (await storage.getSeedMeta(META_KEY))!;
    meta.schema = 1; // pre-v2 checkpoint
    await storage.putSeedMeta(meta);

    const { result, counting } = await importAll(storage, v1.source); // unchanged manifest
    expect(result.status).toBe('imported');
    expect(counting.fetchChunkCalls).toEqual(['chunks/canvas.json']);
    expect((await storage.getSeedMeta(META_KEY))!.schema).toBe(SEED_SCHEMA);
  });
});

describe('SeedImporter manual re-sync (forceAll)', () => {
  it('re-applies an unchanged manifest when forced, preserving user rows', async () => {
    const v1 = makeSource({ canvas: [row('markdown/canvas/a.md')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    // Simulate a user edit over the seed row.
    const noteAId = await seedNoteId('markdown/canvas/a.md');
    const noteA = storage.allNotes().find((n) => n.id === noteAId)!;
    await storage.applyChunk({
      notes: [{ ...noteA, title: 'My A', seedOrigin: 'user' }],
      segments: [],
      efforts: [],
      blocks: [],
      blockEfforts: [],
      deleteNoteIds: [],
      deleteEffortSlugs: [],
      deleteBlockIds: [],
      deleteBlockEffortIds: [],
      meta: (await storage.getSeedMeta(META_KEY))!,
    });

    // Same manifest content, same version — force re-applies anyway.
    const counting = new CountingSeedSource(v1.source);
    const result = await new SeedImporter(storage, counting, 'core').applyAll({ forceAll: true });

    expect(result.status).toBe('imported');
    expect(result.appliedChunks).toBe(1);
    expect(result.skippedUserOwned).toBe(1);
    // The user-owned row survived untouched.
    const afterId = await seedNoteId('markdown/canvas/a.md');
    const after = storage.allNotes().find((n) => n.id === afterId);
    expect(after?.title).toBe('My A');
    expect(after?.seedOrigin).toBe('user');
  });

  it('repairs a user-owned legacy row\'s broken attribution without touching provenance', async () => {
    const v1 = makeSource({ [EFFORTS_CHUNK_ID]: [effortDoc('dumbbell-snatch')] }, 1000);
    const storage = new InMemorySeedStorage();
    await importAll(storage, v1.source);

    // Legacy DB state: imported before sourceId existed, then edited by the
    // user — provenance flipped to 'user', seed sourcePath retained,
    // attribution left broken (journal-classified).
    const noteId = await seedNoteId('markdown/efforts/dumbbell-snatch.md');
    const note = storage.allNotes().find((n) => n.id === noteId)!;
    const originalContent = storage.allSegments().find((s) => s.noteId === noteId)!.rawContent;
    await storage.applyChunk({
      notes: [{ ...note, title: 'Feedback edited effort', seedOrigin: 'user', sourceId: undefined }],
      segments: [],
      efforts: [],
      blocks: [],
      blockEfforts: [],
      deleteNoteIds: [],
      deleteEffortSlugs: [],
      deleteBlockIds: [],
      deleteBlockEffortIds: [],
      meta: (await storage.getSeedMeta(META_KEY))!,
    });

    // Same manifest, same hashes, same version — the schema migration
    // re-applies anyway (root's live DB reload path).
    const staleMeta = (await storage.getSeedMeta(META_KEY))!;
    staleMeta.schema = SEED_SCHEMA - 1;
    await storage.putSeedMeta(staleMeta);
    const { result } = await importAll(storage, v1.source);

    expect(result.status).toBe('imported');
    const repaired = storage.allNotes().find((n) => n.id === noteId)!;
    expect(repaired.title).toBe('Feedback edited effort');
    expect(repaired.seedOrigin).toBe('user');
    expect(repaired.sourceId).toBe('efforts');
    // Content identity untouched by the repair.
    const segment = storage.allSegments().find((s) => s.noteId === noteId)!;
    expect(segment.rawContent).toBe(originalContent);
    expect(repaired.sourceId !== 'journal').toBe(true);
  });
});

/** Records the checkpoint chunk ids in apply order — first-paint timing is observable through it. */
class RecordingStorage extends InMemorySeedStorage {
  appliedChunkIds: string[][] = [];
  override async applyChunk(write: SeedChunkWrite): Promise<void> {
    await super.applyChunk(write);
    this.appliedChunkIds.push(Object.keys(write.meta.chunks));
  }
}

describe('SeedImporter first-paint ordering', () => {
  it('applies the canvas chunk first and fires onFirstPaintApplied before the library tail', async () => {
    const canvasRows = [row('markdown/canvas/home/README.md'), row('markdown/canvas/guide/basics.md')];
    const aRows = [row('markdown/collections/a/fran.md')];
    const bRows = [row('markdown/collections/b/annie.md')];
    // The canvas chunk is listed LAST — apply order must not inherit
    // manifest order (or alphabetical luck).
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1000,
      builtAt: new Date(1000).toISOString(),
      chunks: [
        { id: 'collection.a', path: 'chunks/collection.a.json', sha256: shaOf(aRows), bytes: 1, count: aRows.length },
        { id: 'collection.b', path: 'chunks/collection.b.json', sha256: shaOf(bRows), bytes: 1, count: bRows.length },
        { id: 'canvas', path: 'chunks/canvas.json', sha256: shaOf(canvasRows), bytes: 1, count: canvasRows.length },
      ],
    };
    const paths = {
      'chunks/collection.a.json': aRows,
      'chunks/collection.b.json': bRows,
      'chunks/canvas.json': canvasRows,
    };
    const counting = new CountingSeedSource(new InMemorySeedSource(manifest, paths));
    const storage = new RecordingStorage();
    let firstPaintRuns = 0;
    let fetchCallsAtFirstPaint: string[] = [];
    const result = await new SeedImporter(storage, counting, 'core').applyAll({
      onFirstPaintApplied: () => {
        firstPaintRuns += 1;
        fetchCallsAtFirstPaint = [...counting.fetchChunkCalls];
      },
    });

    expect(result.status).toBe('imported');
    // Exactly once, at the moment only the canvas chunk has been
    // fetched — the collection chunks are still pending.
    expect(firstPaintRuns).toBe(1);
    expect(fetchCallsAtFirstPaint).toEqual(['chunks/canvas.json']);
    // First commit carries only the canvas checkpoint (the final
    // checkpoint-stamp write below is meta-only and carries no rows).
    expect(storage.appliedChunkIds[0]).toEqual(['canvas']);
    // First-paint rows are readable, and the background tail completes.
    const homeId = await seedNoteId('markdown/canvas/home/README.md');
    expect(storage.allNotes().some((n) => n.id === homeId)).toBe(true);
    expect(counting.fetchChunkCalls).toHaveLength(3);
  });

  it('imports a slow earlier chunk even when a later fetch finishes first', async () => {
    const { source } = makeSource({
      canvas: [row('markdown/canvas/home/README.md')],
      'collection.a': [row('markdown/collections/a/fran.md')],
      'collection.b': [row('markdown/collections/b/annie.md')],
    }, 1000);
    const laterFetched = Promise.withResolvers<void>();
    const storage = new InMemorySeedStorage();
    await new SeedImporter(storage, {
      fetchManifest: () => source.fetchManifest(),
      fetchChunk: async (path) => {
        if (path === 'chunks/collection.a.json') await laterFetched.promise;
        if (path === 'chunks/collection.b.json') laterFetched.resolve();
        return source.fetchChunk(path);
      },
    }, 'core').applyAll();

    expect(storage.allNotes().map((note) => note.sourcePath).sort()).toEqual([
      'markdown/canvas/home/README.md',
      'markdown/collections/a/fran.md',
      'markdown/collections/b/annie.md',
    ]);
    expect((await storage.getSeedMeta(META_KEY))?.seedVersion).toBe(1000);
  });

  it('keeps committed chunks and resumes after a later fetch fails early', async () => {
    const { source } = makeSource({
      canvas: [row('markdown/canvas/home/README.md')],
      'collection.a': [row('markdown/collections/a/fran.md')],
      'collection.b': [row('markdown/collections/b/annie.md')],
      'collection.c': [row('markdown/collections/c/cindy.md')],
    }, 1000);
    const laterFailed = Promise.withResolvers<void>();
    const storage = new InMemorySeedStorage();
    const importer = new SeedImporter(storage, {
      fetchManifest: () => source.fetchManifest(),
      fetchChunk: async (path) => {
        if (path === 'chunks/collection.a.json') {
          await laterFailed.promise;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        if (path === 'chunks/collection.b.json') {
          laterFailed.resolve();
          throw new Error('chunk unavailable');
        }
        return source.fetchChunk(path);
      },
    }, 'core');
    await expect(importer.applyAll()).rejects.toThrow('chunk unavailable');
    expect(storage.allNotes().map((note) => note.sourcePath).sort()).toEqual([
      'markdown/canvas/home/README.md',
      'markdown/collections/a/fran.md',
    ]);
    expect(Object.keys((await storage.getSeedMeta(META_KEY))!.chunks)).toEqual(['canvas', 'collection.a']);

    await new SeedImporter(storage, source, 'core').applyAll();
    expect(storage.allNotes().map((note) => note.sourcePath).sort()).toEqual([
      'markdown/canvas/home/README.md',
      'markdown/collections/a/fran.md',
      'markdown/collections/b/annie.md',
      'markdown/collections/c/cindy.md',
    ]);
    expect((await storage.getSeedMeta(META_KEY))?.seedVersion).toBe(1000);
  });

  it('does not fire onFirstPaintApplied when the canvas chunk is already applied (resume)', async () => {
    const canvasRows = [row('markdown/canvas/home/README.md')];
    const aRows = [row('markdown/collections/a/fran.md')];
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1000,
      builtAt: new Date(1000).toISOString(),
      chunks: [
        { id: 'collection.a', path: 'chunks/collection.a.json', sha256: shaOf(aRows), bytes: 1, count: aRows.length },
        { id: 'canvas', path: 'chunks/canvas.json', sha256: shaOf(canvasRows), bytes: 1, count: canvasRows.length },
      ],
    };
    const paths = {
      'chunks/collection.a.json': aRows,
      'chunks/canvas.json': canvasRows,
    };
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(META_KEY), seedVersion: 1000, chunks: { canvas: { sha256: shaOf(canvasRows) } } });
    const counting = new CountingSeedSource(new InMemorySeedSource(manifest, paths));
    let firstPaintRuns = 0;
    await new SeedImporter(storage, counting, 'core').applyAll({ onFirstPaintApplied: () => { firstPaintRuns += 1; } });

    expect(firstPaintRuns).toBe(0);
    expect(counting.fetchChunkCalls).toEqual(['chunks/collection.a.json']);
  });
});
