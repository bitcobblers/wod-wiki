import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { createTagIndex, getTagReference, MetricType } from '@bitcobblers/wod-wiki-core';
import { classifyStatements } from '../../src/parser/semantic-classifier';
import { extractSyntaxFacts } from '../../src/parser/syntax-parser';
import { whiteboardScript } from '../../src/parser/whiteboard-script-language';
import { tagMarkerType } from '../../src/tags/TagContributions';
import { createReferenceIndex } from '../../src/effort-registry/reference-resolution';

function parse(source: string, tags = createTagIndex([])) {
    const state = EditorState.create({ doc: source, extensions: [whiteboardScript()] });
    const facts = extractSyntaxFacts(state);
    return classifyStatements(facts, { index: createReferenceIndex({ efforts: [], equipment: [] }), tags });
}

describe('tag references', () => {
    it('records the tag a contributed metric came from', () => {
        const tags = createTagIndex([
            {
                slug: 'heavy',
                contributions: [{ kind: 'metric', type: 'intensity', value: 'heavy' }],
            },
        ]);

        const statements = parse('5 reps #{heavy}', tags);
        const contributed = statements[0].metrics.toArray().find(m => m.type === 'intensity');
        const reference = getTagReference(contributed?.metadata);

        expect(reference?.slug).toBe('heavy');
        expect(reference?.label).toBe('heavy');
    });

    it('records the functions a tag carries', () => {
        const tags = createTagIndex([
            { slug: 'power', contributions: [{ kind: 'function', name: 'power-calc' }] },
        ]);

        const statements = parse('5 reps #{power}', tags);
        const marker = statements[0].metrics.toArray().find(m => m.type === tagMarkerType('power'));
        const reference = getTagReference(marker?.metadata);

        expect(reference?.slug).toBe('power');
        expect(reference?.functions).toEqual(['power-calc']);
    });

    it('marks a sound tag with the profile it names', () => {
        const tags = createTagIndex([
            {
                slug: 'sound-classic',
                contributions: [{ kind: 'metric', type: MetricType.Sound, value: 'classic' }],
            },
        ]);

        const statements = parse('5 reps #{sound-classic}', tags);
        const marker = statements[0].metrics.toArray().find(m => m.type === tagMarkerType('sound-classic'));
        const reference = getTagReference(marker?.metadata);

        expect(reference?.soundProfileId).toBe('classic');
    });

    it('gives a tag a tag applies its own reference', () => {
        const tags = createTagIndex([
            { slug: 'heavy', contributions: [{ kind: 'tag', slug: 'strength' }] },
            {
                slug: 'strength',
                contributions: [{ kind: 'function', name: 'e1rm' }],
            },
        ]);

        const statements = parse('5 reps #{heavy}', tags);
        const marker = statements[0].metrics.toArray().find(m => m.type === tagMarkerType('strength'));

        expect(getTagReference(marker?.metadata)?.slug).toBe('strength');
        expect(getTagReference(marker?.metadata)?.functions).toEqual(['e1rm']);
    });
});
