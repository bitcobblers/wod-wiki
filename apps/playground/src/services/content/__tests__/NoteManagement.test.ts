import { describe, it, expect } from 'bun:test';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';
import { StorageService } from '../../storage/StorageService';
import { InMemoryStorage } from '../../storage/InMemoryStorage';

function setup() {
    return new IndexedDBContentProvider(new StorageService(new InMemoryStorage()));
}

describe('Note Management', () => {
    it('saves a template entry', async () => {
        const provider = setup();
        const entry = await provider.saveEntry({ title: 'My Template', rawContent: '# Template',
            tags: ['template'], type: 'template', targetDate: 1 });
        expect(entry.type).toBe('template');
        expect(entry.id).toBeDefined();
        expect((await provider.getEntry(entry.id))?.type).toBe('template');
    });

    it('clones a template into a note with fresh workout occurrences', async () => {
        const provider = setup();
        const template = await provider.saveEntry({ title: 'Benchmark WOD', rawContent: '```time\n21-15-9 Thrusters\n```',
            tags: ['benchmark'], type: 'template', targetDate: 1 });
        const cloned = await provider.cloneEntry(template.id);
        expect(cloned.id).not.toBe(template.id);
        expect(cloned.sourceId).toBe(template.id);
        expect(cloned.type).toBe('journal');
        expect(cloned.title).toBe('Benchmark WOD');
        expect(cloned.rawContent).toBe(template.rawContent);
        expect(Object.keys(cloned.blocks ?? {})).not.toEqual(Object.keys(template.blocks ?? {}));
        expect(new Date(cloned.targetDate).toDateString()).toBe(new Date().toDateString());
    });

    it('clones a note into another note for today', async () => {
        const provider = setup();
        const source = await provider.saveEntry({ title: 'Yesterday Run', rawContent: 'Run 5k',
            tags: [], type: 'note', targetDate: Date.now() - 86400000 });
        const cloned = await provider.cloneEntry(source.id);
        expect(cloned.sourceId).toBe(source.id);
        expect(cloned.type).toBe('journal');
        expect(new Date(cloned.targetDate).toDateString()).toBe(new Date().toDateString());
    });
});
