import { describe, expect, it } from 'bun:test';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';
import { InMemoryStorage } from '../../storage/InMemoryStorage';
import { StorageService } from '../../storage/StorageService';
import type { Note } from '@/types/storage';
import type { DomainDetail, DomainQuery } from '@bitcobblers/wod-wiki-storage';

const T0 = Date.UTC(2026, 5, 1);
const T1 = Date.UTC(2026, 5, 2);

describe('whole Note list reads', () => {
  it('uses exact current source and inclusive date or createdAt fallback', async () => {
    const service = new StorageService(new InMemoryStorage());
    for (const note of [
      { id: 'dated', createdAt: T0, date: T1 },
      { id: 'fallback', createdAt: T1 },
      { id: 'early', createdAt: T1 - 1 },
      { id: 'late', createdAt: T1 + 1 },
    ]) await service.saveNote({ ...note, title: note.id, rawContent: `Exact ${note.id}\r\n`, blocks: {}, sourceRevision: 1 });
    const provider = new IndexedDBContentProvider(service);
    const entries = await provider.getRecords({ dateRange: { start: T1, end: T1 } });
    expect(entries.map(entry => entry.id).sort()).toEqual(['dated', 'fallback']);
    expect(entries.every(entry => entry.rawContent === `Exact ${entry.id}\r\n`)).toBe(true);
  });

  it('projects independent named and calendar placements and tag conjunction', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const saved = await provider.saveRecord({ title: 'Shared', rawContent: 'Prose', tags: ['a', 'b'],
      targetDate: T1, journalDate: '2026-06-02', slug: 'gym' });
    await provider.saveRecord({ title: 'Other', rawContent: 'Other', tags: ['a'], targetDate: T1 });
    const entries = await provider.getRecords({ tags: ['a', 'b'] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: saved.id, journalDate: '2026-06-02', slug: 'gym', rawContent: 'Prose' });
  });

  it('reads remote entries without direct stores or source reconstruction', async () => {
    const note: Note = { id: 'remote', title: 'Remote', rawContent: 'Exact remote\r\n',
      sourceRevision: 1, blocks: {}, createdAt: T1 };
    const row: DomainDetail = { note, tags: [{ id: 't', label: 'remote-tag', createdAt: T0 }], links: [], pages: [] };
    const service = new StorageService(new InMemoryStorage());
    const plans: DomainQuery[] = [];
    service.queryDomain = async query => {
      plans.push(query);
      return { plan: 'detail', rows: [row], selectedCount: 1, matchedCount: 1, projectionVersion: 2 };
    };
    service.getAllNotes = async () => { throw new Error('Unexpected fallback'); };
    const entries = await new IndexedDBContentProvider(service).getRecords({ tags: ['remote-tag'] });
    expect(entries[0]?.rawContent).toBe(note.rawContent);
    expect(plans[0]?.selection).toEqual([{ field: 'tags', values: ['remote-tag'] }]);
  });
});
