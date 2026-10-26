import { describe, it, expect } from 'bun:test';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';
import { StorageService } from '../../storage/StorageService';
import { InMemoryStorage } from '../../storage/InMemoryStorage';

function setup() {
    return new IndexedDBContentProvider(new StorageService(new InMemoryStorage()));
}

describe('Note Management', () => {
    it('saves a starter note in defaults and reads it back', async () => {
        const provider = setup();
        const entry = await provider.saveEntry({ title: 'My Starter', rawContent: '# Starter',
            tags: ['starter'], type: 'note', targetDate: 1 });
        expect(entry.type).toBe('note');
        expect(entry.id).toBeDefined();
        expect((await provider.getEntry(entry.id))?.type).toBe('note');
    });

    it('clones a starter note into a journal note with fresh workout occurrences', async () => {
        const provider = setup();
        const starter = await provider.saveEntry({ title: 'Benchmark WOD', rawContent: '```time\n21-15-9 Thrusters\n```',
            tags: ['benchmark'], type: 'note', targetDate: 1 });
        const cloned = await provider.cloneEntry(starter.id);
        expect(cloned.id).not.toBe(starter.id);
        expect(cloned.sourceId).toBe(starter.id);
        expect(cloned.type).toBe('journal');
        expect(cloned.title).toBe('Benchmark WOD');
        expect(cloned.rawContent).toBe(starter.rawContent);
        expect(Object.keys(cloned.blocks ?? {})).not.toEqual(Object.keys(starter.blocks ?? {}));
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
