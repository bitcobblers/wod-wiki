import { describe, expect, it } from 'bun:test';
import { buildTagDefinitions, getTagIndex, setTagIndex } from '@/services/tags/tagCatalogue';

describe('tag catalogue', () => {
    it('takes a tag\'s slug from its label', () => {
        const definitions = buildTagDefinitions([{ id: 't1', label: 'heavy', createdAt: 0 }]);
        expect(definitions[0].slug).toBe('heavy');
    });

    it('keeps the contributions a tag carries', () => {
        const definitions = buildTagDefinitions([
            {
                id: 't1',
                label: 'heavy',
                createdAt: 0,
                contributions: [
                    { kind: 'metric', type: 'intensity', value: 'heavy' },
                    { kind: 'function', name: 'e1rm' },
                ],
            },
        ]);
        expect(definitions[0].contributions).toEqual([
            { kind: 'metric', type: 'intensity', value: 'heavy' },
            { kind: 'function', name: 'e1rm' },
        ]);
    });

    it('infers the sound profile a sound tag names', () => {
        const definitions = buildTagDefinitions([{ id: 't1', label: 'sound-classic', createdAt: 0 }]);
        expect(definitions[0].contributions).toEqual([
            { kind: 'metric', type: 'sound', value: 'classic' },
        ]);
    });

    it('resolves a tag by slug', () => {
        setTagIndex([{ id: 't1', label: 'heavy', createdAt: 0 }]);
        expect(getTagIndex().resolve('heavy')?.slug).toBe('heavy');
        expect(getTagIndex().resolve('nope')).toBeUndefined();
    });
});
