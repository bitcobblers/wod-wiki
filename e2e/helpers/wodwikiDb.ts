import type { Page } from '@playwright/test';
import { parseDocumentSections, reconcileNoteBlocks } from '../../packages/core/src/sections';
import type { BlockRevision, Note } from '../../packages/core/src/types/storage';
import { DB_VERSION } from '../../packages/storage/src/schema';
import { waitForSeedReady } from './seedReadiness';

export const WOD_DB = 'wodwiki-db';

export interface ResultRow {
  noteId?: string;
  blockId?: string;
  blockVersion?: number;
  blockContentId?: string;
  duration?: number;
  completed?: boolean;
  status?: 'completed' | 'in-progress';
  createdAt?: number;
}

export function noteFixture(noteId: string, content: string, opts?: { type?: string; title?: string }) {
  const now = Date.now();
  const blocks = reconcileNoteBlocks(content, { sourceRevision: 1 });
  const note: Note = {
    id: noteId, title: opts?.title ?? noteId.split('/').pop() ?? noteId,
    type: opts?.type ?? 'note', createdAt: now, rawContent: content, sourceRevision: 1, blocks,
  };
  const revisions: BlockRevision[] = Object.values(blocks).map((block) => ({
    noteId, blockId: block.id, version: block.version, kind: block.kind,
    rawContent: content.slice(block.from, block.to), savedAt: now,
    ...(block.dialect ? { dialect: block.dialect } : {}),
    ...(block.sport ? { sport: block.sport } : {}),
  }));
  const sections = parseDocumentSections(content);
  const index = Object.values(blocks).map((block) => ({
    id: `${noteId}:${block.id}`, noteId, blockId: block.id, blockVersion: block.version,
    dataType: block.kind, sourceRevision: 1, from: block.from, to: block.to,
    rawContent: content.slice(block.from, block.to), noteTitle: note.title, createdAt: now,
    ...(block.kind === 'wod' ? { blockContentId: sections.find((section) => section.from === block.from)?.contentId } : {}),
  }));
  return { note, revisions, index };
}

