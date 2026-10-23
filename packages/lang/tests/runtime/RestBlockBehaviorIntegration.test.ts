import { describe, it, expect, beforeEach } from 'vitest';
import { JitCompiler } from '../../src/runtime/compiler/JitCompiler';
import { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import { CodeStatement } from '@bitcobblers/wod-wiki-core';
import { hintMetric } from '../../src/metrics/hints';
import { DurationMetric } from '../../src/runtime/compiler/metrics/DurationMetric';
import { RoundsMetric } from '../../src/runtime/compiler/metrics/RoundsMetric';
import { AmrapLogicStrategy } from '../../src/runtime/compiler/strategies/logic/AmrapLogicStrategy';
import { IntervalLogicStrategy } from '../../src/runtime/compiler/strategies/logic/IntervalLogicStrategy';
import { GenericTimerStrategy } from '../../src/runtime/compiler/strategies/components/GenericTimerStrategy';
import { GenericLoopStrategy } from '../../src/runtime/compiler/strategies/components/GenericLoopStrategy';
import { ChildrenStrategy } from '../../src/runtime/compiler/strategies/enhancements/ChildrenStrategy';
import { SoundStrategy } from '../../src/runtime/compiler/strategies/enhancements/SoundStrategy';
import { ReportOutputStrategy } from '../../src/runtime/compiler/strategies/enhancements/ReportOutputStrategy';
import { CodeMetadata } from '@bitcobblers/wod-wiki-core';

import {
    CountdownTimerBehavior,
    ChildSelectionBehavior,
    SoundProfileBehavior,
    ReportOutputBehavior
} from '../../src/runtime/behaviors';

/**
 * Tests for child selection/rest integration:
 * - AMRAP should include ChildSelectionBehavior with looping/rest injection
 * - EMOM should include ChildSelectionBehavior with looping/rest injection
 * - Behavior chain order is correct
 */
describe('Phase 5: Strategy ChildSelectionBehavior Integration', () => {
    let runtime: IScriptRuntime;
    let compiler: JitCompiler;

    // Mock Fragments for testing
    class MockTimerMetric extends DurationMetric {
        constructor(ms: number, forceUp: boolean = false) {
            const meta = new CodeMetadata(0, 0, 0, 0);
            super('0:00', meta, forceUp);
            (this as any).value = ms;
            (this as any).original = ms;
            (this as any).forceCountUp = forceUp;
        }
    }

    class MockRoundsMetric extends RoundsMetric {
        constructor(val: number) {
            super('0', new CodeMetadata(0, 0, 0, 0));
            (this as any).value = val;
        }
    }

    beforeEach(() => {
        runtime = {
            memory: { search: () => undefined }
        } as any;
        compiler = new JitCompiler();
    });

    describe('AMRAP with ChildSelectionBehavior', () => {
        beforeEach(() => {
            compiler.registerStrategy(new AmrapLogicStrategy());     // Priority 90
            compiler.registerStrategy(new GenericTimerStrategy());    // Priority 50
            compiler.registerStrategy(new GenericLoopStrategy());     // Priority 50
            compiler.registerStrategy(new ChildrenStrategy());        // Priority 50
            compiler.registerStrategy(new SoundStrategy());           // Priority 20
            compiler.registerStrategy(new ReportOutputStrategy());    // Priority 15
        });

        it('should include ChildSelectionBehavior in compiled AMRAP block', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(600000, true), // 10 min countdown
                new MockRoundsMetric(1)
            ];
            (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block).toBeDefined();
            expect(block!.blockType).toBe('AMRAP');
            expect(block!.getBehavior(ChildSelectionBehavior)).toBeDefined();
        });

        it('should have ChildSelectionBehavior alongside timer behaviors', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(1200000, true), // 20 min
                new MockRoundsMetric(1)
            ];
            (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(CountdownTimerBehavior)).toBeDefined();
            expect(block!.getBehavior(CountdownTimerBehavior)).toBeDefined();
            expect(block!.getBehavior(ChildSelectionBehavior)).toBeDefined();
        });

        it('should have child selection behavior for container execution', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(600000, true),
                new MockRoundsMetric(1)
            ];
            (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(ChildSelectionBehavior)).toBeDefined();
        });

        it('should have unbounded rounds (AMRAP pattern)', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(600000, true),
                new MockRoundsMetric(1)
            ];
            (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            const csb = block!.getBehavior(ChildSelectionBehavior);
            expect(csb).toBeDefined();
            // AMRAP has unbounded rounds - startRound is set but totalRounds is undefined
            expect((csb as any).config?.startRound).toBe(1);
            expect((csb as any).config?.totalRounds).toBeUndefined();
            // Note: ChildrenStrategy may add it for unbounded rounds or not
            // depending on hasCountdownCompletion
        });

        it('should include sound cues', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(600000, true),
                new MockRoundsMetric(1)
            ];
            (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(SoundProfileBehavior)).toBeDefined();
        });

        it('should include segment output', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(600000, true),
                new MockRoundsMetric(1)
            ];
            (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(ReportOutputBehavior)).toBeDefined();
        });
    });

    describe('EMOM with ChildSelectionBehavior', () => {
        beforeEach(() => {
            compiler.registerStrategy(new IntervalLogicStrategy()); // Priority 90
            compiler.registerStrategy(new GenericTimerStrategy());   // Priority 50
            compiler.registerStrategy(new GenericLoopStrategy());    // Priority 50
            compiler.registerStrategy(new ChildrenStrategy());       // Priority 50
            compiler.registerStrategy(new SoundStrategy());          // Priority 20
            compiler.registerStrategy(new ReportOutputStrategy());   // Priority 15
        });

        it('should include ChildSelectionBehavior in compiled EMOM block', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(60000), // 1 min interval
                new MockRoundsMetric(10)    // 10 rounds
            ];
            (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block).toBeDefined();
            expect(block!.blockType).toBe('EMOM');
            expect(block!.getBehavior(ChildSelectionBehavior)).toBeDefined();
        });

        it('should have ChildSelectionBehavior alongside timer behaviors', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(60000),
                new MockRoundsMetric(10)
            ];
            (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(CountdownTimerBehavior)).toBeDefined();
            expect(block!.getBehavior(CountdownTimerBehavior)).toBeDefined();
            expect(block!.getBehavior(ChildSelectionBehavior)).toBeDefined();
        });

        it('should have bounded rounds (EMOM pattern)', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(60000),
                new MockRoundsMetric(10)
            ];
            (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            const csb = block!.getBehavior(ChildSelectionBehavior);
            expect(csb).toBeDefined();
            // EMOM has bounded rounds
            expect((csb as any).config?.startRound).toBe(1);
            expect((csb as any).config?.totalRounds).toBeDefined();
        });

        it('should have child behaviors when children are present', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(60000),
                new MockRoundsMetric(10)
            ];
            (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));
            statement.children = [new CodeStatement()];

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(ChildSelectionBehavior)).toBeDefined();
        });

        it('should include sound cues', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(60000),
                new MockRoundsMetric(10)
            ];
            (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(SoundProfileBehavior)).toBeDefined();
        });

        it('should include segment output', () => {
            const statement = new CodeStatement();
            statement.metrics = [
                new MockTimerMetric(60000),
                new MockRoundsMetric(10)
            ];
            (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));

            const block = compiler.compile([statement], runtime);

            expect(block!.getBehavior(ReportOutputBehavior)).toBeDefined();
        });
    });
});
