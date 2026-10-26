import type { ContentProviderMode, NoteSaveInput, NoteEntryPatch } from '../../types/content-provider';
import type { HistoryEntry, EntryQuery } from '../../types/history';
import { IndexedDBContentProvider } from './IndexedDBContentProvider';
import { StorageService } from '../storage/StorageService';
import { InMemoryStorage } from '../storage/InMemoryStorage';

export class MockContentProvider extends IndexedDBContentProvider {
  override readonly mode: ContentProviderMode = 'static';
  readonly persistenceReady: Promise<void>;

  constructor(initialEntries: HistoryEntry[] = []) {
    const service = new StorageService(new InMemoryStorage());
    super(service);
    this.persistenceReady = (async () => {
      const provider = new IndexedDBContentProvider(service);
      for (const entry of initialEntries) {
        const saved = await provider.saveEntry({ ...entry, sourceRevision: 0 });
        for (const session of entry.extendedResults ?? []) await service.saveSession(session);
        for (const attachment of entry.attachments ?? []) await service.saveAttachment(attachment);
        if (entry.results) {
          const block = Object.values(saved.blocks ?? {}).find(block => block.kind === 'wod');
          if (!block) throw new Error('Mock result requires a workout occurrence');
          await provider.updateEntry(saved.id, { results: entry.results, blockId: block.id, blockVersion: block.version });
        }
      }
    })();
  }

  override async getEntries(query?: EntryQuery): Promise<HistoryEntry[]> {
    await this.persistenceReady;
    return super.getEntries(query);
  }

  override async getPageEntries(slug: string): Promise<HistoryEntry[]> {
    await this.persistenceReady;
    return super.getPageEntries(slug);
  }

  override async getEntry(id: string): Promise<HistoryEntry | null> {
    await this.persistenceReady;
    return super.getEntry(id);
  }

  override async saveEntry(entry: NoteSaveInput): Promise<HistoryEntry> {
    await this.persistenceReady;
    return super.saveEntry(entry);
  }

  override async updateEntry(id: string, patch: NoteEntryPatch): Promise<HistoryEntry> {
    await this.persistenceReady;
    return super.updateEntry(id, patch);
  }

  override async cloneEntry(sourceId: string, targetDate?: number): Promise<HistoryEntry> {
    await this.persistenceReady;
    const source = await super.getEntry(sourceId);
    if (!source) throw new Error(`Entry ${sourceId} not found`);
    const cloned = await super.cloneEntry(sourceId, targetDate);
    return super.updateEntry(cloned.id, { title: `${source.title} (Copy)` });
  }

  override async deleteEntry(id: string): Promise<void> {
    await this.persistenceReady;
    await super.deleteEntry(id);
  }
}
