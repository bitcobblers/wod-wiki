import { describe, it, expect } from 'bun:test';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import { IntervalLogicStrategy } from '@bitcobblers/wod-wiki-engine';
import { CountdownTimerBehavior, SoundProfileBehavior } from '@bitcobblers/wod-wiki-engine';

describe('IntervalLogicStrategy', () => {
  it('should compile "1:00 EMOM 10" to an Interval block', () => {
    // "1:00 EMOM 10" implies 10 rounds of 1 minute intervals
    const harness = new RuntimeTestBuilder()
      .withScript('1:00 EMOM 10')
      .withStrategy(new IntervalLogicStrategy())
      .build();

    const block = harness.pushStatement(0);

    expect(block).toBeDefined();
    expect(block.blockType).toBe('EMOM');
    expect(block.label).toBe('EMOM 1:00 10');

    // Now uses aspect-based behaviors
    expect(block.getBehavior(CountdownTimerBehavior)).toBeDefined();
    // Round tracking is wired via ChildrenStrategy (ChildSelectionBehavior) which is not registered here
    // Sound cues come from SoundStrategy (the sound profile), not from this strategy.
    expect(block.getBehavior(SoundProfileBehavior)).toBeUndefined();
  });
});