export async function clearResults(page: Page, noteId?: string): Promise<void> {
  await page.evaluate(async ({ dbName, noteId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        if (noteId === undefined) store.clear();
        else {
          const req = store.index('by-note').openCursor(IDBKeyRange.only(noteId));
          req.onsuccess = () => { const cursor = req.result; if (cursor) { cursor.delete(); cursor.continue(); } };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB, noteId });
}

export async function getResults(page: Page, noteId?: string): Promise<ResultRow[]> {
  return page.evaluate(async ({ dbName, noteId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<ResultRow[]>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const req = noteId === undefined ? store.getAll() : store.index('by-note').getAll(IDBKeyRange.only(noteId));
        req.onsuccess = () => resolve(req.result);

        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB, noteId });
}
export async function seedCompletedSessions(
  page: Page, noteId: string, sessions: { id: string; createdAt: number; duration: number }[],
): Promise<void> {
  await page.evaluate(async ({ dbName, noteId, sessions }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['notes', 'block_revisions', 'sessions'], 'readwrite');
        const noteReq = tx.objectStore('notes').get(noteId);
        noteReq.onsuccess = () => {
          const note: Note | undefined = noteReq.result;
          const block = note && Object.values(note.blocks).find((item) => item.kind === 'wod');
          if (!block) { tx.abort(); return; }
          const revisionReq = tx.objectStore('block_revisions').get([noteId, block.id, block.version]);
          revisionReq.onsuccess = () => {
            if (!revisionReq.result) { tx.abort(); return; }
            for (const session of sessions) tx.objectStore('sessions').put({
              ...session, noteId, blockId: block.id, blockVersion: block.version,
              startTime: session.createdAt - session.duration, endTime: session.createdAt,
              completed: true, status: 'completed',
            });
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error(`No saved workout revision for ${noteId}`));
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB, noteId, sessions });
}

/** Seed only an initialized current schema, never invent an older fixture DB. */
export async function seedNote(
  page: Page, noteId: string, content: string,
  opts?: { type?: string; title?: string; journalDate?: string },
): Promise<void> {
  await waitForSeedReady(page);
  const fixture = noteFixture(noteId, content, opts);
  await page.evaluate(async ({ dbName, fixture, journalDate, version }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (db.version !== version || !db.objectStoreNames.contains('block_revisions')) {
        throw new Error('Initialize the current disposable app database before seeding');
      }
      await new Promise<void>((resolve, reject) => {
        const stores = ['notes', 'block_revisions', 'block_index', 'block_efforts'];
        if (journalDate) stores.push('page', 'page_notes');
        const tx = db.transaction(stores, 'readwrite');
        for (const storeName of ['block_index', 'block_efforts']) {
          const req = tx.objectStore(storeName).index('by-note').getAllKeys(fixture.note.id);
          req.onsuccess = () => {
            for (const key of req.result) tx.objectStore(storeName).delete(key);
            if (storeName === 'block_index') for (const row of fixture.index) tx.objectStore(storeName).put(row);
          };
        }
        tx.objectStore('notes').put(fixture.note);
        for (const row of fixture.revisions) tx.objectStore('block_revisions').add(row);
        if (journalDate) {
          const pageId = `page/${journalDate}`;
          tx.objectStore('page').put({ id: pageId, date: journalDate, title: journalDate, createdAt: fixture.note.createdAt });
          tx.objectStore('page_notes').put({ id: `pn-${pageId}-${fixture.note.id}`, pageId, noteId: fixture.note.id, position: 0, createdAt: fixture.note.createdAt });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB, fixture, journalDate: opts?.journalDate, version: DB_VERSION });
}

export async function seedJournalNote(page: Page, date: string, content: string, opts?: { title?: string }): Promise<void> {
  await seedNote(page, `journal/${date}`, content, { ...opts, type: 'journal', journalDate: date });
}

/** Ordinary Note deletion retains immutable history and Session pins. */
export async function deleteNoteByRouteId(page: Page, routeId: string): Promise<void> {
  await page.evaluate(async ({ dbName, routeId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const stores = ['notes', 'note_tags', 'block_index', 'block_efforts', 'page', 'page_notes'];
        const tx = db.transaction(stores, 'readwrite');
        const notes = tx.objectStore('notes');
        const remove = (noteId: string) => {
          notes.delete(noteId);
          for (const name of ['note_tags', 'block_index', 'block_efforts', 'page_notes']) {
            const req = tx.objectStore(name).index('by-note').openCursor(noteId);
            req.onsuccess = () => { const cursor = req.result; if (cursor) { cursor.delete(); cursor.continue(); } };
          }
        };
        const removePage = (page: { id: string } | undefined) => {
          if (!page) return;
          const req = tx.objectStore('page_notes').index('by-page').getAll(page.id);
          req.onsuccess = () => {
            for (const link of req.result) remove(link.noteId);
            tx.objectStore('page').delete(page.id);
          };
        };
        const noteReq = notes.get(routeId);
        noteReq.onsuccess = () => {
          if (noteReq.result) return remove(noteReq.result.id);
          const pageReq = tx.objectStore('page').index('by-slug').get(routeId);
          pageReq.onsuccess = () => {
            if (pageReq.result) return removePage(pageReq.result);
            if (!routeId.startsWith('journal/')) return;
            const dateReq = tx.objectStore('page').index('by-date').get(routeId.slice('journal/'.length));
            dateReq.onsuccess = () => removePage(dateReq.result);
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB, routeId });
}

export async function clearAllNotes(page: Page): Promise<void> {
  await page.evaluate(async ({ dbName }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const stores = ['notes', 'note_tags', 'page_notes', 'block_index', 'block_efforts'];
        const tx = db.transaction(stores, 'readwrite');
        for (const name of stores) tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB });
}

export async function getNoteContentByRouteId(page: Page, routeId: string): Promise<string | null> {
  return page.evaluate(async ({ dbName, routeId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(['notes', 'page', 'page_notes'], 'readonly');
        const notes = tx.objectStore('notes');
        const readPage = (page: { id: string } | undefined) => {
          if (!page) return resolve(null);
          const req = tx.objectStore('page_notes').index('by-page').getAll(page.id);
          req.onsuccess = () => {
            const links: { noteId: string }[] = req.result;
            const read = (i: number): void => {
              if (i === links.length) return resolve(null);
              const noteReq = notes.get(links[i].noteId);
              noteReq.onsuccess = () => noteReq.result ? resolve(noteReq.result.rawContent) : read(i + 1);
            };
            read(0);
          };
        };
        const req = notes.get(routeId);
        req.onsuccess = () => {
          if (req.result) return resolve(req.result.rawContent);
          const pageReq = tx.objectStore('page').index('by-slug').get(routeId);
          pageReq.onsuccess = () => {
            if (pageReq.result) return readPage(pageReq.result);
            if (!routeId.startsWith('journal/')) return resolve(null);
            const dateReq = tx.objectStore('page').index('by-date').get(routeId.slice('journal/'.length));
            dateReq.onsuccess = () => readPage(dateReq.result);
          };
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { dbName: WOD_DB, routeId });
}
