import { describe, expect, it } from 'vitest';
import { applySeedChunk, applySeedChunks, emptySeedMeta, SEED_SCHEMA, type SeedMetaRecord, type SeedManifest, type SeedRow } from '../../src/index';
import { seedNoteId } from '../../src/seed/runtime';
import { compileSeedRow } from '../../../tools/src/seedbuild/compiler';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { EventRecord, Note, Session } from '@bitcobblers/wod-wiki-storage';

function createRealSqlStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

const CHUNK_ID = 'notebook.demo';
const PATH = 'markdown/notebooks/demo/fran.md';
const SEED_CONTENT = '# Fran\n\n```time\n21-15-9\n  Thrusters\n```\n';
const USER_CONTENT = '# Fran (my scaling)\n\n```time\n15-12-9\n  Jumping Pullups\n```\n';

function manifest(version: number, chunkIds: string[]): SeedManifest {
  return {
    schema: SEED_SCHEMA,
    version,
    builtAt: new Date(version).toISOString(),
    chunks: chunkIds.map((id, i) => ({
      id,
      path: `chunks/${id}.${i}.json`,
      sha256: String(i).padStart(64, '0'),
      bytes: 100,
      count: 1,
    })),
  };
}

function metaRecord(key: string, version: number, chunkNoteIds?: Record<string, string[]>): SeedMetaRecord {
  const chunks: SeedMetaRecord['chunks'] = {};
  for (const [chunkId, noteIds] of Object.entries(chunkNoteIds ?? {})) {
    chunks[chunkId] = { sha256: 'a'.repeat(64), noteIds };
  }
  return {
    ...emptySeedMeta(key),
    seedVersion: version,
    builtAt: new Date(version).toISOString(),
    importedAt: version,
    tier: 'imported',
    chunks,
  };
}

async function getNote(storage: SqlStorage, id: string): Promise<Note | undefined> {
  return storage.transaction(['notes'], 'readonly', async (tx) => tx.readonly('notes').get(id)) as Promise<Note | undefined>;
}

async function getSession(storage: SqlStorage, id: string): Promise<Session | undefined> {
  return storage.transaction(['sessions'], 'readonly', async (tx) => tx.readonly('sessions').get(id)) as Promise<Session | undefined>;
}

async function putRow(storage: SqlStorage, store: 'notes' | 'sessions' | 'events', value: unknown): Promise<void> {
  await storage.transaction([store], 'readwrite', async (tx) => { await tx.readwrite(store).put(value as never); });
}

function journalSession(noteId: string, blockId: string, blockContentId: string): Session {
  return {
    id: 'sess-user-1',
    noteId,
    blockId,
    blockVersion: 1,
    blockContentId,
    origin: 'journal',
    startTime: 1_000,
    endTime: 2_000,
    duration: 1_000,
    completed: false,
    createdAt: 500,
  };
}

