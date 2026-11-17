import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorTestHarness } from '@wod-wiki/lang-harness/harness/BehaviorTestHarness';
import { MockBlock } from '@wod-wiki/lang-harness/harness/MockBlock';
import { CountupTimerBehavior } from '@bitcobblers/wod-wiki-engine';

// Using CountupTimerBehavior as a proxy to test lifecycle mounting because it has clear side effects
// (memory allocation).

describe('Mount Lifecycle', () => {
    let harness: BehaviorTestHarness;

    beforeEach(() => {
        harness = new BehaviorTestHarness();
    });

    afterEach(() => {
        harness?.dispose();
    });

    it('should initialize behaviors and set memory on mount', () => {
        const timer = new CountupTimerBehavior({ label: 'Test' });
        const block = new MockBlock('mount-test', [timer]);

        harness.push(block);

        // Check timer memory NOT set yet
        expect(harness.getMemory('time')).toBeUndefined();

        // Mount
        harness.mount();

        // After mount - timer memory should be set with open span
        const timerMemory = harness.getMemory('time');
        expect(timerMemory).toBeDefined();
        expect(timerMemory.direction).toBe('up');
        expect(timerMemory.spans.length).toBe(1);
    });

    it('should set execution start time', () => {
        const block = new MockBlock('mount-test', []);
        harness.push(block);

        const startTime = harness.clock.currentDate;
        harness.mount();

        expect(block.executionTiming.startTime).toBeDefined();
        expect(block.executionTiming.startTime?.getTime()).toBe(startTime.getTime());
    });
});
