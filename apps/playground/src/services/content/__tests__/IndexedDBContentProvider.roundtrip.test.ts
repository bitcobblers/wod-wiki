import { describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks, mapNoteBlockChanges } from '@bitcobblers/wod-wiki-core';
import { InMemoryStorage } from '../../storage/InMemoryStorage';
import { StorageService } from '../../storage/StorageService';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';

describe('whole Note source roundtrip', () => {
  it('preserves exact authored bytes and persisted identities on reopen', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const rawContent = '\uFEFF---\r\ntitle: Exact\r\n---\r\n# Heading  \r\n\r\n```TiMe:CrossFit extra-info  \r\n10 Pushups  \r\n```  \r\n\t';
    const saved = await provider.saveRecord({ title: 'Exact', rawContent, tags: ['manual'], targetDate: 1 });
    const reopened = await new IndexedDBContentProvider(service).getRecord(saved.id);
    expect(reopened?.rawContent).toBe(rawContent);
    expect(reopened?.blocks).toEqual(saved.blocks);
    expect(reopened?.sourceRevision).toBe(1);
    expect(reopened?.tags).toContain('manual');
    expect((await provider.getRecords())[0]?.rawContent).toBe(rawContent);
  });

  it('retains source for empty and prose-only documents without actionable history', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    let saved = await provider.saveRecord({ title: 'Prose', rawContent: '  \r\n\r\n', tags: [], targetDate: 1 });
    for (const rawContent of ['', '# Prose\n\nUnknown ``` text', '```unknown\nrecoverable\n```\n']) {
      saved = await provider.updateRecord(saved.id, { rawContent, blocks: {}, expectedSourceRevision: saved.sourceRevision });
      expect((await provider.getRecord(saved.id))?.rawContent).toBe(rawContent);
      expect(saved.blocks).toEqual({});
    }
    expect(await service.getNoteBlockHistory(saved.id)).toEqual([]);
  });

  it('adds placements without affecting sibling Notes, source or history', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const source = '```time\n10 Pushups\n```\n';
    const a = await provider.saveRecord({ title: 'A', rawContent: source, tags: ['manual'], targetDate: 1, journalDate: '2026-10-15', slug: 'gym' });
    const b = await provider.saveRecord({ title: 'B', rawContent: 'Prose', tags: [], targetDate: 1, journalDate: '2026-10-15', slug: 'gym' });
    const history = await service.getNoteBlockHistory(a.id);
    // A journalDate/slug patch ATTACHES — it never detaches the note from
    // the pages it is already on, so the primary projections stay the
    // first-created placements while the new pages join the membership.
    const moved = await provider.updateRecord(a.id, { journalDate: '2026-10-16', slug: 'travel', type: 'journal', sourceId: null });
    expect(moved.rawContent).toBe(source);
    expect(moved.blocks).toEqual(a.blocks);
    expect(moved.journalDate).toBe('2026-10-15');
    expect(moved.slug).toBe('gym');
    expect(moved.placements?.map((placement) => placement.date ?? placement.slug).sort())
      .toEqual(['2026-10-15', '2026-10-16', 'gym', 'travel']);
    expect(await service.getNoteBlockHistory(a.id)).toEqual(history);
    expect((await provider.getRecord(b.id))?.slug).toBe('gym');
    expect((await provider.getRecord(b.id))?.journalDate).toBe('2026-10-15');
    const clone = await provider.cloneRecord(a.id);
    expect(Object.keys(clone.blocks!)).not.toEqual(Object.keys(a.blocks!));
    expect(clone.rawContent).toBe(source);
    expect(clone.sourceId).toBe(a.id);
  });

  it('preserves saved version when draft changes return to the original before save', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const rawContent = '```time\n10 Pushups\n```';
    const saved = await provider.saveRecord({ title: 'Workout', rawContent, tags: [], targetDate: 1 });
    const mapped = mapNoteBlockChanges(saved.blocks!, [{ from: 8, to: 10, insert: '20' }]);
    const edited = reconcileNoteBlocks(rawContent.replace('10', '20'), { blocks: mapped, sourceRevision: 1 });
    const back = reconcileNoteBlocks(rawContent, { blocks: edited, sourceRevision: 1 });
    const unchanged = await provider.updateRecord(saved.id, { rawContent, blocks: back, expectedSourceRevision: 1 });
    expect(unchanged.sourceRevision).toBe(1);
    expect((await service.getNoteBlockHistory(saved.id)).map(row => row.version)).toEqual([1]);
  });
});
