import { describe, it, expect, beforeEach } from 'vitest';
import { JitCompiler } from '../../src/runtime/compiler/JitCompiler';
import { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import { CodeStatement } from '@bitcobblers/wod-wiki-core';
import { hintMetric } from '../../src/metrics/hints';
import { DurationMetric } from '../../src/runtime/compiler/metrics/DurationMetric';
import { RoundsMetric } from '../../src/runtime/compiler/metrics/RoundsMetric';
import { RepMetric } from '../../src/runtime/compiler/metrics/RepMetric';
import { AmrapLogicStrategy } from '../../src/runtime/compiler/strategies/logic/AmrapLogicStrategy';
import { IntervalLogicStrategy } from '../../src/runtime/compiler/strategies/logic/IntervalLogicStrategy';
import { GenericTimerStrategy } from '../../src/runtime/compiler/strategies/components/GenericTimerStrategy';
import { GenericLoopStrategy } from '../../src/runtime/compiler/strategies/components/GenericLoopStrategy';
import { SoundStrategy } from '../../src/runtime/compiler/strategies/enhancements/SoundStrategy';
import { ChildrenStrategy } from '../../src/runtime/compiler/strategies/enhancements/ChildrenStrategy';
import { CodeMetadata } from '@bitcobblers/wod-wiki-core';

// Import new aspect-based behaviors for tests
import { 
    CountdownTimerBehavior,
    ChildSelectionBehavior,
    SoundProfileBehavior,
    MetricPromotionBehavior
} from '../../src/runtime/behaviors';

describe("JIT Composition", () => {
    let runtime: IScriptRuntime;
    let compiler: JitCompiler;

    beforeEach(() => {
        runtime = {
            memory: { search: () => undefined }
        } as any;
        compiler = new JitCompiler();
    });

    // Mock Fragments for testing since we don't want to rely on parsing logic in unit test
    class MockTimerMetric extends DurationMetric {
        constructor(ms: number, forceUp: boolean = false) {
             // Compute a proper image string so LabelComposer can read it
             const totalSecs = Math.floor(ms / 1000);
             const mins = Math.floor(totalSecs / 60);
             const secs = totalSecs % 60;
             const image = `${mins}:${secs.toString().padStart(2, '0')}`;
             super(image, forceUp);
        }
    }

    class MockRoundsMetric extends RoundsMetric {
         constructor(val: number) {
             super(val);
         }
    }

    it("should compile AMRAP block using composition with aspect-based behaviors", () => {
        // AMRAP 10 min - uses new aspect-based behaviors
        const statement = new CodeStatement();
        statement.metrics = [
            new MockTimerMetric(600000, true), // AMRAP implies 'up'
            new MockRoundsMetric(1),           // Required for AmrapLogicStrategy.match()
        ];
        (statement.metrics as any).push(hintMetric('behavior.timer'), hintMetric('behavior.rounds'));
        statement.children = [new CodeStatement()]; // Add children to trigger ChildrenStrategy

        compiler.registerStrategy(new AmrapLogicStrategy()); // Priority 90
        compiler.registerStrategy(new GenericTimerStrategy()); // Priority 50
        compiler.registerStrategy(new GenericLoopStrategy()); // Priority 50
        compiler.registerStrategy(new ChildrenStrategy()); // Priority 50
        compiler.registerStrategy(new SoundStrategy()); // Priority 20

        const block = compiler.compile([statement], runtime);

        expect(block).toBeDefined();
        if (!block) return;

        expect(block.blockType).toBe("AMRAP");
        // LabelComposer uses the RoundsMetric image ("1") as the primary metric
        expect(block.label).toBe("1");

        // Check Behaviors - now using aspect-based behaviors
        // AMRAP should have CountdownTimerBehavior (direction: 'down') and ChildSelectionBehavior (unbounded)
        const timer = block.getBehavior(CountdownTimerBehavior);
        expect(timer).toBeDefined();

        const round = block.getBehavior(ChildSelectionBehavior);
        expect(round).toBeDefined();
        // AMRAP has unbounded rounds - startRound is set but totalRounds is undefined
        expect((round as any).config?.startRound).toBe(1);
        expect((round as any).config?.totalRounds).toBeUndefined();
    });

    it("should compile EMOM block using composition with aspect-based behaviors", () => {
        // EMOM 10 min (Every 1 min) - uses new aspect-based behaviors
        const statement = new CodeStatement();
        statement.metrics = [
            new MockTimerMetric(60000), // 1 min interval
            new MockTimerMetric(600000), // 10 min total (optional)
            new MockRoundsMetric(10) // 10 rounds
        ];
        (statement.metrics as any).push(hintMetric('behavior.repeating_interval'));

        compiler.registerStrategy(new IntervalLogicStrategy());
        compiler.registerStrategy(new GenericTimerStrategy());
        compiler.registerStrategy(new SoundStrategy());

        const block = compiler.compile([statement], runtime);

        expect(block).toBeDefined();
        if (!block) return;

        expect(block.blockType).toBe("EMOM");

        const timer = block.getBehavior(CountdownTimerBehavior);
        expect(timer).toBeDefined();
        // Verify restBlockFactory is present (added for leaf node transitions)
        expect((timer as any).config.restBlockFactory).toBeDefined();
        expect(typeof (timer as any).config.restBlockFactory).toBe('function');

        // Should have SoundProfileBehavior (added by SoundStrategy)
        expect(block.getBehavior(SoundProfileBehavior)).toBeDefined();
    });

    it("should compile generic Timer block with aspect-based behaviors", () => {
        // For Time: 5 min - uses new aspect-based behaviors
        const statement = new CodeStatement();
        statement.metrics = [
            new MockTimerMetric(300000)
        ];

        compiler.registerStrategy(new GenericTimerStrategy());
        compiler.registerStrategy(new SoundStrategy());

        const block = compiler.compile([statement], runtime);

        expect(block).toBeDefined();
        expect(block?.blockType).toBe("Timer");
        expect(block?.getBehavior(CountdownTimerBehavior)).toBeDefined();
        expect(block?.getBehavior(SoundProfileBehavior)).toBeDefined();
    });

    it("should auto-detect rep scheme from RepMetrics and add MetricPromotionBehavior", () => {
        // (21-15-9) — parser creates RoundsMetric(3) + 3 RepMetrics
        const meta = new CodeMetadata(0, 0, 0, 0);
        const statement = new CodeStatement();
        statement.metrics = [
            new RoundsMetric(3, meta),
            new RepMetric(21, meta),
            new RepMetric(15, meta),
            new RepMetric(9, meta),
        ];

        compiler.registerStrategy(new GenericLoopStrategy());

        const block = compiler.compile([statement], runtime);

        expect(block).toBeDefined();
        if (!block) return;

        expect(block.blockType).toBe("Rounds");
        // LabelComposer: Rounds image "3" as metric + rep images "21 15 9" as identity
        expect(block.label).toBe("3 21 15 9");

        // MetricPromotionBehavior should be attached with round-robin rep scheme
        const repBehavior = block.getBehavior(MetricPromotionBehavior);
        expect(repBehavior).toBeDefined();
        expect(repBehavior!.repScheme).toEqual([21, 15, 9]);
        expect(repBehavior!.getRepsForRound(1)).toBe(21);
        expect(repBehavior!.getRepsForRound(2)).toBe(15);
        expect(repBehavior!.getRepsForRound(3)).toBe(9);
        // Round-robin wraps
        expect(repBehavior!.getRepsForRound(4)).toBe(21);
    });

    it("should not add MetricPromotionBehavior rep scheme when no RepMetrics present", () => {
        // (3 rounds) — only RoundsMetric, no RepMetrics
        const meta = new CodeMetadata(0, 0, 0, 0);
        const statement = new CodeStatement();
        statement.metrics = [
            new RoundsMetric(3, meta),
        ];

        compiler.registerStrategy(new GenericLoopStrategy());

        const block = compiler.compile([statement], runtime);

        expect(block).toBeDefined();
        if (!block) return;

        expect(block.blockType).toBe("Rounds");
        // LabelComposer uses the RoundsMetric image ("3") as the primary metric
        expect(block.label).toBe("3");

        const repBehavior = block.getBehavior(MetricPromotionBehavior);
        expect(repBehavior).toBeDefined();
        expect(repBehavior!.repScheme).toEqual([]);
    });
});
