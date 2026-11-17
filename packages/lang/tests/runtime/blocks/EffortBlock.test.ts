import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorTestHarness } from '@wod-wiki/lang-harness/harness/BehaviorTestHarness';
import { MockBlock } from '@wod-wiki/lang-harness/harness/MockBlock';
import { CountupTimerBehavior, ExitBehavior, LabelingBehavior } from '@bitcobblers/wod-wiki-engine';

describe('EffortBlock (simulated with MockBlock)', () => {
  let harness: BehaviorTestHarness;

  beforeEach(() => {
    harness = new BehaviorTestHarness()
      .withClock(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    harness?.dispose();
  });

  // Effort blocks typically have a CountUp timer and complete on user advance
  it('should initialize timer state on mount', () => {
    const timer = new CountupTimerBehavior({ label: 'Effort' });
    const labeling = new LabelingBehavior({ mode: 'timer', label: 'Effort' });
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });

    const block = new MockBlock('effort-test', [timer, labeling, exit], { blockType: 'Effort' });

    harness.push(block);
    harness.mount();

    // Timer should be initialized in memory (no event emission)
    const timerMemory = harness.getMemory('time');
    expect(timerMemory).toBeDefined();
    expect(timerMemory.direction).toBe('up');
    expect(timerMemory.durationMs).toBeUndefined();
  });

  it('should mark complete on next via ExitBehavior', () => {
    const timer = new CountupTimerBehavior({ label: 'Effort' });
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });

    const block = new MockBlock('effort-test', [timer, exit], { blockType: 'Effort' });

    harness.push(block);
    harness.mount();

    harness.advanceClock(10000);

    // next() should trigger ExitBehavior to mark block complete and pop
    harness.next();

    expect(block.isComplete).toBe(true);
  });
});
