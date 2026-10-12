import type { ContentProviderMode, NoteSaveInput, NoteEntryPatch } from '../../types/content-provider';
import type { HistoryEntry, EntryQuery, ProviderCapabilities } from '../../types/history';
import { IndexedDBContentProvider } from './IndexedDBContentProvider';
import { StorageService } from '../storage/StorageService';
import { InMemoryStorage } from '../storage/InMemoryStorage';

export class StaticContentProvider extends IndexedDBContentProvider {
  override readonly mode: ContentProviderMode = 'static';
  override readonly capabilities: ProviderCapabilities = {
    canWrite: true, canDelete: false, canFilter: false, canMultiSelect: false, supportsHistory: true,
  };
  readonly persistenceReady: Promise<HistoryEntry>;
  private readonly singletonId = 'static';

  constructor(initialContent: string) {
    const service = new StorageService(new InMemoryStorage());
    super(service);
    this.persistenceReady = new IndexedDBContentProvider(service).saveEntry({ id: this.singletonId,
      title: 'Untitled Workout', rawContent: initialContent, tags: [], targetDate: Date.now(), type: 'template' });
  }

  override async getEntries(_query?: EntryQuery): Promise<HistoryEntry[]> {
    await this.persistenceReady;
    const entry = await super.getEntry(this.singletonId);
    return entry ? [entry] : [];
  }

  override async getEntry(_id: string): Promise<HistoryEntry | null> {
    await this.persistenceReady;
    return super.getEntry(this.singletonId);
  }

  override async saveEntry(entry: NoteSaveInput): Promise<HistoryEntry> {
    await this.persistenceReady;
    const previous = await super.getEntry(this.singletonId);
    return super.saveEntry({ ...entry, id: this.singletonId,
      targetDate: entry.targetDate ?? previous?.targetDate ?? Date.now(),
      sourceRevision: entry.sourceRevision });
  }

  override async updateEntry(_id: string, patch: NoteEntryPatch): Promise<HistoryEntry> {
    await this.persistenceReady;
    return super.updateEntry(this.singletonId, patch);
  }

  override async cloneEntry(_sourceId: string, _targetDate?: number): Promise<HistoryEntry> {
    const entry = await this.getEntry(this.singletonId);
    if (!entry) throw new Error('Static Note not found');
    return entry;
  }

  override async deleteEntry(_id: string): Promise<void> {}
}
