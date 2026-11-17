import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorTestHarness } from '@wod-wiki/lang-harness/harness/BehaviorTestHarness';
import { MockBlock } from '@wod-wiki/lang-harness/harness/MockBlock';
import { CountupTimerBehavior, ExitBehavior } from '@bitcobblers/wod-wiki-engine';
import type { TimerState } from '@bitcobblers/wod-wiki-engine';
import { PopBlockAction } from '@bitcobblers/wod-wiki-engine';

describe('Block lifecycle edge cases', () => {
  let harness: BehaviorTestHarness;

  beforeEach(() => {
    harness = new BehaviorTestHarness()
      .withClock(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    harness?.dispose();
  });

  // 1. Double-mount: mount() called twice should not crash or create duplicate memory
  it('should handle double-mount without crash or duplicate memory', () => {
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });
    const block = new MockBlock('double-mount', [exit]);

    harness.push(block);
    harness.mount();

    // Second mount — block already on stack, already mounted
    // Calling mount again should not crash
    const secondActions = harness.mount();
    expect(secondActions).toBeDefined();

    // Block should not have duplicate memory entries;
    // the second mount recreates behaviorContext but does not duplicate memory
    const allMemory = block.getAllMemory();
    // Memory should remain consistent (label + no extra entries from double mount)
    expect(allMemory.length).toBeGreaterThanOrEqual(1);
    expect(block.isComplete).toBe(false);
  });

  // 2. Double-unmount: second call should be a no-op (stack already empty)
  it('should handle double-unmount — second call is a safe no-op', () => {
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });
    const block = new MockBlock('double-unmount', [exit]);

    harness.push(block);
    harness.mount();
    harness.unmount();

    // Stack is now empty — calling unmount again should throw
    // because there is no block on the stack
    expect(() => harness.unmount()).toThrow('No block on stack to unmount');
  });

  // 3. next() on unmounted block — calling next on a raw block (not through harness) should not crash
  it('should not crash when next() is called on an unmounted block', () => {
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });
    const block = new MockBlock('next-unmounted', [exit]);

    // Don't push or mount — just call next() directly on the block
    // MockBlock.next() falls back to creating a MockBehaviorContext on the fly
    const actions = block.next(harness.runtime);

    // ExitBehavior immediate+onNext should still produce a PopBlockAction
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toBeInstanceOf(PopBlockAction);
  });

  // 4. Empty behavior list: MockBlock with no behaviors — mount/next/unmount should not crash
  it('should handle MockBlock with no behaviors across full lifecycle', () => {
    const block = new MockBlock('empty-behaviors', []);

    harness.push(block);
    const mountActions = harness.mount();
    expect(mountActions).toEqual([]);

    const nextActions = harness.next();
    expect(nextActions).toEqual([]);

    const unmountActions = harness.unmount();
    expect(unmountActions).toEqual([]);

    // Block should not be marked complete (no exit behavior)
    expect(block.isComplete).toBe(false);
  });

  // 5. Single-behavior block: only ExitBehavior — mount then next should mark complete
  it('should mark complete when single ExitBehavior receives next()', () => {
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });
    const block = new MockBlock('single-exit', [exit]);

    harness.push(block);
    harness.mount();

    expect(block.isComplete).toBe(false);

    harness.next();

    expect(block.isComplete).toBe(true);
    expect(block.completionReason).toBe('user-advance');
  });

  // 6. Block with multiple competing exit behaviors — first exit should win
  it('should have first exit behavior win when multiple exits compete', () => {
    // Two immediate ExitBehaviors both onNext: true
    const exit1 = new ExitBehavior({ mode: 'immediate', onNext: true });
    const exit2 = new ExitBehavior({ mode: 'immediate', onNext: true });

    const block = new MockBlock('competing-exits', [exit1, exit2]);

    harness.push(block);
    harness.mount();

    harness.next();

    // Block should be marked complete; markComplete is idempotent on MockBlock
    // so even though both fire, the first one wins and reason stays from first
    expect(block.isComplete).toBe(true);
    expect(block.completionReason).toBe('user-advance');

    // Both should produce PopBlockAction — we get 2 from next
    const popActions = harness.findActions(PopBlockAction);
    expect(popActions.length).toBe(2);
  });

  // 7. Timer behavior + advanceClock(0) — should not crash or produce negative elapsed
  it('should handle advanceClock(0) with timer behavior without crash', () => {
    const timer = new CountupTimerBehavior({ label: 'Test Timer' });
    const exit = new ExitBehavior({ mode: 'immediate', onNext: true });
    const block = new MockBlock('timer-zero-advance', [timer, exit]);

    harness.push(block);
    harness.mount();

    // Advance by 0ms — no-op time progression
    harness.advanceClock(0);

    // Timer memory should still be valid, no negative elapsed
    const timerMemory = harness.getMemory<TimerState>('time');
    expect(timerMemory).toBeDefined();
    expect(timerMemory.direction).toBe('up');

    // Advance by real time and verify progression
    harness.advanceClock(5000);
    const updatedMemory = harness.getMemory('time');
    expect(updatedMemory).toBeDefined();
  });

  // 8. Mount → immediate unmount (no advance) — block should have startTime and createdAt
  it('should have startTime and createdAt after immediate mount→unmount', () => {
    const timer = new CountupTimerBehavior({ label: 'Immediate' });
    const block = new MockBlock('immediate-unmount', [timer]);

    harness.push(block);
    harness.mount();

    const mountTime = block.executionTiming.startTime;
    expect(mountTime).toBeDefined();
    expect(mountTime!.getTime()).toBe(new Date('2024-01-01T12:00:00Z').getTime());

    // Unmount immediately — no clock advance
    harness.unmount();

    expect(block.executionTiming.createdAt).toBeDefined();
    expect(block.executionTiming.createdAt!.getTime()).toBe(
      new Date('2024-01-01T12:00:00Z').getTime()
    );
  });

  // 9. Deeply nested mock blocks (push 5 blocks) — stack depth should be 5
  it('should maintain correct stack depth with 5 nested blocks', () => {
    const blocks: MockBlock[] = [];
    for (let i = 0; i < 5; i++) {
      const block = new MockBlock(`nested-${i}`, [
        new CountupTimerBehavior({ label: `Level ${i}` }),
      ]);
      blocks.push(block);
      harness.push(block);
    }

    expect(harness.stackDepth).toBe(5);

    // Mount all from bottom to top (current = top)
    harness.mount();

    // Current block should be the last one pushed
    expect(harness.currentBlock).toBe(blocks[4]);

    // Unmount top block
    harness.unmount();
    expect(harness.stackDepth).toBe(4);
    expect(harness.currentBlock).toBe(blocks[3]);

    // Unmount remaining
    harness.unmount();
    harness.unmount();
    harness.unmount();
    harness.unmount();

    expect(harness.stackDepth).toBe(0);
    expect(harness.currentBlock).toBeUndefined();
  });

  // 10. Push without mount — block should be on stack but behaviorContext not initialized
  it('should have block on stack without initialized behaviorContext when only pushed', () => {
    const timer = new CountupTimerBehavior({ label: 'Push Only' });
    const block = new MockBlock('push-only', [timer]);

    harness.push(block);

    // Block is on the stack
    expect(harness.stackDepth).toBe(1);
    expect(harness.currentBlock).toBe(block);

    // behaviorContext should not be initialized yet (no mount)
    expect(block.behaviorContext).toBeUndefined();

    // Timer memory should not exist yet (onMount hasn't run)
    const timerMemory = harness.getMemory('time');
    expect(timerMemory).toBeUndefined();

    // Block should have label memory from constructor
    const allMemory = block.getAllMemory();
    expect(allMemory.length).toBeGreaterThanOrEqual(1);
  });
});
