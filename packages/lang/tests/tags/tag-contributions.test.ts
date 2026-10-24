import { describe, expect, it } from 'vitest';
import { createTagIndex, type TagDefinition } from '@bitcobblers/wod-wiki-core';
import { findTagContributionCycles, resolveTagContributions } from '../../src/tags/TagContributions';

function index(tags: readonly TagDefinition[]) {
    return createTagIndex(tags);
}

describe('resolving tag contributions', () => {
    it('resolves nothing for a tag the catalogue does not know', () => {
        const resolved = resolveTagContributions(index([]), 'nope');
        expect(resolved.metrics).toEqual([]);
        expect(resolved.functions).toEqual([]);
        expect(resolved.tags).toEqual([]);
    });

    it('resolves the metrics a tag carries', () => {
        const resolved = resolveTagContributions(
            index([
                {
                    slug: 'heavy',
                    contributions: [{ kind: 'metric', type: 'intensity', value: 'heavy', unit: 'text' }],
                },
            ]),
            'heavy',
        );
        expect(resolved.metrics).toEqual([
            { kind: 'metric', type: 'intensity', value: 'heavy', unit: 'text' },
        ]);
        expect(resolved.tags).toEqual(['heavy']);
    });

    it('resolves the tags a tag applies', () => {
        const resolved = resolveTagContributions(
            index([
                { slug: 'heavy', contributions: [{ kind: 'tag', slug: 'strength' }] },
                {
                    slug: 'strength',
                    contributions: [{ kind: 'metric', type: 'discipline', value: 'strength' }],
                },
            ]),
            'heavy',
        );
        expect(resolved.metrics).toEqual([
            { kind: 'metric', type: 'discipline', value: 'strength' },
        ]);
        expect(resolved.tags).toEqual(['heavy', 'strength']);
    });

    it('collects the functions a tag carries without duplicates', () => {
        const resolved = resolveTagContributions(
            index([
                {
                    slug: 'heavy',
                    contributions: [
                        { kind: 'function', name: 'e1rm' },
                        { kind: 'function', name: 'e1rm' },
                    ],
                },
            ]),
            'heavy',
        );
        expect(resolved.functions).toEqual(['e1rm']);
    });

    it('stops at a cycle instead of looping', () => {
        const resolved = resolveTagContributions(
            index([
                {
                    slug: 'a',
                    contributions: [
                        { kind: 'tag', slug: 'b' },
                        { kind: 'metric', type: 'a', value: 1 },
                    ],
                },
                {
                    slug: 'b',
                    contributions: [
                        { kind: 'tag', slug: 'a' },
                        { kind: 'metric', type: 'b', value: 2 },
                    ],
                },
            ]),
            'a',
        );
        expect(resolved.metrics).toEqual([
            { kind: 'metric', type: 'a', value: 1 },
            { kind: 'metric', type: 'b', value: 2 },
        ]);
        expect(resolved.tags).toEqual(['a', 'b']);
    });

    it('contributes a tag once when two tags apply it', () => {
        const resolved = resolveTagContributions(
            index([
                {
                    slug: 'root',
                    contributions: [
                        { kind: 'tag', slug: 'left' },
                        { kind: 'tag', slug: 'right' },
                    ],
                },
                {
                    slug: 'left',
                    contributions: [{ kind: 'metric', type: 'shared', value: 'once' }],
                },
                {
                    slug: 'right',
                    contributions: [{ kind: 'tag', slug: 'left' }],
                },
            ]),
            'root',
        );
        expect(resolved.metrics).toEqual([
            { kind: 'metric', type: 'shared', value: 'once' },
        ]);
    });
});

describe('finding tag cycles', () => {
    it('finds no cycle in a straight catalogue', () => {
        const cycles = findTagContributionCycles(
            index([
                { slug: 'a', contributions: [{ kind: 'tag', slug: 'b' }] },
                { slug: 'b', contributions: [] },
            ]),
        );
        expect(cycles).toEqual([]);
    });

    it('reports a cycle once', () => {
        const cycles = findTagContributionCycles(
            index([
                { slug: 'a', contributions: [{ kind: 'tag', slug: 'b' }] },
                { slug: 'b', contributions: [{ kind: 'tag', slug: 'a' }] },
            ]),
        );
        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toEqual(['a', 'b', 'a']);
    });

    it('reports a tag that applies itself', () => {
        const cycles = findTagContributionCycles(
            index([{ slug: 'a', contributions: [{ kind: 'tag', slug: 'a' }] }]),
        );
        expect(cycles).toEqual([['a', 'a']]);
    });
});
