import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorTestHarness } from '@wod-wiki/lang-harness/harness/BehaviorTestHarness';
import { MockBlock } from '@wod-wiki/lang-harness/harness/MockBlock';
import { ExitBehavior, LabelingBehavior } from '@bitcobblers/wod-wiki-engine';

describe('GroupBlock', () => {
  let harness: BehaviorTestHarness;

  beforeEach(() => {
    harness = new BehaviorTestHarness()
      .withClock(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    harness?.dispose();
  });

  it('should initialize display state on mount', () => {
    const labeling = new LabelingBehavior({ mode: 'timer', label: 'Group' });
    const block = new MockBlock('group-test', [labeling], { blockType: 'Group' });

    harness.push(block);
    harness.mount();

    // Group blocks typically just set up display state
    expect(block.isComplete).toBe(false);

    // Label memory should be set
    const labelMemory = block.getMemoryByTag('metric:label');
    expect(labelMemory.length).toBeGreaterThan(0);
  });

  it('should mark complete on next with ExitBehavior', () => {
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });
    const labeling = new LabelingBehavior({ mode: 'timer', label: 'Group' });
    const block = new MockBlock('group-test-single', [labeling, exit], { blockType: 'Group' });

    harness.push(block);
    harness.mount();

    // next() should mark block complete via ExitBehavior
    harness.next();

    expect(block.isComplete).toBe(true);
  });
});
