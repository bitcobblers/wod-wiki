import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorTestHarness } from '@wod-wiki/lang-harness/harness/BehaviorTestHarness';
import { MockBlock } from '@wod-wiki/lang-harness/harness/MockBlock';
import { CountdownTimerBehavior, CountupTimerBehavior } from '@bitcobblers/wod-wiki-engine';

describe('TimerBlock', () => {
  let harness: BehaviorTestHarness;

  beforeEach(() => {
    harness = new BehaviorTestHarness()
      .withClock(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    harness?.dispose();
  });

  it('should initialize count-up timer state on mount', () => {
    const timer = new CountupTimerBehavior({ label: 'Timer' });
    const block = new MockBlock('timer-up', [timer], { blockType: 'Timer' });

    harness.push(block);
    harness.mount();

    // Timer state should be initialized in memory with open span
    const timerMemory = harness.getMemory('time');
    expect(timerMemory).toBeDefined();
    expect(timerMemory.direction).toBe('up');
    expect(timerMemory.durationMs).toBeUndefined();
    expect(timerMemory.spans.length).toBe(1);
    expect(timerMemory.spans[0].ended).toBeUndefined(); // Open span = running
  });

  it('should initialize countdown timer with durationMs', () => {
    const timer = new CountdownTimerBehavior({ direction: 'down', durationMs: 10000 });
    const block = new MockBlock('timer-down', [timer], { blockType: 'Timer' });

    harness.push(block);
    harness.mount();

    // Verify timer memory contains correct data
    const timerMemory = harness.getMemory('time');
    expect(timerMemory).toBeDefined();
    expect(timerMemory.direction).toBe('down');
    expect(timerMemory.durationMs).toBe(10000);
  });

  it('should stop timer on unmount', () => {
    const timer = new CountupTimerBehavior({ label: 'Timer' });
    const block = new MockBlock('timer-test', [timer], { blockType: 'Timer' });

    harness.push(block);
    harness.mount();

    harness.advanceClock(10000);
    harness.unmount();

    // After unmount, block should be removed from stack
    expect(harness.stackDepth).toBe(0);

    // Block should have completion timing set
    expect(block.executionTiming.createdAt).toBeDefined();
  });
});
