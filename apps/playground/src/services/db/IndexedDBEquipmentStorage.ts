import type { EquipmentStorageAdapter, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { storageService, type StorageService } from '@/services/storage';

/**
 * IndexedDB Equipment Storage Adapter
 *
 * Implements EquipmentStorageAdapter using StorageService to persist
 * user-defined custom equipment in the browser's 'equipment' object store.
 */
export class IndexedDBEquipmentStorage implements EquipmentStorageAdapter {
  private _db?: StorageService;
  constructor(db?: StorageService) {
    this._db = db;
  }
  private get db(): StorageService {
    return this._db ?? storageService;
  }
  async load(): Promise<IEquipment[]> {
    return this.db.getAllEquipment();
  }

  async save(equipment: IEquipment): Promise<void> {
    await this.db.saveEquipment(equipment);
  }

  async delete(slug: string): Promise<void> {
    await this.db.deleteEquipment(slug);
  }
}

export const indexedDBEquipmentStorage = new IndexedDBEquipmentStorage();
