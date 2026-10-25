/**
 * Main-thread default seed storage — the app's active IStorage (IndexedDB
 * today, API under VITE_STORAGE=api). Lives in its own module because it
 * imports '@/services/storage', whose module side effects are not
 * worker-safe; the seed-sync worker must never import this file.
 */
import { storage } from '@/services/storage';
import { IndexedDBFeedImportStorage } from './FeedImportStorage';

export function mainThreadFeedImportStorage(): IndexedDBFeedImportStorage {
  return new IndexedDBFeedImportStorage(storage);
}
