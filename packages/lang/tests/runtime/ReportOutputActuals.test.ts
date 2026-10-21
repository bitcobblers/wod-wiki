import { describe, it, expect } from 'vitest';
import { MetricType, BlockKey } from '@bitcobblers/wod-wiki-core';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import type { JitCompiler } from '../../src/runtime/compiler/JitCompiler';
import { BlockBuilder } from '../../src/runtime/compiler/BlockBuilder';
import { BlockContext } from '../../src/runtime/BlockContext';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { RuntimeClock } from '../../src/runtime/RuntimeClock';
import { EventBus } from '../../src/runtime/events/EventBus';
import { MemoryLocation } from '../../src/runtime/memory/MemoryLocation';
import { OutputEmitter } from '../../src/runtime/OutputEmitter';
import { ReportOutputBehavior } from '../../src/runtime/behaviors';
import type { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import type { IRuntimeBlock } from '../../src/runtime/contracts/IRuntimeBlock';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

/**
 * Actuals preservation (clock-command-board): a user-origin Rep committed into
 * `metric:result` before pop must survive ReportOutputBehavior's result
 * rewrite and ride the emitted segment alongside the planned target and the
 * computed time results.
 */

function makeRuntime(scriptText: string): { runtime: IScriptRuntime; script: WhiteboardScript; jit: JitCompiler; clock: RuntimeClock } {
    const script = createParser().read(scriptText) as WhiteboardScript;
    const clock = new RuntimeClock();
    const jit = createCompiler();
    const runtime = new ScriptRuntime(script, jit, {
        stack: new RuntimeStack(),
        clock,
        eventBus: new EventBus(),
    });
    return { runtime, script, jit, clock };
}

function pushStatement(runtime: IScriptRuntime, script: WhiteboardScript, index: number): IRuntimeBlock {
    const statement = script.statements[index];
    if (!statement) throw new Error(`Statement index ${index} out of bounds`);
    const block = runtime.jit.compile([statement], runtime);
    if (!block) throw new Error(`Failed to compile statement ${index}`);
    runtime.pushBlock(block);
    return block;
}

function userReps(metrics: readonly { type: MetricType | string; origin: string; value?: unknown }[]) {
    return metrics.filter((m) => m.type === MetricType.Rep && m.origin === 'user');
}

describe('ReportOutputBehavior user actual preservation', () => {
    it('keeps a pre-pop user rep through the result rewrite and the emitted segment', () => {
        const { runtime, script } = makeRuntime('10 Burpees');
        try {
            const block = pushStatement(runtime, script, 0);

            // Simulate commitActualReps (playground actuals.ts): user-origin
            // rep lands in metric:result before the block is popped.
            block.pushMemory(new MemoryLocation('metric:result', [{
                type: MetricType.Rep,
                value: 17,
                origin: 'user',
                image: '17',
                sourceBlockKey: block.key.toString(),
                timestamp: new Date(),
            }]));

            runtime.popBlock();

            const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
            expect(segments).toHaveLength(1);
            expect(segments[0].sourceBlockKey).toBe(block.key.toString());

            const metrics = segments[0].metrics.toArray();
            expect(userReps(metrics)).toHaveLength(1);
            expect(userReps(metrics)[0].value).toBe(17);
            // planned target retained raw alongside the user winner
            expect(metrics.some((m) => m.type === MetricType.Rep && m.origin === 'parser' && m.value === 10)).toBe(true);
            // computed time results still written — user metric did not evict them
            expect(metrics.some((m) => m.type === MetricType.Elapsed)).toBe(true);
            expect(metrics.some((m) => m.type === MetricType.Total)).toBe(true);

        } finally {
            runtime.dispose();
        }
    });

    it('keeps the user rep when the behavior writes result memory before the commit', () => {
        const { runtime, script } = makeRuntime('10 Burpees');
        try {
            const block = pushStatement(runtime, script, 0);

            // Stop flow ordering: the behavior wrote results (unmount) before
            // the user committed — the late user write lands in the existing
            // result location without evicting computed results.
            block.unmount(runtime);
            const resultLoc = block.getMemoryByTag('metric:result')[0];
            const before = resultLoc.metrics.toArray().map((m) => m.type);
            expect(before).toContain(MetricType.Elapsed);

            resultLoc.update([
                ...resultLoc.metrics.toArray(),
                { type: MetricType.Rep, value: 9, origin: 'user', image: '9', sourceBlockKey: block.key.toString() },
            ]);

            const emitter = new OutputEmitter();
            emitter.attach({ clock: runtime.clock, stack: runtime.stack, script });
            emitter.emitSegmentFromResultMemory(block, 1);

            const metrics = emitter.getAll().find((o) => o.outputType === 'segment')!.metrics.toArray();
            expect(userReps(metrics)[0].value).toBe(9);
            expect(metrics.some((m) => m.type === MetricType.Elapsed)).toBe(true);
        } finally {
            runtime.dispose();
        }
    });

    it('merges pre-committed user reps into grouped results per movement group', () => {
        const { runtime } = makeRuntime('10 Burpees');
        try {
            // Grouped movement block: two display groups (one per statement),
            // sourceIds aligned per group — the production BlockBuilder shape.
            const builder = new BlockBuilder(runtime as never)
                .setContext(new BlockContext(runtime as never, 'grouped-ctx', ''))
                .setKey(new BlockKey())
                .setBlockType('Movement')
                .setLabel('Group')
                .setSourceIds([3, 5])
                .setFragments([
                    [{ type: MetricType.Rep, value: 21, origin: 'parser', image: '21' }],
                    [{ type: MetricType.Rep, value: 15, origin: 'parser', image: '15' }],
                ])
                .addBehavior(new ReportOutputBehavior());
            const block = builder.build();
            runtime.pushBlock(block);

            // commitActualReps per-group pre-creation: user rep only in group 0.
            block.pushMemory(new MemoryLocation('metric:result', [{
                type: MetricType.Rep, value: 18, origin: 'user', image: '18',
                sourceBlockKey: block.key.toString(), timestamp: new Date(),
            }]));
            block.pushMemory(new MemoryLocation('metric:result', []));

            runtime.popBlock();

            const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
            expect(segments).toHaveLength(2);
            // each group's segment anchors to its own statement id
            expect(segments[0].sourceStatementId).toBe(3);
            expect(segments[1].sourceStatementId).toBe(5);
            // user actual only on the targeted movement; computed results on both
            expect(userReps(segments[0].metrics.toArray())[0].value).toBe(18);
            expect(userReps(segments[1].metrics.toArray())).toHaveLength(0);
            expect(segments[0].metrics.some((m) => m.type === MetricType.Elapsed)).toBe(true);
            expect(segments[1].metrics.some((m) => m.type === MetricType.Elapsed)).toBe(true);
            // planned targets retained per group
            expect(segments[0].metrics.some((m) => m.type === MetricType.Rep && m.origin === 'parser' && m.value === 21)).toBe(true);
            expect(segments[1].metrics.some((m) => m.type === MetricType.Rep && m.origin === 'parser' && m.value === 15)).toBe(true);
        } finally {
            runtime.dispose();
        }
    });
});
