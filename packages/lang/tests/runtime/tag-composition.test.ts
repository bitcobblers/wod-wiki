import { describe, it, expect } from 'vitest';
import { createTagIndex, MetricType } from '@bitcobblers/wod-wiki-core';
import { JitCompiler } from '../../src/runtime/compiler/JitCompiler';
import { GenericTimerStrategy } from '../../src/runtime/compiler/strategies/components/GenericTimerStrategy';
import { classifyStatements } from '../../src/parser/semantic-classifier';
import { extractSyntaxFacts } from '../../src/parser/syntax-parser';
import { whiteboardScript } from '../../src/parser/whiteboard-script-language';
import { createReferenceIndex } from '../../src/effort-registry/reference-resolution';
import { EditorState } from '@codemirror/state';

function statementsFor(source: string, tags = createTagIndex([])) {
    const state = EditorState.create({ doc: source, extensions: [whiteboardScript()] });
    const facts = extractSyntaxFacts(state);
    return classifyStatements(facts, {
        index: createReferenceIndex({ efforts: [], equipment: [] }),
        tags,
    });
}

describe('the tag composition of a compiled block', () => {
    it('records the tags the block\'s statements referenced', () => {
        const tags = createTagIndex([
            {
                slug: 'heavy',
                contributions: [
                    { kind: 'metric', type: 'intensity', value: 'heavy' },
                    { kind: 'function', name: 'e1rm' },
                ],
            },
        ]);
        const statements = statementsFor('1:00 #{heavy}', tags);

        const compiler = new JitCompiler();
        compiler.registerStrategy(new GenericTimerStrategy());
        const block = compiler.compile(statements, { memory: { search: () => undefined } } as never);

        expect(block?.tagComposition?.map(reference => reference.slug)).toEqual(['heavy']);
        expect(block?.tagComposition?.[0]?.functions).toEqual(['e1rm']);
    });

    it('is empty for a block without tags', () => {
        const statements = statementsFor('1:00');

        const compiler = new JitCompiler();
        compiler.registerStrategy(new GenericTimerStrategy());
        const block = compiler.compile(statements, { memory: { search: () => undefined } } as never);

        expect(block?.tagComposition ?? []).toEqual([]);
    });

    it('records the sound profile a sound tag names', () => {
        const tags = createTagIndex([
            {
                slug: 'sound-classic',
                contributions: [{ kind: 'metric', type: MetricType.Sound, value: 'classic' }],
            },
        ]);
        const statements = statementsFor('1:00 #{sound-classic}', tags);

        const compiler = new JitCompiler();
        compiler.registerStrategy(new GenericTimerStrategy());
        const block = compiler.compile(statements, { memory: { search: () => undefined } } as never);

        expect(block?.tagComposition?.[0]?.soundProfileId).toBe('classic');
    });
});
