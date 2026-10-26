/**
 * Placement storage behavior — the `page_notes` junction is the only
 * membership record, and it is many-to-many: a note may sit on several
 * pages, a page may hold several notes.
 *
 * These tests pin the properties the ticket asks for:
 * - a note placed on several pages resolves to all of them,
 * - resolving a note's pages uses the index (no scan of every page),
 * - adding to a second page never detaches the first,
 * - placement ordering is preserved on add and move,
 * - a move is atomic: it detaches from the source AND attaches at the
 *   destination, or nothing changes,
 * - the note itself is never cloned or deleted by a placement change.
 */
import { describe, expect, it } from 'bun:test';

import { InMemoryStorage } from './InMemoryStorage';
import { StorageService } from './StorageService';
import type { IStorageTransaction } from './IStorage';
import type { StoreName } from './IStorage';
import type { Page } from '@/types/storage';
import { NotePersistenceError } from '../persistence/types';

const T0 = 1_700_000_000_000;

function makePage(overrides: Partial<Page> & { id: string }): Page {
  return { createdAt: T0, ...overrides };
}

async function makeService(): Promise<StorageService> {
  const service = new StorageService(new InMemoryStorage());
  await service.savePage(makePage({ id: 'cal-1', date: '2026-07-15', title: '2026-07-15' }));
  await service.savePage(makePage({ id: 'cal-2', date: '2026-07-16', title: '2026-07-16' }));
  await service.savePage(makePage({ id: 'named-1', slug: 'marathon-block', title: 'Marathon' }));
  await service.savePage(makePage({ id: 'named-2', slug: 'gym', title: 'Gym' }));
  return service;
}

describe('placement lookup — indexed, not a page scan', () => {
  it('resolves every page a note is placed on', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'cal-1');
    await service.addNoteToPage('note-1', 'named-1');

    const placements = await service.getNotePlacements('note-1');
    expect(placements.map((placement) => placement.pageId).sort()).toEqual(['cal-1', 'named-1']);
    expect(placements.find((placement) => placement.pageId === 'cal-1')?.date).toBe('2026-07-15');
    expect(placements.find((placement) => placement.pageId === 'named-1')?.slug).toBe('marathon-block');
  });

  it('reads the junction by note index — it never scans the junction store', async () => {
    const inner = new InMemoryStorage();
    const reads: string[] = [];
    const counting = new Proxy(inner, {
      get(target, property, receiver) {
        if (property !== 'readonly') return Reflect.get(target, property, receiver);
        return (<K extends StoreName>(store: K) => {
          const rows = target.readonly(store);
          return new Proxy(rows, {
            get(rowTarget, rowProperty, rowReceiver) {
              if (rowProperty === 'getAll') {
                return async (...args: unknown[]) => {
                  reads.push(`${store}.getAll`);
                  return (rowTarget.getAll as (...a: unknown[]) => Promise<unknown[]>)(...args);
                };
              }
              if (rowProperty === 'getAllFromIndex') {
                return async (index: string, ...args: unknown[]) => {
                  reads.push(`${store}.${index}`);
                  return (rowTarget.getAllFromIndex as (...a: unknown[]) => Promise<unknown[]>)(index, ...args);
                };
              }
              return Reflect.get(rowTarget, rowProperty, rowReceiver);
            },
          });
        }) as typeof target.readonly;
      },
    });
    const service = new StorageService(counting);
    await service.savePage(makePage({ id: 'cal-1', date: '2026-07-15' }));
    await service.addNoteToPage('note-1', 'cal-1');

    reads.length = 0;
    const placements = await service.getNotePlacements('note-1');

    expect(placements).toHaveLength(1);
    expect(reads).toContain('page_notes.by-note');
    expect(reads.filter((read) => read === 'page_notes.getAll')).toEqual([]);
  });

  it('keeps a page able to hold several notes', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'named-1');
    await service.addNoteToPage('note-2', 'named-1');
    await service.addNoteToPage('note-3', 'named-1');

    const links = await service.getPageNotes('named-1');
    expect(links.map((link) => link.noteId).sort()).toEqual(['note-1', 'note-2', 'note-3']);
  });
});

