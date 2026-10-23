import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { classifyStatements } from '../../src/parser/semantic-classifier';
import { extractSyntaxFacts } from '../../src/parser/syntax-parser';
import { createTagIndex, type TagDefinition, type TagIndex } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { whiteboardScript } from '../../src/parser/whiteboard-script-language';
import { createReferenceIndex } from '../../src/effort-registry/reference-resolution';
import { tagMarkerType } from '../../src/tags/TagContributions';

function buildState(doc: string): EditorState {
    return EditorState.create({
        doc,
        extensions: [whiteboardScript()],
    });
}

/**
 * Parse a script and return the metrics of its statements.
 */
function parseMetrics(source: string, tags?: TagIndex) {
    const state = buildState(source);
    const facts = extractSyntaxFacts(state);
    const references = {
        index: createReferenceIndex({ efforts: [], equipment: [] }),
        ...(tags ? { tags } : {}),
    };
    const statements = classifyStatements(facts, references);
    return statements.flatMap(s => s.metrics.toArray());
}

function tagIndex(tags: readonly TagDefinition[]): TagIndex {
    return createTagIndex(tags);
}

describe('tag references', () => {
    it('parses #tag-slug as a property value', () => {
        const metrics = parseMetrics('sound: #sound-classic');
        expect(metrics).toHaveLength(1);
        // Without a catalog the reference is kept verbatim, so an unresolved
        // reference stays visible rather than silently becoming a value.
        expect(metrics[0].value).toBe('#sound-classic');
    });

    it('contributes the metrics the tag is marked down with', () => {
        const tags = tagIndex([
            {
                slug: 'sound-classic',
                contributions: [{ kind: 'metric', type: MetricType.Sound, value: 'classic' }],
            },
        ]);
        const metrics = parseMetrics('sound: #sound-classic', tags);
        const contributed = metrics.find(m => m.type === MetricType.Sound);
        expect(contributed?.value).toBe('classic');
    });

    it('marks the statement with the tag that applied', () => {
        const tags = tagIndex([
            {
                slug: 'sound-classic',
                contributions: [{ kind: 'metric', type: MetricType.Sound, value: 'classic' }],
            },
        ]);
        const metrics = parseMetrics('sound: #sound-classic', tags);
        const marker = metrics.find(m => m.type === tagMarkerType('sound-classic'));
        expect(marker?.value).toBe('sound-classic');
    });

    it('stacks several tag references on one line', () => {
        const tags = tagIndex([
            {
                slug: 'sound-classic',
                contributions: [{ kind: 'metric', type: MetricType.Sound, value: 'classic' }],
            },
            {
                slug: 'sound-loud',
                contributions: [{ kind: 'metric', type: MetricType.Sound, value: 'loud' }],
            },
        ]);
        const metrics = parseMetrics('sound: #sound-classic #sound-loud', tags);
        const values = metrics.filter(m => m.type === MetricType.Sound).map(m => m.value);
        expect(values).toEqual(['classic', 'loud']);
    });

    it('keeps the literal reference when the tag is unknown', () => {
        const metrics = parseMetrics('sound: #nope');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].value).toBe('#nope');
    });

    it('leaves ordinary property values alone', () => {
        const metrics = parseMetrics('rpe: 8');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].value).toBe(8);
    });

    it('still parses a heading as a heading', () => {
        const metrics = parseMetrics('### Group A');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].type).toBe(MetricType.Text);
    });

    it('no longer reads the braced form as a tag reference', () => {
        // The syntax is `#slug`; `#{slug}` is not a tag reference.
        const metrics = parseMetrics('sound: #{sound-classic}');
        expect(metrics.every(m => m.type !== MetricType.Sound)).toBe(true);
    });

    it('reads a heading as a heading, not as a tag', () => {
        // '#' followed by a letter is a tag; '###' and '# ' are headings.
        const metrics = parseMetrics('### Group A');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].type).toBe(MetricType.Text);
    });

    it('does not treat a bare hash line as a tag reference', () => {
        const metrics = parseMetrics('# Not a tag ref');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].type).toBe(MetricType.Text);
    });
});

