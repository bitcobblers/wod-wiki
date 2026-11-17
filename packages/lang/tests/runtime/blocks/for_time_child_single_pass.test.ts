
import { describe, it, expect } from 'vitest';
import { RuntimeTestBuilder } from '@wod-wiki/lang-harness/harness/RuntimeTestBuilder';
import { GenericTimerStrategy } from '@bitcobblers/wod-wiki-engine';
import { ChildrenStrategy } from '@bitcobblers/wod-wiki-engine';
import { EffortFallbackStrategy } from '@bitcobblers/wod-wiki-engine';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';

describe('For Time Child Single Pass Test', () => {
    it('should run children only once for For Time (Unbound Timer)', () => {
        // "For Time" is implied if we have a timer metrics but no duration?
        // Actually, GenericTimerStrategy implies "For Time" if direction is UP and no duration?
        // But MD Timer parser requires duration for 20:00.
        // How do we express "For Time" in WOD syntax without explicit duration?
        // Usually "For Time" is a heading action `[:For Time]`.
        // But here we want to trigger GenericTimerStrategy to produce UnboundTimerBehavior.

        // If we use `0:00` maybe? Or just `[:For Time]`?
        // GenericTimerStrategy matches `MetricType.Duration`.
        // `[:For Time]` produces an Action metric, NOT a Timer metric usually.

        // However, `GenericTimerStrategy` matches `statements[0].hasMetric(MetricType.Duration)`.

        // If I write `0:00`, it parses as Timer with value 0.
        // `GenericTimerStrategy`:
        // const durationMs = timerFragment?.value || undefined;
        // if 0 is treated as undefined (falsy)?

        // `MdTimerRuntime` parses `0:00` as value 0.
        // In JS `0 || undefined` is undefined.
        // So `durationMs` becomes undefined.
        // `timerBehavior = new UnboundTimerBehavior(label);`

        const script = `0:00
  5 pullups
  10 push ups`;

        const builder = new RuntimeTestBuilder()
            .withScript(script)
            .withStrategy(new GenericTimerStrategy())
            .withStrategy(new ChildrenStrategy())
            .withStrategy(new EffortFallbackStrategy());

        const testHarness = builder.build();

        const statement = testHarness.script.statements[0];
        const block = testHarness.jit.compile([statement as ICodeStatement], testHarness.runtime);
        if (!block) throw new Error('Failed to compile block');

        testHarness.runtime.pushBlock(block);

        expect(block.blockType).toBe('Timer');

        // 1. First Child: 5 pullups
        expect(testHarness.currentBlock?.label).toBe('5 pullups');
        testHarness.runtime.popBlock();

        // 2. Second Child: 10 push ups
        expect(testHarness.currentBlock?.label).toBe('10 push ups');
        testHarness.runtime.popBlock();

        // 3. Should finish (stack should pop the Timer block itself)
        // stackDepth should go from 2 (Timer+Child) -> 1 (Timer) -> 0 (Empty) automatically if SinglePassBehavior works.
        // Wait, popBlock() on child triggers parent.next().
        // parent.next() checks SinglePassBehavior.
        // If complete, it marks the block as complete.
        // ScriptRuntime sweeps completed blocks and pops them.

        // So after popping the 2nd child, the stack should be empty (or at least Timer block popped).

        // Note: ScriptRuntime.popBlock for the child executes immediately.
        // Then parent.next() queues pop-block.
        // Which is executed immediately by processActions.

        expect(testHarness.stackDepth).toBe(0);
    });
});
