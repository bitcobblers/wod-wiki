import { describe, it, expect } from 'vitest';
import { MetricType, type ScriptBlock } from '@bitcobblers/wod-wiki-core';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import type { JitCompiler } from '../../src/runtime/compiler/JitCompiler';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { RuntimeClock, createMockClock } from '../../src/runtime/RuntimeClock';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createAnalyticsEngineForBlock } from '../../src/analytics/createAnalyticsEngineForBlock';
import { extractPropertyRulesFromMeta, type PropertyRuleInput } from '../../src/analytics/calc/shakeOutQueue';
import type { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

/**
 * Dogfood findings #6 and #8 through the real execution chain:
 * parse → compile → plan-stage shake-out → block pop → report →
 * log-stage shake-out → emitted segment. Worked example: 5 @ 100 kg →
 * work 500. A skipped `metrics.work` must carry a Skipped-Dependency
 * Diagnostic naming `resistance` on the emitted segment.
 */

const START = new Date('2024-01-01T12:00:00Z');

function makeRuntime(scriptText: string, propertySources: PropertyRuleInput[]): {
    runtime: IScriptRuntime;
    script: WhiteboardScript;
    jit: JitCompiler;
    clock: RuntimeClock;
} {
    const script = createParser().read(scriptText) as WhiteboardScript;
    const clock = new RuntimeClock();
    const jit = createCompiler();
    const runtime = new ScriptRuntime(script, jit, {
        stack: new RuntimeStack(),
        clock,
        eventBus: new EventBus(),
    });
    // RuntimeFactory wiring parity: the analytics engine built from the same
    // block + note property rules rides the runtime's output pipeline.
    // Cast: the engine factory only reads dialect/statements off the block.
    const block = { dialect: 'time', statements: script.statements } as unknown as ScriptBlock;
    const { engine } = createAnalyticsEngineForBlock(block, { propertySources });
    runtime.setAnalyticsEngine(engine);
    return { runtime, script, jit, clock };
}

function pushAndComplete(runtime: IScriptRuntime, script: WhiteboardScript, index: number): void {
    const statement = script.statements[index];
    if (!statement) throw new Error(`Statement index ${index} out of bounds`);
    const block = runtime.jit.compile([statement], runtime);
    if (!block) throw new Error(`Failed to compile statement ${index}`);
    runtime.pushBlock(block);
    runtime.popBlock();
}

describe('runtime property-note lifecycle (dogfood findings #6, #8)', () => {
    it('#8: skipped work (no resistance anywhere) rides the segment with a diagnostic naming resistance', () => {
        const note = extractPropertyRulesFromMeta(
            { 'metrics.work': 'reps * resistance' },
            'note',
            'note-frontmatter',
        );
        const { runtime, script } = makeRuntime('10 Pushups', [note]);
        try {
            pushAndComplete(runtime, script, 0);

            const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
            expect(segments).toHaveLength(1);

            // work is skipped — reps exist, resistance does not.
            expect(segments[0]!.metrics.rawMetrics.some((m) => m.type === 'work')).toBe(false);

            // …and the skip is diagnosable: the segment names the missing input.
            const diagnostic = segments[0]!.metrics.rawMetrics.find((m) => m.type === MetricType.Diagnostic);
            expect(diagnostic).toBeDefined();
            const metadata = diagnostic!.metadata;
            const missing =
                metadata && typeof metadata === 'object' && 'missing' in metadata && Array.isArray(metadata.missing)
                    ? metadata.missing
                    : [];
            expect(missing).toContain('resistance');
        } finally {
            runtime.dispose();
        }
    });

    it('#6: 5 Back Squat 100kg resolves work = 500 through the real run', () => {
        const note = extractPropertyRulesFromMeta(
            { 'metrics.work': 'reps * resistance' },
            'note',
            'note-frontmatter',
        );
        const { runtime, script } = makeRuntime('5 Back Squat 100kg', [note]);
        try {
            // The fixture depends on unit fusion producing a 100 kg resistance metric.
            const statement = script.statements[0]!;
            const resistanceMetric = statement.metrics.find((m) => m.type === MetricType.Resistance);
            const resistanceAmount =
                typeof resistanceMetric?.value === 'number'
                    ? resistanceMetric.value
                    : resistanceMetric?.value && typeof resistanceMetric.value === 'object' && 'amount' in resistanceMetric.value
                        ? resistanceMetric.value.amount
                        : undefined;
            expect(resistanceAmount).toBe(100);

            pushAndComplete(runtime, script, 0);

            const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
            expect(segments).toHaveLength(1);
            const work = segments[0]!.metrics.rawMetrics.find((m) => m.type === 'work');
            expect(work?.value).toBe(500);
        } finally {
            runtime.dispose();
        }
    });

    it('#6: a statement that runs 1 s of clock time derives elapsed and resolves power = 500', () => {
        // Rep blocks carry no timer of their own — ElapsedMetric(0) was the
        // only elapsed they ever saw, so `power: work / convert(elapsed, s)`
        // divided by zero and vanished. The segment's own timeSpan (mount →
        // pop on the mock clock) is its active window and must feed the queue.
        const note = extractPropertyRulesFromMeta(
            {
                'metrics.work': 'reps * resistance',
                'metrics.power': 'work / convert(elapsed, s)',
            },
            'note',
            'note-frontmatter',
        );
        const script = createParser().read('5 Back Squat 100kg') as WhiteboardScript;
        const clock = createMockClock(new Date(START.getTime()));
        const runtime = new ScriptRuntime(script, createCompiler(), {
            stack: new RuntimeStack(),
            clock,
            eventBus: new EventBus(),
        });
        // Cast: the engine factory only reads dialect/statements off the block.
        const block = { dialect: 'time', statements: script.statements } as unknown as ScriptBlock;
        const { engine } = createAnalyticsEngineForBlock(block, { propertySources: [note] });
        runtime.setAnalyticsEngine(engine);
        try {
            const statement = script.statements[0]!;
            const compiled = runtime.jit.compile([statement], runtime);
            if (!compiled) throw new Error('Failed to compile statement');
            runtime.pushBlock(compiled);
            clock.advance(1000); // the set runs for 0:01 of clock time
            runtime.popBlock();

            const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
            expect(segments).toHaveLength(1);
            expect(segments[0]!.metrics.rawMetrics.find((m) => m.type === 'work')?.value).toBe(500);
            const power = segments[0]!.metrics.rawMetrics.find((m) => m.type === 'power');
            expect(power?.value).toBe(500);
        } finally {
            runtime.dispose();
        }
    });
});
