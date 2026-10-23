import { describe, it, expect } from 'bun:test';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import { AmrapLogicStrategy } from '@bitcobblers/wod-wiki-engine';
import { CountdownTimerBehavior, LabelingBehavior, SoundProfileBehavior } from '@bitcobblers/wod-wiki-engine';

describe('AmrapLogicStrategy', () => {
  it('should compile "10:00 AMRAP" to an AMRAP block', () => {
    // Strategy matches Timer + (Rounds OR "AMRAP" keyword)
    const harness = new RuntimeTestBuilder()
      .withScript('10:00 AMRAP')
      .withStrategy(new AmrapLogicStrategy())
      .build();

    const block = harness.pushStatement(0);

    expect(block).toBeDefined();
    expect(block.blockType).toBe('AMRAP');

    // Uses aspect-based behaviors
    expect(block.getBehavior(CountdownTimerBehavior)).toBeDefined();
    expect(block.getBehavior(LabelingBehavior)).toBeDefined();
    // Sound cues come from SoundStrategy (the sound profile), not from this strategy.
    expect(block.getBehavior(SoundProfileBehavior)).toBeUndefined();
  });
});
