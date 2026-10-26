import type { ContentProviderMode, NoteSaveInput, NoteRecordPatch } from '../../types/content-provider';
import type { HistoryRecord, HistoryQuery, ProviderCapabilities } from '../../types/history';
import { IndexedDBContentProvider } from './IndexedDBContentProvider';
import { StorageService } from '../storage/StorageService';
import { InMemoryStorage } from '../storage/InMemoryStorage';

export class StaticContentProvider extends IndexedDBContentProvider {
  override readonly mode: ContentProviderMode = 'static';
  override readonly capabilities: ProviderCapabilities = {
    canWrite: true, canDelete: false, canFilter: false, canMultiSelect: false, supportsHistory: true,
  };
  readonly persistenceReady: Promise<HistoryRecord>;
  private readonly singletonId = 'static';

  constructor(initialContent: string) {
    const service = new StorageService(new InMemoryStorage());
    super(service);
    this.persistenceReady = new IndexedDBContentProvider(service).saveRecord({ id: this.singletonId,
      title: 'Untitled Workout', rawContent: initialContent, tags: [], targetDate: Date.now(), type: 'note' });
  }

  override async getRecords(_query?: HistoryQuery): Promise<HistoryRecord[]> {
    await this.persistenceReady;
    const entry = await super.getRecord(this.singletonId);
    return entry ? [entry] : [];
  }

  override async getRecord(_id: string): Promise<HistoryRecord | null> {
    await this.persistenceReady;
    return super.getRecord(this.singletonId);
  }

  override async saveRecord(entry: NoteSaveInput): Promise<HistoryRecord> {
    await this.persistenceReady;
    const previous = await super.getRecord(this.singletonId);
    return super.saveRecord({ ...entry, id: this.singletonId,
      targetDate: entry.targetDate ?? previous?.targetDate ?? Date.now(),
      sourceRevision: entry.sourceRevision });
  }

  override async updateRecord(_id: string, patch: NoteRecordPatch): Promise<HistoryRecord> {
    await this.persistenceReady;
    return super.updateRecord(this.singletonId, patch);
  }

  override async cloneRecord(_sourceId: string, _targetDate?: number): Promise<HistoryRecord> {
    const entry = await this.getRecord(this.singletonId);
    if (!entry) throw new Error('Static Note not found');
    return entry;
  }

  override async deleteRecord(_id: string): Promise<void> {}
}