describe('tag contributions', () => {
    it('applies a tag to the line it sits on', () => {
        const tags = tagIndex([
            {
                slug: 'heavy',
                contributions: [{ kind: 'metric', type: 'intensity', value: 'heavy' }],
            },
        ]);
        const metrics = parseMetrics('5 reps @ 100 kg #heavy', tags);
        expect(metrics.some(m => m.type === MetricType.Rep && m.value === 5)).toBe(true);
        expect(metrics.some(m => m.type === 'intensity' && m.value === 'heavy')).toBe(true);
    });

    it('keeps what the line states over what a tag brings', () => {
        const tags = tagIndex([
            {
                slug: 'heavy',
                contributions: [{ kind: 'metric', type: MetricType.Rep, value: 99 }],
            },
        ]);
        const metrics = parseMetrics('5 reps #heavy', tags);
        const reps = metrics.filter(m => m.type === MetricType.Rep);
        expect(reps).toHaveLength(1);
        expect(reps[0].value).toBe(5);
    });

    it('fills a type the line does not state', () => {
        const tags = tagIndex([
            {
                slug: 'heavy',
                contributions: [{ kind: 'metric', type: MetricType.SessionRPE, value: 8 }],
            },
        ]);
        const metrics = parseMetrics('5 reps #heavy', tags);
        const rpe = metrics.filter(m => m.type === MetricType.SessionRPE);
        expect(rpe).toHaveLength(1);
        expect(rpe[0].value).toBe(8);
    });

    it('carries the unit of a contributed metric', () => {
        const tags = tagIndex([
            {
                slug: 'heavy',
                contributions: [{ kind: 'metric', type: 'load', value: 100, unit: 'kg' }],
            },
        ]);
        const metrics = parseMetrics('5 reps #heavy', tags);
        const load = metrics.find(m => m.type === 'load');
        expect(load?.unit).toBe('kg');
    });

    it('applies the tags a tag applies', () => {
        const tags = tagIndex([
            {
                slug: 'heavy',
                contributions: [
                    { kind: 'tag', slug: 'strength' },
                    { kind: 'metric', type: 'intensity', value: 'heavy' },
                ],
            },
            {
                slug: 'strength',
                contributions: [{ kind: 'metric', type: 'discipline', value: 'strength' }],
            },
        ]);
        const metrics = parseMetrics('5 reps #heavy', tags);
        expect(metrics.some(m => m.type === 'intensity' && m.value === 'heavy')).toBe(true);
        expect(metrics.some(m => m.type === 'discipline' && m.value === 'strength')).toBe(true);
        expect(metrics.some(m => m.type === tagMarkerType('strength'))).toBe(true);
    });

    it('does not loop on a tag that applies itself', () => {
        const tags = tagIndex([
            {
                slug: 'loop',
                contributions: [
                    { kind: 'tag', slug: 'loop' },
                    { kind: 'metric', type: 'intensity', value: 'loop' },
                ],
            },
        ]);
        const metrics = parseMetrics('5 reps #loop', tags);
        expect(metrics.some(m => m.type === 'intensity' && m.value === 'loop')).toBe(true);
    });

    it('contributes no metric for a function', () => {
        const tags = tagIndex([
            { slug: 'power', contributions: [{ kind: 'function', name: 'power' }] },
        ]);
        const metrics = parseMetrics('5 reps #power', tags);
        // The line states reps and the tag marks itself — a function
        // contributes no metric of its own.
        expect(metrics.map(m => m.type).sort()).toEqual([MetricType.Rep, tagMarkerType('power')].sort());
    });

    it('keeps an unresolved reference visible', () => {
        const metrics = parseMetrics('5 reps #nope');
        expect(metrics.some(m => m.value === '#nope')).toBe(true);
    });
});
