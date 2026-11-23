import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { buildQueryServiceStoresFromStorage } from '../src/storage/queryServiceStores';

describe('buildQueryServiceStoresFromStorage — bulk relation batching (WW-036)', () => {
  it('fetches tags, efforts, equipment, placements, and typed tags for multiple notes in a single batch', async () => {
    const client = createClient({ url: ':memory:' });
    const storage = new SqlStorage(libsqlDatabase(client));

    await storage.transaction(
      ['tags', 'note_tags', 'block_efforts', 'block_equipment', 'page', 'page_notes'],
      'readwrite',
      async (tx) => {
        await tx.readwrite('tags').put({
          id: 't-strength',
          label: 'strength',
          contributions: [],
          createdAt: 1000,
        });
        await tx.readwrite('note_tags').put({
          id: 'nt-1',
          noteId: 'n-1',
          tagId: 't-strength',
          type: 'tag',
          label: 'strength',
          createdAt: 1000,
        });
        await tx.readwrite('block_efforts').put({
          id: 'be-1',
          noteId: 'n-1',
          blockId: 'b1',
          effortSlug: 'thruster',
          createdAt: 1000,
        });
        await tx.readwrite('block_equipment').put({
          id: 'beq-1',
          noteId: 'n-1',
          blockId: 'b1',
          equipmentSlug: 'barbell',
          createdAt: 1000,
        });
        await tx.readwrite('page').put({
          id: 'p-1',
          slug: 'open-2026',
          createdAt: 1000,
          updatedAt: 1000,
        });
        await tx.readwrite('page_notes').put({
          id: 'pn-1',
          pageId: 'p-1',
          noteId: 'n-1',
          order: 0,
          createdAt: 1000,
        });
      },
    );

    const stores = buildQueryServiceStoresFromStorage(storage);
    const batches = await stores.relationStore!.getBatches(['n-1', 'n-missing']);
    expect(batches.size).toBe(2);

    const n1 = batches.get('n-1')!;
    expect(n1.tags).toEqual([{ label: 'strength' }]);
    expect(n1.links).toHaveLength(1);
    expect(n1.pages).toHaveLength(1);
    expect(n1.pages[0]!.slug).toBe('open-2026');

    const empty = batches.get('n-missing')!;
    expect(empty.tags).toEqual([]);
    expect(empty.links).toEqual([]);
    expect(empty.pages).toEqual([]);
  });
});
