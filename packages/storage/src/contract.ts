/**
 * IStorage — backend-neutral storage contract (moved verbatim from
 * apps/playground/src/services/storage/IStorage.ts). Implemented by
 * IndexedDBStorage / InMemoryStorage in the app and ApiStorage here.
 */

import type {
  Attachment,
  BlockEffort,
  BlockEquipment,
  BlockIndexRow,
  EventRecord,
  Membership,
  Note,
  BlockRevision,
  NoteTag,
  Page,
  PageNote,
  Session,
  Tag,
  TagTypeRecord,
} from './entities';
import type {
  CatalogBackfillState,
  FieldCatalogEntry,
  FieldSourceRecord,
  FieldValueRecord,
} from '@bitcobblers/wod-wiki-core';
import type { IEffort, IEquipment } from '@bitcobblers/wod-wiki-lang';
import type { DomainQuery, DomainQueryResult } from './domain';

export interface StorageSchema {
  notes: Note;
  page: Page;
  page_notes: PageNote;
  tags: Tag;
  tag_types: TagTypeRecord;
  note_tags: NoteTag;
  block_revisions: BlockRevision;
  sessions: Session;
  attachments: Attachment;
  events: EventRecord;
  field_catalog: FieldCatalogEntry;
  field_sources: FieldSourceRecord;
  field_values: FieldValueRecord;
  field_catalog_meta: CatalogBackfillState;
  efforts: IEffort;
  equipment: IEquipment;
  block_index: BlockIndexRow;
  block_efforts: BlockEffort;
  block_equipment: BlockEquipment;
  meta: unknown;
  memberships: Membership;
}

export type StoreName = keyof StorageSchema;
export type StoreType<K extends StoreName> = StorageSchema[K];

export interface IReadOnlyStore<T> {
  get(key: IDBValidKey): Promise<T | undefined>;
  getMany(keys: IDBValidKey[]): Promise<(T | undefined)[]>;
  getAll(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]>;
  getAllFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]>;
  getAllFromIndexMany(indexName: string, keys: IDBValidKey[]): Promise<T[][]>;
  count(query?: IDBValidKey | IDBKeyRange): Promise<number>;
  countFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange): Promise<number>;
}

export interface IReadWriteStore<T> extends IReadOnlyStore<T> {
  put(value: T, key?: IDBValidKey): Promise<IDBValidKey>;
  putMany(values: T[], keys?: IDBValidKey[]): Promise<IDBValidKey[]>;
  delete(key: IDBValidKey | IDBKeyRange): Promise<void>;
  clear(): Promise<void>;
}

export interface IStorageTransaction {
  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>>;
  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>>;
}

export interface IStorage {
  queryDomain?(query: DomainQuery): Promise<DomainQueryResult | undefined>;
  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>>;
  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>>;
  transaction<K extends StoreName, R>(
    stores: K[],
    mode: 'readonly' | 'readwrite',
    fn: (tx: IStorageTransaction) => Promise<R>
  ): Promise<R>;
  wipe(): Promise<void>;
  close(): Promise<void>;
}
