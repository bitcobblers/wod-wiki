import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { SqlStorage, libsqlDatabase } from '../src/sql';
import { validateStorageRow } from '../src/validation';
import type { Note } from '../src/entities';

/**
 * Feed provenance on a note is a claim about ONE import event: the feed
 * that delivered it and the seed that delivered it must agree. The storage
 * boundary refuses a row whose two provenance stamps contradict each other,
 * and the note's revision is what makes a metadata-only repair visible to
 * synchronization.
 */

const RAW = '# A\n\n```time\n10:00 Run\n```';

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: 'A',
    rawContent: RAW,
    sourceRevision: 1,
    blocks: reconcileNoteBlocks(RAW, { sourceRevision: 1, createId: () => 'b1' }),
    createdAt: 1,
    ...overrides,
  };
}

describe('feed provenance boundary', () => {
  it('accepts the pre-migration state — a seed-delivered note with no feed stamp', () => {
    expect(() => validateStorageRow('notes', note({ id: 'n-1', seedOrigin: 'seed', seedChunkId: 'collection.x' }))).not.toThrow();
  });

  it('accepts feed provenance that agrees with the seed provenance', () => {
    expect(() => validateStorageRow('notes', note({ id: 'n-2', seedOrigin: 'seed', feedOrigin: 'feed', feedSourceId: 'core' }))).not.toThrow();
  });

  it('accepts a feed-delivered note the user has taken ownership of', () => {
    // The feed delivered it; the user owns it now. The provenance of the
    // delivery and the seed stamp that came with it stay.
    expect(() => validateStorageRow('notes', note({ id: 'n-3', seedOrigin: 'user', feedOrigin: 'feed', feedSourceId: 'core' }))).not.toThrow();
  });

  it('refuses feed provenance with missing or contradicting seed provenance', () => {
    // Feed-delivered without any seed provenance.
    expect(() => validateStorageRow('notes', note({ id: 'n-4', feedOrigin: 'feed', feedSourceId: 'core' }))).toThrow();
    // Feed-delivered without naming the feed.
    expect(() => validateStorageRow('notes', note({ id: 'n-5', seedOrigin: 'seed', feedOrigin: 'feed' }))).toThrow();
    // A feed stamp without the feed kind.
    expect(() => validateStorageRow('notes', note({ id: 'n-6', seedOrigin: 'seed', feedSourceId: 'core' }))).toThrow();
    // User-owned feed provenance over a seed-delivered note.
    expect(() => validateStorageRow('notes', note({ id: 'n-7', seedOrigin: 'seed', feedOrigin: 'user' }))).toThrow();
  });
});

describe('a metadata-only provenance repair', () => {
  async function storage() {
    const db = libsqlDatabase(createClient({ url: ':memory:' }));
    const server = new SqlStorage(db);
    return { db, server };
  }

  /** The repaired note: the feed stamp, the seed stamps kept, and the
   *  revision advanced with the blocks. */
  function repaired(original: Note): Note {
    const sourceRevision = original.sourceRevision + 1;
    return {
      ...original,
      sourceRevision,
      blocks: Object.fromEntries(Object.entries(original.blocks).map(([id, block]) => [id, { ...block, sourceRevision }])),
      feedOrigin: 'feed',
      feedSourceId: 'core',
    };
  }

  /** The immutable block history a note's blocks must match. */
  function revisions(of: Note) {
    return Object.values(of.blocks).map((block) => ({
      noteId: of.id,
      blockId: block.id,
      version: block.version,
      kind: block.kind,
      rawContent: of.rawContent.slice(block.from, block.to),
      savedAt: of.createdAt,
      ...(block.dialect ? { dialect: block.dialect } : {}),
      ...(block.sport ? { sport: block.sport } : {}),
    }));
  }

  it('must advance the note revision — the blocks changed, so the version moves', async () => {
    const { server } = await storage();
    try {
      const original = note({ id: 'n-1', seedOrigin: 'seed', seedChunkId: 'collection.x' });
      await server.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put(original);
        await tx.readwrite('block_revisions').putMany(revisions(original));
      });

      // The repair without the version bump: the storage guard refuses it
      // (the blocks changed under an unchanged revision).
      const stale = repaired(original);
      await expect(server.transaction(['notes'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put({ ...stale, sourceRevision: original.sourceRevision });
      })).rejects.toThrow();

      // With the version bumped, the repair commits.
      await server.transaction(['notes'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put(stale);
      });
      const stored = await server.readonly('notes').get('n-1');
      expect(stored).toMatchObject({ feedOrigin: 'feed', feedSourceId: 'core', sourceRevision: 2 });
    } finally {
      await server.close();
    }
  });

  it('survives a stale peer copy — the repaired note is the newer one', async () => {
    const { server } = await storage();
    try {
      const original = note({ id: 'n-1', seedOrigin: 'seed', seedChunkId: 'collection.x' });
      const repair = repaired(original);
      await server.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put(repair);
        await tx.readwrite('block_revisions').putMany(revisions(original));
      });

      // The peer's older, unstamped copy arrives late: its revision is
      // behind, so it cannot overwrite the repair.
      await expect(server.transaction(['notes'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put(original);
      })).rejects.toThrow();
      const stored = await server.readonly('notes').get('n-1');
      expect(stored).toMatchObject({ feedOrigin: 'feed', feedSourceId: 'core', sourceRevision: 2 });
    } finally {
      await server.close();
    }
  });
});
