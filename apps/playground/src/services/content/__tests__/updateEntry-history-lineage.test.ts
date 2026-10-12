import { describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks, mapNoteBlockChanges } from '@bitcobblers/wod-wiki-core';
import { InMemoryStorage } from '../../storage/InMemoryStorage';
import { StorageService } from '../../storage/StorageService';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';

const SOURCE = '# Workout\n\n```time\n10 Pushups\n```\n';

describe('saved actionable occurrence lineage', () => {
  it('retains never-run states, monotonic revert and removed block history', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    let saved = await provider.saveEntry({ title: 'Workout', rawContent: SOURCE, targetDate: 1, tags: [] });
    const id = Object.keys(saved.blocks!)[0]!;
    const original = saved.blocks![id]!;
    const updated = SOURCE.replace('10 Pushups', '20 Pushups');
    const blocks = { [id]: { ...original, to: original.to } };
    saved = await provider.updateEntry(saved.id, { rawContent: updated, blocks,
      expectedSourceRevision: saved.sourceRevision });
    expect((await service.getBlockHistory(saved.id, id)).map(row => row.version)).toEqual([1, 2]);
    expect(await service.getSessionsForNote(saved.id)).toEqual([]);
    saved = await provider.updateEntry(saved.id, { rawContent: SOURCE, blocks: saved.blocks,
      expectedSourceRevision: saved.sourceRevision });
    expect(saved.blocks![id]!.version).toBe(3);
    saved = await provider.updateEntry(saved.id, { rawContent: '# Workout\n', blocks: {},
      expectedSourceRevision: saved.sourceRevision });
    expect(await service.getBlockIndexByNote(saved.id)).toEqual([]);
    expect((await service.getNoteBlockHistory(saved.id)).map(row => row.version)).toEqual([1, 2, 3]);
    await provider.deleteEntry(saved.id);
    expect(await provider.getEntry(saved.id)).toBeNull();
    expect((await service.getBlockHistory(saved.id, id)).map(row => row.rawContent)).toEqual([
      SOURCE.slice(original.from, original.to), updated.slice(original.from, original.to), SOURCE.slice(original.from, original.to),
    ]);
  });

  it('prose moves preserve occurrence history and effort relationship keys', async () => {
    const storage = new InMemoryStorage();
    const service = new StorageService(storage);
    const provider = new IndexedDBContentProvider(service);
    const saved = await provider.saveEntry({ title: 'Workout', rawContent: SOURCE, targetDate: 1, tags: [] });
    const revisions = await service.getNoteBlockHistory(saved.id);
    const efforts = await storage.readonly('block_efforts').getAll();
    const prefix = 'Prose before\n\n';
    const rawContent = prefix + SOURCE;
    const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: saved.sourceRevision!,
      blocks: mapNoteBlockChanges(saved.blocks!, [{ from: 0, to: 0, insert: prefix }]) });
    const moved = await provider.updateEntry(saved.id, { rawContent, blocks, expectedSourceRevision: saved.sourceRevision });
    expect(Object.keys(moved.blocks!)).toEqual(Object.keys(saved.blocks!));
    expect(await service.getNoteBlockHistory(saved.id)).toEqual(revisions);
    expect(await storage.readonly('block_efforts').getAll()).toEqual(efforts);
  });
});
