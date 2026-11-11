import type { EquipmentStorageAdapter, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { storageService, type StorageService } from '@/services/storage';
import { mergeCustomOverridesIntoList } from './mergeCustomOverrides';

export class IndexedDBEquipmentStorage implements EquipmentStorageAdapter {
  private _db?: StorageService;
  constructor(db?: StorageService) {
    this._db = db;
  }
  private get db(): StorageService {
    return this._db ?? storageService;
  }
  async load(): Promise<IEquipment[]> {
    const base = await this.db.getAllEquipment();
    return mergeCustomOverridesIntoList(this.db.storage, 'equipment', base);
  }

  async save(equipment: IEquipment): Promise<void> {
    await this.db.saveEquipment(equipment);
  }

  async delete(slug: string): Promise<void> {
    await this.db.deleteEquipment(slug);
  }
}

export const indexedDBEquipmentStorage = new IndexedDBEquipmentStorage();
