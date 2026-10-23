import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionContextTestHarness } from '../harness/harness';
import { BehaviorTestHarness } from '../harness/harness/BehaviorTestHarness';
import { RestBlock, RestBlockConfig } from '../../src/runtime/blocks/RestBlock';
import {
    ReportOutputBehavior,
    CountdownTimerBehavior,
    LabelingBehavior,
    SoundProfileBehavior
} from '../../src/runtime/behaviors';

describe('RestBlock', () => {

    describe('Behavior Composition', () => {
        let harness: ExecutionContextTestHarness;

        beforeEach(() => {
            harness = new ExecutionContextTestHarness();
        });

        afterEach(() => {
            harness.dispose();
        });

        it('should include all required behaviors', () => {
            const config: RestBlockConfig = { durationMs: 60000 };
            const block = new RestBlock(harness.runtime, config);

            expect(block.getBehavior(ReportOutputBehavior)).toBeDefined();
            expect(block.getBehavior(CountdownTimerBehavior)).toBeDefined();
            expect(block.getBehavior(LabelingBehavior)).toBeDefined();
            expect(block.getBehavior(SoundProfileBehavior)).toBeDefined();
        });

        it('should set correct block type and label', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 30000 });

            expect(block.blockType).toBe('Rest');
            expect(block.label).toBe('Rest');
        });

        it('should use custom label when provided', () => {
            const block = new RestBlock(harness.runtime, {
                durationMs: 30000,
                label: 'Recovery'
            });

            expect(block.label).toBe('Recovery');
        });

        it('should have no source IDs', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 30000 });

            expect(block.sourceIds).toEqual([]);
        });

        it('should throw on negative duration', () => {
            expect(() => new RestBlock(harness.runtime, { durationMs: -1000 }))
                .toThrow(RangeError);
        });

        it('should accept zero duration', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 0 });

            expect(block).toBeDefined();
            expect(block.blockType).toBe('Rest');
        });
    });

    describe('Lifecycle', () => {
        let harness: BehaviorTestHarness;

        beforeEach(() => {
            harness = new BehaviorTestHarness()
                .withClock(new Date('2024-01-01T12:00:00Z'));
        });

        afterEach(() => {
            harness?.dispose();
        });

        it('should mount without errors', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 60000 });

            harness.push(block);

            expect(() => harness.mount()).not.toThrow();
        });

        it('should initialize countdown timer on mount', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 60000 });

            harness.push(block);
            harness.mount();

            const timerMemory = harness.getMemory<{ direction: string; durationMs: number }>('time');
            expect(timerMemory).toBeDefined();
            expect(timerMemory!.direction).toBe('down');
            expect(timerMemory!.durationMs).toBe(60000);
        });

        it('should have Rest block type on stack after mount', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 30000 });

            harness.push(block);
            harness.mount();

            expect(harness.currentBlock).toBeDefined();
            expect(harness.currentBlock!.blockType).toBe('Rest');
        });

        it('should NOT auto-complete immediately for non-zero duration', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 60000 });

            harness.push(block);
            harness.mount();

            expect(block.isComplete).toBe(false);
        });

        it('should auto-complete for zero duration', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 0 });

            harness.push(block);
            harness.mount();

            // CountdownTimerBehavior should mark complete immediately for zero duration
            expect(block.isComplete).toBe(true);
        });

        it('should be disposable without errors', () => {
            const block = new RestBlock(harness.runtime, { durationMs: 60000 });

            harness.push(block);
            harness.mount();

            expect(() => harness.unmount()).not.toThrow();
        });
    });

    describe('Static buildBehaviors', () => {
        it('should return correct behavior count', () => {
            const behaviors = RestBlock.buildBehaviors({ durationMs: 60000 });

            // Expected: Segment(1) + CountdownTimer(1) + LeafExit(1) + Display(1) + Sound(1) = 5
            // (Old TimerBehavior + TimerEndingBehavior merged into CountdownTimerBehavior)
            expect(behaviors.length).toBe(5);
        });
    });
});
