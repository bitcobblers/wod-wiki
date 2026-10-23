import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { classifyStatements } from '../../src/parser/semantic-classifier';
import { extractSyntaxFacts } from '../../src/parser/syntax-parser';
import { createTagIndex } from '../../src/tags/TagCatalog';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { whiteboardScript } from '../../src/parser/whiteboard-script-language';
import { createReferenceIndex } from '../../src/effort-registry/reference-resolution';

function buildState(doc: string): EditorState {
    return EditorState.create({
        doc,
        extensions: [whiteboardScript()],
    });
}

/**
 * Parse a script and return the metrics of its statements.
 */
function parseMetrics(source: string, tags?: ReturnType<typeof createTagIndex>) {
    const state = buildState(source);
    const facts = extractSyntaxFacts(state);
    const references = {
        index: createReferenceIndex({ efforts: [], equipment: [] }),
        ...(tags ? { tags } : {}),
    };
    const statements = classifyStatements(facts, references);
    return statements.flatMap(s => s.metrics.toArray());
}

describe('tag references', () => {
    it('parses #{tag-slug} as a property value', () => {
        const metrics = parseMetrics('sound: #{sound-classic}');
        expect(metrics).toHaveLength(1);
        // Without a catalog the reference is kept verbatim, so an unresolved
        // reference stays visible rather than silently becoming a value.
        expect(metrics[0].value).toBe('#{sound-classic}');
    });

    it('contributes the metrics the tag is marked down with', () => {
        const tags = createTagIndex([
            { slug: 'sound-classic', metrics: [{ type: MetricType.Sound, value: 'classic' }] },
        ]);
        const metrics = parseMetrics('sound: #{sound-classic}', tags);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].type).toBe(MetricType.Sound);
        expect(metrics[0].value).toBe('classic');
    });

    it('stacks several tag references on one line', () => {
        const tags = createTagIndex([
            { slug: 'sound-classic', metrics: [{ type: MetricType.Sound, value: 'classic' }] },
            { slug: 'sound-loud', metrics: [{ type: MetricType.Sound, value: 'loud' }] },
        ]);
        const metrics = parseMetrics('sound: #{sound-classic} #{sound-loud}', tags);
        expect(metrics.map(m => m.value)).toEqual(['classic', 'loud']);
    });

    it('keeps the literal reference when the tag is unknown', () => {
        const metrics = parseMetrics('sound: #{nope}');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].value).toBe('#{nope}');
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

    it('does not treat a bare hash line as a tag reference', () => {
        const metrics = parseMetrics('# Not a tag ref');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].type).toBe(MetricType.Text);
    });
});