describe('adding a placement', () => {
  it('does not detach the note from the pages it is already on', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'cal-1');
    await service.addNoteToPage('note-1', 'named-1');
    await service.addNoteToPage('note-1', 'named-2');

    const placements = await service.getNotePlacements('note-1');
    expect(placements.map((placement) => placement.pageId).sort()).toEqual(['cal-1', 'named-1', 'named-2']);
  });

  it('appends by default and leaves the other placements\u2019 positions alone', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'named-1', 0);
    await service.addNoteToPage('note-2', 'named-1', 1);

    await service.addNoteToPage('note-3', 'named-1');

    const links = await service.getPageNotes('named-1');
    const positionOf = (noteId: string) => links.find((link) => link.noteId === noteId)?.position;
    expect(positionOf('note-1')).toBe(0);
    expect(positionOf('note-2')).toBe(1);
    // The appended placement carries no position — it sorts after every
    // positioned row of that page.
    expect(positionOf('note-3')).toBeUndefined();
  });

  it('is idempotent — placing the same note on the same page twice keeps one row', async () => {
    const service = await makeService();
    const first = await service.addNoteToPage('note-1', 'named-1');
    const second = await service.addNoteToPage('note-1', 'named-1');
    expect(second).toBe(first);
    expect(await service.getPageNotes('named-1')).toHaveLength(1);
  });
});

describe('removing a placement', () => {
  it('detaches the note from that page only', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'cal-1');
    await service.addNoteToPage('note-1', 'named-1');

    await service.removeNoteFromPage('note-1', 'cal-1');

    const placements = await service.getNotePlacements('note-1');
    expect(placements.map((placement) => placement.pageId)).toEqual(['named-1']);
  });
});

describe('moving a placement', () => {
  it('detaches from the source and attaches at the destination', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'cal-1');
    await service.addNoteToPage('note-1', 'named-1');

    await service.moveNoteBetweenPages('note-1', 'cal-1', 'cal-2');

    const placements = await service.getNotePlacements('note-1');
    expect(placements.map((placement) => placement.pageId).sort()).toEqual(['cal-2', 'named-1']);
  });

  it('appends at the destination and leaves the destination\u2019s other positions alone', async () => {
    const service = await makeService();
    await service.addNoteToPage('note-1', 'cal-1', 0);
    await service.addNoteToPage('note-2', 'cal-2', 0);

    await service.moveNoteBetweenPages('note-1', 'cal-1', 'cal-2');

    const links = await service.getPageNotes('cal-2');
    expect(links.find((link) => link.noteId === 'note-2')?.position).toBe(0);
    expect(links.find((link) => link.noteId === 'note-1')?.position).toBeUndefined();
  });

  it('is atomic — a failed move leaves the note on its source page', async () => {
    const inner = new InMemoryStorage();
    // The attach at the destination fails inside the transaction; the
    // detach from the source must roll back with it.
    const failing = new Proxy(inner, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver);
        return (<K extends StoreName, R>(
          stores: K[],
          mode: 'readonly' | 'readwrite',
          fn: (tx: IStorageTransaction) => Promise<R>,
        ) => target.transaction(stores, mode, (tx) => fn({
          ...tx,
          readwrite: (<S extends StoreName>(store: S) => {
            const rows = tx.readwrite(store);
            if (store !== 'page_notes') return rows;
            return new Proxy(rows, {
              get(rowTarget, rowProperty, rowReceiver) {
                if (rowProperty !== 'put') return Reflect.get(rowTarget, rowProperty, rowReceiver);
                return async () => {
                  throw new Error('attach failed');
                };
              },
            });
          }),
        }))) as typeof target.transaction;
      },
    });
    const service = new StorageService(failing);
    await service.savePage(makePage({ id: 'cal-1', date: '2026-07-15' }));
    await service.savePage(makePage({ id: 'cal-2', date: '2026-07-16' }));
    await service.savePage(makePage({ id: 'named-1', slug: 'marathon-block' }));

    // Seed the placements before the write failure is armed.
    const seed = new StorageService(inner);
    await seed.addNoteToPage('note-1', 'cal-1');
    await seed.addNoteToPage('note-1', 'named-1');

    await expect(service.moveNoteBetweenPages('note-1', 'cal-1', 'cal-2')).rejects.toThrow('attach failed');

    const placements = await seed.getNotePlacements('note-1');
    expect(placements.map((placement) => placement.pageId).sort()).toEqual(['cal-1', 'named-1']);
  });

  it('rejects a move whose source the note is not placed on, inside the transaction, changing nothing', async () => {
    const service = new StorageService(new InMemoryStorage());
    await service.savePage(makePage({ id: 'cal-1', date: '2026-07-15' }));
    await service.savePage(makePage({ id: 'cal-2', date: '2026-07-16' }));
    await service.addNoteToPage('note-1', 'cal-1');

    const failure = await service.moveNoteBetweenPages('note-1', 'cal-2', 'cal-1')
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(NotePersistenceError);
    if (!(failure instanceof NotePersistenceError)) throw new Error('expected NotePersistenceError');
    expect(failure.code).toBe('NOTE_NOT_PLACED');

    const placements = await service.getNotePlacements('note-1');
    expect(placements.map((placement) => placement.pageId)).toEqual(['cal-1']);
  });
});
