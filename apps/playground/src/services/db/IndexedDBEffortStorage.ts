import type { EffortStorageAdapter, IEffort } from '@bitcobblers/wod-wiki-lang';
import { storageService, type StorageService } from '@/services/storage';
import { mergeCustomOverridesIntoList } from './mergeCustomOverrides';

export class IndexedDBEffortStorage implements EffortStorageAdapter {
  private _db?: StorageService;
  constructor(db?: StorageService) {
    this._db = db;
  }
  private get db(): StorageService {
    return this._db ?? storageService;
  }
  async load(): Promise<IEffort[]> {
    const base = await this.db.getAllEfforts();
    return mergeCustomOverridesIntoList(this.db.storage, 'effort', base);
  }

  async save(effort: IEffort): Promise<void> {
    await this.db.saveEffort(effort);
  }

  async delete(slug: string): Promise<void> {
    await this.db.deleteEffort(slug);
  }
}

export const indexedDBEffortStorage = new IndexedDBEffortStorage();
