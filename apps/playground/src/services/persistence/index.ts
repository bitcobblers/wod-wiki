import type { IContentProvider } from '@/types/content-provider';

import type { INotePersistence } from './INotePersistence';
import { IndexedDBNotePersistence } from './IndexedDBNotePersistence';

export type { INotePersistence } from './INotePersistence';
export { IndexedDBNotePersistence } from './IndexedDBNotePersistence';
export * from './types';

export function createNotePersistence(provider: IContentProvider): INotePersistence {
  const storage = provider.persistenceStorage;
  if (!storage) throw new Error('Content provider requires atomic storage for note persistence');
  return new IndexedDBNotePersistence(storage, provider);
}

/**
 * Singleton persistence instance backed by IndexedDB.
 * Use this in non-React contexts (page-level scripts, legacy routes)
 * that need note persistence without a WorkbenchContext.
 */
export const notePersistence: INotePersistence = new IndexedDBNotePersistence();
