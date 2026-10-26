import type { ContentProviderMode, NoteSaveInput, NoteRecordPatch } from '../../types/content-provider';
import type { HistoryRecord, HistoryQuery } from '../../types/history';
import { IndexedDBContentProvider } from './IndexedDBContentProvider';
import { StorageService } from '../storage/StorageService';
import { InMemoryStorage } from '../storage/InMemoryStorage';

export class MockContentProvider extends IndexedDBContentProvider {
  override readonly mode: ContentProviderMode = 'static';
  readonly persistenceReady: Promise<void>;

  constructor(initialEntries: HistoryRecord[] = []) {
    const service = new StorageService(new InMemoryStorage());
    super(service);
    this.persistenceReady = (async () => {
      const provider = new IndexedDBContentProvider(service);
      for (const entry of initialEntries) {
        const saved = await provider.saveRecord({ ...entry, sourceRevision: 0 });
        for (const session of entry.extendedResults ?? []) await service.saveSession(session);
        for (const attachment of entry.attachments ?? []) await service.saveAttachment(attachment);
        if (entry.results) {
          const block = Object.values(saved.blocks ?? {}).find(block => block.kind === 'wod');
          if (!block) throw new Error('Mock result requires a workout occurrence');
          await provider.updateRecord(saved.id, { results: entry.results, blockId: block.id, blockVersion: block.version });
        }
      }
    })();
  }

  override async getRecords(query?: HistoryQuery): Promise<HistoryRecord[]> {
    await this.persistenceReady;
    return super.getRecords(query);
  }

  override async getPageRecords(slug: string): Promise<HistoryRecord[]> {
    await this.persistenceReady;
    return super.getPageRecords(slug);
  }

  override async getRecord(id: string): Promise<HistoryRecord | null> {
    await this.persistenceReady;
    return super.getRecord(id);
  }

  override async saveRecord(entry: NoteSaveInput): Promise<HistoryRecord> {
    await this.persistenceReady;
    return super.saveRecord(entry);
  }

  override async updateRecord(id: string, patch: NoteRecordPatch): Promise<HistoryRecord> {
    await this.persistenceReady;
    return super.updateRecord(id, patch);
  }

  override async cloneRecord(sourceId: string, targetDate?: number): Promise<HistoryRecord> {
    await this.persistenceReady;
    const source = await super.getRecord(sourceId);
    if (!source) throw new Error(`Entry ${sourceId} not found`);
    const cloned = await super.cloneRecord(sourceId, targetDate);
    return super.updateRecord(cloned.id, { title: `${source.title} (Copy)` });
  }

  override async deleteRecord(id: string): Promise<void> {
    await this.persistenceReady;
    await super.deleteRecord(id);
  }
}
