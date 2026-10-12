import { describe, expect, it } from 'bun:test';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';
import { InMemoryStorage } from '../../storage/InMemoryStorage';
import { StorageService } from '../../storage/StorageService';
import { parseDashboardNote } from '@bitcobblers/wod-wiki-wql';

describe('whole Note provider', () => {
  it('stores prose as source, indexes only registered actionable blocks and preserves metadata', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const rawContent = '---\ntags: [benchmark]\n---\n# Heading\n\nParagraph\n\n```time\n10 Pushups\n```\n\n```query\n:note{}\n```\n\n```widget:attention\n{"headline":"Tip"}\n```\n\n```widget:unknown\n{}\n```';
    const entry = await provider.saveEntry({ title: 'Workout', rawContent, tags: ['manual'], targetDate: 1, sourceId: 'origin' });
    expect((await service.getNote(entry.id))?.rawContent).toBe(rawContent);
    expect(Object.values(entry.blocks!).map(block => block.kind)).toEqual(['wod', 'query', 'widget']);
    expect((await service.getBlockIndexByNote(entry.id)).sort((a, b) => a.position - b.position).map(row => row.dataType)).toEqual(['wod', 'query', 'widget']);
    expect(entry.tags.sort()).toEqual(['benchmark', 'manual']);
    expect(entry.sourceId).toBe('origin');
  });

  it('keeps manual tags separate from authored frontmatter and retains untyped additions', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const entry = await provider.saveEntry({ title: 'Tags', rawContent: '---\ntags: [crossfit]\n---\nProse', tags: ['manual'], targetDate: 1 });
    const updated = await provider.updateEntry(entry.id, { rawContent: '---\ntags: [hero]\n---\nProse',
      expectedSourceRevision: entry.sourceRevision, blocks: {} });
    expect(updated.tags.sort()).toEqual(['hero', 'manual']);
    expect(updated.rawContent).not.toContain('manual');
  });

  it('reopens dashboard frontmatter verbatim without persisted frontmatter blocks', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const rawContent = '---\ndashboard: "true"\ntitle: My dashboard\n---\n\n```query\n:note{}\n```';
    const entry = await provider.saveEntry({ title: 'Dashboard', rawContent, tags: [], targetDate: 1 });
    const reopened = await provider.getEntry(entry.id);
    expect(reopened?.rawContent).toBe(rawContent);
    expect(parseDashboardNote(reopened!.rawContent)).toBeDefined();
    expect(Object.values(entry.blocks!).map(block => block.kind)).toEqual(['query']);
  });
});
