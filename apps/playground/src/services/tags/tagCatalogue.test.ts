import { describe, expect, it } from 'bun:test';
import { buildTagDefinitions, categoryDefinitionsFrom, getTagIndex, loadTagIndex, setTagIndex } from './tagCatalogue';
import type { Tag, TagTypeRecord } from '@bitcobblers/wod-wiki-core';
import { InMemoryStorage, resetStorageForTesting, setStorageForTesting, storageService } from '@/services/storage';
function tag(label: string, type?: string, contributions?: Tag['contributions']): Tag {
    return { id: `tag-${label}`, label, ...(type ? { type } : {}), ...(contributions ? { contributions } : {}), createdAt: 0 };
}

describe('tagCatalogue — category definitions', () => {
    it('projects TagTypeRecords into category definitions, defaulting empty contributions', () => {
        const records: TagTypeRecord[] = [
            { id: 'tt-1', name: 'equipment', label: 'Equipment', contributions: [{ kind: 'metric', type: 'resistance', value: 16, unit: 'kg' }], createdAt: 0 },
            { id: 'tt-2', name: 'domain', label: 'Domain', createdAt: 0 },
        ];

        const definitions = categoryDefinitionsFrom(records);
        expect(definitions).toHaveLength(2);
        expect(definitions[0]).toEqual({
            slug: 'equipment',
            isCategory: true,
            contributions: [{ kind: 'metric', type: 'resistance', value: 16, unit: 'kg' }],
        });
        expect(definitions[1]).toEqual({ slug: 'domain', isCategory: true, contributions: [] });
    });

    it('synthesizes the child→category edge from Tag.type and flags category rows', () => {
        const definitions = buildTagDefinitions([
            tag('equipment', 'category', [{ kind: 'metric', type: 'resistance', value: 16, unit: 'kg' }]),
            tag('kettlebell', 'equipment', [{ kind: 'metric', type: 'work', value: 'reps * resistance' }]),
        ]);

        const category = definitions.find((d) => d.slug === 'equipment');
        expect(category?.isCategory).toBe(true);

        const child = definitions.find((d) => d.slug === 'kettlebell');
        expect(child?.contributions.some((c) => c.kind === 'tag' && c.slug === 'equipment')).toBe(true);
        expect(child?.isCategory).toBeUndefined();
    });

    it('does not synthesize an edge when the typed category is unknown', () => {
        const definitions = buildTagDefinitions([tag('kettlebell', 'nonexistent-category')]);
        const child = definitions.find((d) => d.slug === 'kettlebell');
        expect(child?.contributions.some((c) => c.kind === 'tag')).toBe(false);
    });
});

describe('tagCatalogue — built-in fallback', () => {
    it('does not let an empty stored tonnage row erase built-in contributions', async () => {
        setStorageForTesting(new InMemoryStorage());
        await storageService.putTag(tag('tonnage'));
        try {
            const index = await loadTagIndex();
            expect(index.resolve('tonnage')?.contributions).toContainEqual({ kind: 'metric', type: 'work', value: 'reps * resistance' });
        } finally {
            resetStorageForTesting();
            setTagIndex([]);
        }
    });

    it('lets a non-empty stored tonnage override replace the built-in definition', async () => {
        setStorageForTesting(new InMemoryStorage());
        await storageService.putTag(tag('tonnage', undefined, [{ kind: 'metric', type: 'resistance', value: 32, unit: 'kg' }]));
        try {
            const index = await loadTagIndex();
            expect(index.resolve('tonnage')?.contributions).toEqual([{ kind: 'metric', type: 'resistance', value: 32, unit: 'kg' }]);
        } finally {
            resetStorageForTesting();
            setTagIndex([]);
        }
    });
});

describe('tagCatalogue — category-to-statement edges', () => {
    it('synthesizes child edges using TagTypeRecord categories, not only stored tag slugs', () => {
        const crossfit = tag('crossfit', 'domain');
        const domain: TagTypeRecord = {
            id: 'type-domain',
            name: 'domain',
            label: 'Domain',
            contributions: [{ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' }],
            createdAt: 0,
        };

        const definitions = buildTagDefinitions([crossfit], [domain]);
        const child = definitions.find((definition) => definition.slug === 'crossfit');
        expect(child?.contributions).toContainEqual({ kind: 'tag', slug: 'domain' });
    });

    it('resolves saved category metrics through the real storage index', async () => {
        setStorageForTesting(new InMemoryStorage());
        await storageService.putTagType({
            id: 'type-domain',
            name: 'domain',
            label: 'Domain',
            contributions: [{ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' }],
            createdAt: 0,
        });
        await storageService.putTag(tag('crossfit', 'domain'));
        try {
            const index = await loadTagIndex();
            const child = index.resolve('crossfit');
            expect(child?.contributions).toContainEqual({ kind: 'tag', slug: 'domain' });
            expect(index.resolve('domain')?.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
        } finally {
            resetStorageForTesting();
            setTagIndex([]);
        }
    });
});

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