describe('WW-020 — seed import never destroys user data', () => {
  it('keeps user-authored notes (seedOrigin user and unset) across initial import, checkpoint-loss re-import, and vanished-chunk sweep', async () => {
    for (const seedOrigin of ['user', undefined] as const) {
      const storage = createRealSqlStorage();
      const seedNoteIdForPath = await seedNoteId(PATH);
      const userBlocks = reconcileNoteBlocks(USER_CONTENT, { sourceRevision: 3 });
      // Block revisions must exist before the note: every transaction
      // refresh validates that each stored note block has a matching pin.
      for (const block of Object.values(userBlocks)) {
        await putRow(storage, 'block_revisions', {
          noteId: seedNoteIdForPath,
          blockId: block.id,
          version: block.version,
          kind: block.kind,
          rawContent: USER_CONTENT.slice(block.from, block.to),
          savedAt: 42,
          ...(block.dialect ? { dialect: block.dialect } : {}),
        });
      }
      const userNote: Note = {
        id: seedNoteIdForPath,
        title: 'Fran (my scaling)',
        rawContent: USER_CONTENT,
        sourceRevision: 3,
        blocks: userBlocks,
        createdAt: 42,
        type: 'note',
        ...(seedOrigin === undefined ? {} : { seedOrigin }),
      };
      await putRow(storage, 'notes', userNote);

      // (a) initial seed import over a user-authored note occupying the id.
      const row = compileSeedRow(PATH, SEED_CONTENT);
      const meta1 = metaRecord('seed:demo-feed', 1, { [CHUNK_ID]: [seedNoteIdForPath] });
      const result1 = await applySeedChunk(storage, {
        chunkId: CHUNK_ID,
        rows: [row],
        manifest: manifest(1, [CHUNK_ID]),
        expectedMeta: undefined,
        meta: meta1,
      });
      expect(result1.skippedUserOwned).toBeGreaterThanOrEqual(1);
      const afterImport = await getNote(storage, seedNoteIdForPath);
      expect(afterImport?.rawContent).toBe(USER_CONTENT);
      expect(afterImport?.seedOrigin).toBe(seedOrigin);
      expect(afterImport?.sourceRevision).toBe(3);

      // (b) checkpoint loss: the checkpoint row vanishes (device restore),
      // so the next import runs with expectedMeta undefined — it must still
      // not resurrect seed content over the user's copy.
      await storage.transaction(['meta'], 'readwrite', async (tx) => { await tx.readwrite('meta').delete('seed:demo-feed'); });
      const meta2 = metaRecord('seed:demo-feed', 2, { [CHUNK_ID]: [seedNoteIdForPath] });
      const result2 = await applySeedChunk(storage, {
        chunkId: CHUNK_ID,
        rows: [row],
        manifest: manifest(2, [CHUNK_ID]),
        expectedMeta: undefined,
        meta: meta2,
      });
      expect(result2.skippedUserOwned).toBeGreaterThanOrEqual(1);
      expect((await getNote(storage, seedNoteIdForPath))?.rawContent).toBe(USER_CONTENT);

      // (c) vanished-chunk sweep: the chunk disappears from the manifest and
      // the sweep deletes seed notes — never the user's copy.
      const meta3 = metaRecord('seed:demo-feed', 3);
      const result3 = await applySeedChunk(storage, {
        chunkId: CHUNK_ID,
        rows: [],
        manifest: manifest(3, []),
        expectedMeta: meta2,
        meta: meta3,
      });
      expect(result3.deleted).toBe(0);
      expect((await getNote(storage, seedNoteIdForPath))?.rawContent).toBe(USER_CONTENT);
    }
  });

  it('never lets feed telemetry overwrite a user-recorded journal Session or its events', async () => {
    const storage = createRealSqlStorage();
    const noteId = await seedNoteId(PATH);

    // 1. First import establishes the owned seed note (no telemetry yet).
    const row = compileSeedRow(PATH, SEED_CONTENT);
    const wod = row.blockIndex.find((block) => block.dataType === 'wod');
    expect(wod).toBeDefined();
    const meta1 = metaRecord('seed:demo-feed', 1, { [CHUNK_ID]: [noteId] });
    await applySeedChunk(storage, {
      chunkId: CHUNK_ID,
      rows: [row],
      manifest: manifest(1, [CHUNK_ID]),
      expectedMeta: undefined,
      meta: meta1,
    });

    // 2. The user records a journal Session on that seed note. The feed
    //    happens to publish telemetry pinned under the same session id.
    const userSession = journalSession(noteId, wod!.blockId, wod!.blockContentId!);
    await putRow(storage, 'sessions', userSession);
    const userEvent: EventRecord = {
      id: 'ev-user-1',
      resultId: 'sess-user-1',
      noteId,
      timestamp: 1_500,
      grain: 'event',
      outputType: 'rounds',
      metrics: [{ type: 'rounds', value: 3 }],
    };
    await putRow(storage, 'events', userEvent);

    // 3. Re-import with telemetry carrying the colliding id.
    const telemetryRow: SeedRow = {
      ...row,
      telemetry: {
        sessions: [{
          ...userSession,
          origin: undefined,
          startTime: 9_000,
          endTime: 9_500,
          duration: 500,
          completed: true,
          createdAt: 9_500,
        }],
        events: [{
          id: 'ev-user-1',
          resultId: 'sess-user-1',
          noteId,
          blockId: wod!.blockId,
          blockVersion: 1,
          blockContentId: wod!.blockContentId,
          timestamp: 9_400,
          grain: 'summary',
          outputType: 'time',
          metrics: [{ type: 'time', value: 500 }],
        }],
      },
    };
    const meta2 = metaRecord('seed:demo-feed', 2, { [CHUNK_ID]: [noteId] });
    await applySeedChunk(storage, {
      chunkId: CHUNK_ID,
      rows: [telemetryRow],
      manifest: manifest(2, [CHUNK_ID]),
      expectedMeta: meta1,
      meta: meta2,
    });

    // The user's journal session (and its event) survive byte-for-byte.
    const session = await getSession(storage, 'sess-user-1');
    expect(session?.origin).toBe('journal');
    expect(session?.startTime).toBe(1_000);
    expect(session?.completed).toBe(false);
    const event = await storage.transaction(['events'], 'readonly', async (tx) => tx.readonly('events').get('ev-user-1')) as EventRecord | undefined;
    expect(event?.timestamp).toBe(1_500);
    expect(event?.grain).toBe('event');
  });

  it('never lets feed telemetry overwrite a non-seed Session even when origin is unset (WW-012)', async () => {
    const storage = createRealSqlStorage();
    const noteId = await seedNoteId(PATH);
    const row = compileSeedRow(PATH, SEED_CONTENT);
    const wod = row.blockIndex.find((block) => block.dataType === 'wod')!;
    const meta1 = metaRecord('seed:demo-feed', 1, { [CHUNK_ID]: [noteId] });
    await applySeedChunk(storage, {
      chunkId: CHUNK_ID,
      rows: [row],
      manifest: manifest(1, [CHUNK_ID]),
      expectedMeta: undefined,
      meta: meta1,
    });

    const originlessUserSession: Session = {
      ...journalSession(noteId, wod.blockId, wod.blockContentId!),
      id: 'run-local-without-origin',
      origin: undefined,
    };
    await putRow(storage, 'sessions', originlessUserSession);

    const telemetryRow: SeedRow = {
      ...row,
      telemetry: {
        sessions: [{
          ...originlessUserSession,
          startTime: 99_000,
          endTime: 99_500,
          duration: 500,
          completed: true,
          createdAt: 99_500,
        }],
        events: [{
          id: 'ev-colliding',
          resultId: originlessUserSession.id,
          noteId,
          blockId: wod.blockId,
          blockVersion: 1,
          blockContentId: wod.blockContentId,
          timestamp: 99_400,
          grain: 'summary',
          outputType: 'time',
          metrics: [{ type: 'time', value: 500 }],
        }],
      },
    };
    const meta2 = metaRecord('seed:demo-feed', 2, { [CHUNK_ID]: [noteId] });
    await applySeedChunk(storage, {
      chunkId: CHUNK_ID,
      rows: [telemetryRow],
      manifest: manifest(2, [CHUNK_ID]),
      expectedMeta: meta1,
      meta: meta2,
    });

    const preserved = await getSession(storage, originlessUserSession.id);
    expect(preserved?.startTime).toBe(1_000);
    expect(preserved?.completed).toBe(false);
    const ignoredEvent = await storage.transaction(['events'], 'readonly', async (tx) => tx.readonly('events').get('ev-colliding'));
    expect(ignoredEvent).toBeUndefined();
  });

  it('preserves user-authored notes and in-progress sessions across multi-source reload imports (WW-020, WW-012)', async () => {
    const storage = createRealSqlStorage();
    const corePath = 'markdown/canvas/guide-protocols.md';
    const coreNoteId = await seedNoteId(corePath);
    const coreRow = compileSeedRow(corePath, SEED_CONTENT);
    const resultsPath = 'markdown/notebooks/athletics-results/event-1.md';
    const resultsNoteId = await seedNoteId(resultsPath);
    const resultsRow = compileSeedRow(resultsPath, SEED_CONTENT);

    await applySeedChunks(storage, [{
      chunkId: 'canvas',
      rows: [coreRow],
      manifest: manifest(1, ['canvas']),
      expectedMeta: undefined,
      meta: metaRecord('seed:core', 1, { canvas: [coreNoteId] }),
    }]);

    // User authors a new note and starts an in-progress session on the guide note.
    const userNoteId = '01a1e2dd-c53c-734a-8880-b0610f97f712';
    const userBlocks = reconcileNoteBlocks(USER_CONTENT, { sourceRevision: 1 });
    for (const block of Object.values(userBlocks)) {
      await putRow(storage, 'block_revisions', {
        noteId: userNoteId,
        blockId: block.id,
        version: block.version,
        kind: block.kind,
        rawContent: USER_CONTENT.slice(block.from, block.to),
        savedAt: 100,
        ...(block.dialect ? { dialect: block.dialect } : {}),
      });
    }
    await putRow(storage, 'notes', {
      id: userNoteId,
      title: 'Kettlebell Hell 5RFT',
      rawContent: USER_CONTENT,
      sourceRevision: 1,
      blocks: userBlocks,
      createdAt: 100,
      type: 'note',
      seedOrigin: 'user',
    } satisfies Note);

    const wod = coreRow.blockIndex.find((b) => b.dataType === 'wod')!;
    const activeSession: Session = {
      ...journalSession(coreNoteId, wod.blockId, wod.blockContentId!),
      id: '01a1e2e9-0000-7000-8000-000000000001',
      completed: false,
    };
    await putRow(storage, 'sessions', activeSession);

    // Simulate reload triggering multi-source feed import (core + samples-results),
    // including a checkpoint loss on samples-results.
    await applySeedChunks(storage, [{
      chunkId: 'notebook.athletics-results',
      rows: [resultsRow],
      manifest: manifest(1, ['notebook.athletics-results']),
      expectedMeta: undefined,
      meta: metaRecord('seed:samples-results', 1, { 'notebook.athletics-results': [resultsNoteId] }),
    }]);
    await applySeedChunks(storage, [{
      chunkId: 'canvas',
      rows: [coreRow],
      manifest: manifest(2, ['canvas']),
      expectedMeta: metaRecord('seed:core', 1, { canvas: [coreNoteId] }),
      meta: metaRecord('seed:core', 2, { canvas: [coreNoteId] }),
    }]);

    expect((await getNote(storage, userNoteId))?.rawContent).toBe(USER_CONTENT);
    expect((await getNote(storage, resultsNoteId))?.seedOrigin).toBe('seed');
    const survivingSession = await getSession(storage, activeSession.id);
    expect(survivingSession?.id).toBe(activeSession.id);
    expect(survivingSession?.completed).toBe(false);
  });
});
