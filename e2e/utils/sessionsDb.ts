import type { Page } from '@playwright/test';
import { WOD_DB } from '../helpers/wodwikiDb';

/** Read and clear completed Sessions in the disposable browser test store. */

export interface SessionRow {
  id?: string;
  noteId?: string;
  blockId?: string;
  blockVersion?: number;
  blockContentId?: string;
  duration?: number;
  completed?: boolean;
  status?: 'completed' | 'in-progress';
  createdAt?: number;
}

export async function getSessions(page: Page, noteId?: string): Promise<SessionRow[]> {
  return page.evaluate(
    async ({ dbName, noteId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains('sessions')) return [];
        return await new Promise<SessionRow[]>((resolve, reject) => {
          const tx = db.transaction('sessions', 'readonly');
          const req =
            noteId === undefined
              ? tx.objectStore('sessions').getAll()
              : tx.objectStore('sessions').index('by-note').getAll(IDBKeyRange.only(noteId));
          req.onsuccess = () => resolve(req.result as SessionRow[]);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, noteId },
  );
}

export async function clearSessions(page: Page, noteId?: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, noteId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains('sessions')) return;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('sessions', 'readwrite');
          if (noteId === undefined) {
            tx.objectStore('sessions').clear();
          } else {
            const cursorReq = tx.objectStore('sessions').index('by-note').openCursor(IDBKeyRange.only(noteId));
            cursorReq.onsuccess = (e) => {
              const cursor = (e.target as IDBRequest).result;
              if (cursor) { cursor.delete(); cursor.continue(); }
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, noteId },
  );
}
