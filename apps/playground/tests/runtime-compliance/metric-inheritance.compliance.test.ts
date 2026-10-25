/**
 * Metric Inheritance Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/metric-inheritance.md
 *
 * Covers weight/rep cascading and override scenarios for compliance phase 5.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *
 * All scenarios pass. Standalone metric-context statements (e.g. `95 lb`,
 * `400 m`, `75 kg`) at root level are merged with the immediately following
 * group/loop statement by `buildChildGroupsWithContext` in SessionRootStrategy,
 * causing their metrics to cascade to child blocks via MetricPromotionBehavior.
 *
 * Spec: docs/finishline/compliance-scenarios/metric-inheritance.md
 */
import { it, expect } from 'bun:test';
import { describeCompliance } from '@/testing/script';
import type { TestScript, ScriptState } from '@/testing/script';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns merged display metrics for the current top-of-stack block.
 */
async function currentDisplayMetricContainer(state: ScriptState, script: TestScript): Promise<MetricContainer> {
    const block = state.current;
    if (!block) return MetricContainer.empty('current-display');

    const memoryMetrics = MetricContainer.empty(block.key.toString());
    for (const loc of block.getMemoryByTag('metric:display')) {
        memoryMetrics.merge(loc.metrics);
    }

    const statementMetrics = MetricContainer.empty(block.key.toString());
    for (const statement of script.runtime.script.getIds(block.sourceIds)) {
        statementMetrics.merge(statement.getDisplayMetrics());
    }

    if (statementMetrics.isEmpty) {
        return memoryMetrics;
    }

    const effectiveMetrics = memoryMetrics.clone(block.key.toString());
    const overriddenTypes = new Set(statementMetrics.getDisplayMetrics().map(metric => metric.type));
    for (const metricType of overriddenTypes) {
        effectiveMetrics.remove(metric => metric.type === metricType);
    }

    effectiveMetrics.merge(statementMetrics);
    return effectiveMetrics;
}

/**
 * Returns all resolved display metrics for the current top-of-stack block.
 */
async function currentDisplayMetrics(state: ScriptState, script: TestScript) {
    return (await currentDisplayMetricContainer(state, script)).getDisplayMetrics();
}

/**
 * Returns the Resistance metric value for the current block, or undefined if absent.
 */
async function currentResistance(state: ScriptState, script: TestScript): Promise<{ amount: number | undefined; unit: string } | undefined> {
    const metrics = await currentDisplayMetrics(state, script);
    // Combine split resistance metrics (amount and unit may be stored separately).
    const amountMetric = metrics.find(
        m => m.type === MetricType.Resistance && (m.value as unknown)?.amount !== undefined,
    );
    const unitMetric = metrics.find(
        m => m.type === MetricType.Resistance && (m.value as unknown)?.unit !== undefined && (m.value as unknown)?.amount === undefined,
    );
    if (!amountMetric && !unitMetric) return undefined;
    const amount = (amountMetric?.value as unknown)?.amount as number | undefined;
    const unit = ((amountMetric?.value as unknown)?.unit || (unitMetric?.value as { unit?: string } | undefined)?.unit || '') as string;
    return { amount, unit };
}

/**
 * Returns the rep count for the current block, or undefined if absent.
 */
async function currentReps(state: ScriptState, script: TestScript): Promise<number | undefined> {
    const rep = (await currentDisplayMetricContainer(state, script)).getMetric(MetricType.Rep);
    return rep?.value as number | undefined;
}

/**
 * Returns the Distance metric for the current block, or undefined if absent.
 */
async function currentDistance(state: ScriptState, script: TestScript): Promise<{ amount: number | undefined; unit: string } | undefined> {
    const metrics = await currentDisplayMetrics(state, script);
    const amountMetric = metrics.find(
        m => m.type === MetricType.Distance && (m.value as unknown)?.amount !== undefined,
    );
    const unitMetric = metrics.find(
        m => m.type === MetricType.Distance && (m.value as unknown)?.unit !== undefined,
    );
    if (!amountMetric && !unitMetric) return undefined;
    const amount = (amountMetric?.value as unknown)?.amount as number | undefined;
    const unit = ((amountMetric?.value as unknown)?.unit || (unitMetric?.value as { unit?: string } | undefined)?.unit || '') as string;
    return { amount, unit };
}

/**
 * Returns true when the current block's display metrics include a Resistance entry.
 */
async function currentHasResistance(state: ScriptState, script: TestScript): Promise<boolean> {
    return (await currentDisplayMetricContainer(state, script)).hasMetric(MetricType.Resistance);
}

/**
 * Returns true when the current block's display metrics include a Distance entry.
 */
async function currentHasDistance(state: ScriptState, script: TestScript): Promise<boolean> {
    return (await currentDisplayMetricContainer(state, script)).hasMetric(MetricType.Distance);
}


// ===========================================================================
// 🟢 Weight Inside AMRAP — sibling isolation
//
// Weight stated directly on one exercise (Thrusters 95 lb) must NOT bleed
// to the sibling exercise (Pushups) within the same AMRAP.
//
// Spec: metric-inheritance.md#-weight-inside-amrap
// ===========================================================================

describeCompliance('🟢 Weight Inside AMRAP — sibling weight isolation', '10:00 AMRAP\n  5 Thrusters 95 lb\n  10 Pushups', (ctx) => {

    it('step 1: Thrusters effort is mounted after first userNext', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).current?.label).toMatch(/thrusters/i);
    });

    it('Thrusters effort carries a Resistance metric (95 lb, explicitly set)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
    });

    it('Thrusters resistance amount is 95', async () => {
        const script = await ctx.compile();
        await script.next();
        const r = await currentResistance(await script.snapshot(), script);
        expect(r?.amount).toBe(95);
    });

    it('Thrusters resistance unit is lb', async () => {
        const script = await ctx.compile();
        await script.next();
        const r = await currentResistance(await script.snapshot(), script);
        expect(r?.unit).toBe('lb');
    });

    it('Thrusters rep count is 5', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentReps(await script.snapshot(), script)).toBe(5);
    });

    it('step 2: Pushups effort is mounted after second userNext', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await script.snapshot()).current?.label).toMatch(/pushups/i);
    });

    it('Pushups effort carries NO Resistance metric (sibling weight must not bleed)', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // Pushups
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(false);
    });

    it('Pushups rep count is 10', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect(await currentReps(await script.snapshot(), script)).toBe(10);
    });

    it('round 2: Thrusters still has 95 lb (not lost after one cycle)', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters R1
        await script.next(); // Pushups R1
        await script.next(); // Thrusters R2
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(95);
    });

    it('round 2: Pushups R2 still has NO resistance metric', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters R1
        await script.next(); // Pushups R1
        await script.next(); // Thrusters R2
        await script.next(); // Pushups R2
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(false);
    });

    it('AMRAP timer fires at 10:00 — clean termination', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(600_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Rep Scheme Promotion — (21-15-9) Thrusters + Pull-ups
//
// Each child exercise inside a round should receive the rep count for that
// round from the scheme. All children within the same round share the same
// rep count; consecutive rounds receive decreasing counts.
//
// Spec: metric-inheritance.md#-rep-scheme-promotion
// ===========================================================================
describeCompliance('🟢 Rep Scheme Promotion — (21-15-9) Thrusters + Pull-ups', '(21-15-9)\n  Thrusters\n  Pull-ups', (ctx) => {

    it('Round 1 Thrusters — rep count is 21', async () => {
        const script = await ctx.compile();
        await script.next(); // start → Round 1 → Thrusters
        expect(await currentReps(await script.snapshot(), script)).toBe(21);
    });

    it('Round 1 Pull-ups — rep count is 21 (same round, same count)', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters R1
        await script.next(); // Pull-ups R1
        expect(await currentReps(await script.snapshot(), script)).toBe(21);
    });

    it('Round 2 Thrusters — rep count decreases to 15', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters R1
        await script.next(); // Pull-ups R1
        await script.next(); // Thrusters R2
        expect(await currentReps(await script.snapshot(), script)).toBe(15);
    });

    it('Round 2 Pull-ups — rep count is 15', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next(); // Thrusters R2
        await script.next(); // Pull-ups R2
        expect(await currentReps(await script.snapshot(), script)).toBe(15);
    });

    it('Round 3 Thrusters — rep count decreases to 9', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.next(); // Pull-ups R2
        await script.next(); // Thrusters R3
        expect(await currentReps(await script.snapshot(), script)).toBe(9);
    });

    it('Round 3 Pull-ups — rep count is 9', async () => {
        const script = await ctx.compile();
        for (let i = 0; i < 5; i++) await script.next(); // R1×2 + R2×2 + R3 Thrusters
        await script.next(); // Pull-ups R3
        expect(await currentReps(await script.snapshot(), script)).toBe(9);
    });

    it('completing all 6 child advances terminates session', async () => {
        const script = await ctx.compile();
        for (let i = 0; i < 7; i++) await script.next(); // 3 rounds × 2 children + start
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Weight Cascading — Parent group `95 lb` cascades to round children
//
// When `95 lb` is declared at the root level (same indent as `(3)`), the
// weight cascades to every child effort in the subsequent rounds block.
// `buildChildGroupsWithContext` merges the standalone `95 lb` metric-context
// statement with the following `(3)` rounds block, enabling MetricPromotionBehavior
// to cascade Resistance to all child efforts.
//
// Spec: metric-inheritance.md#-weight-cascading--parent-to-children
// ===========================================================================
describeCompliance('🟢 Weight Cascading — 95 lb cascades to round children', '95 lb\n(3)\n  Clean & Jerk', (ctx) => {

    it('after AMRAP/rounds block starts, Clean & Jerk effort has a Resistance metric', async () => {
        const script = await ctx.compile();
        // Advance past the root-level weight declaration into the rounds/effort
        await script.next(); // WaitingToStart → first block (could be 95 lb effort or rounds)
        // If 95 lb parses as standalone, advance again to reach the rounds child
        if (!(await script.snapshot()).current?.label?.match(/clean/i)) {
            await script.next(); // advance past standalone 95 lb block into rounds → effort
        }
        // The current block should be a Clean & Jerk effort WITH resistance = 95 lb
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
    });

    it('Clean & Jerk carries resistance amount 95', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/clean/i)) {
            await script.next();
        }
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(95);
    });

    it('Clean & Jerk carries resistance unit lb', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/clean/i)) {
            await script.next();
        }
        expect((await currentResistance(await script.snapshot(), script))?.unit).toBe('lb');
    });

    it('Round 2 Clean & Jerk still carries inherited 95 lb resistance', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/clean/i)) {
            await script.next(); // enter rounds → effort R1
        }
        await script.next(); // R1 done → R2 effort
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(95);
    });

    it('Round 3 Clean & Jerk still carries inherited 95 lb resistance', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/clean/i)) {
            await script.next();
        }
        await script.next(); // R2
        await script.next(); // R3
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(95);
    });
});

// ===========================================================================
// 🟢 Weight Override — parent `95 lb` + child `Clean 135 lb` + `Snatch`
//
// Clean explicitly overrides to 135 lb (child wins over parent).
// Snatch does NOT specify a weight → inherits parent's 95 lb via
// MetricPromotionBehavior cascading from the `95 lb` group scope.
//
// Spec: metric-inheritance.md#-weight-override--child-overrides-parent
// ===========================================================================
describeCompliance('🟢 Weight Override — child overrides parent; sibling inherits parent', '95 lb\n  Clean 135 lb\n  Snatch', (ctx) => {

    it('Clean effort is the first child mounted after startSession + userNext', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).current?.label).toMatch(/clean/i);
    });

    it('Clean effort carries a Resistance metric (135 lb, child override)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
    });

    it('Clean resistance amount is 135 (child override wins over parent 95 lb)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(135);
    });

    it('Clean resistance unit is lb', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await currentResistance(await script.snapshot(), script))?.unit).toBe('lb');
    });

    it('Snatch effort is mounted after second userNext (Clean completes)', async () => {
        const script = await ctx.compile();
        await script.next(); // Clean
        await script.next(); // Snatch
        expect((await script.snapshot()).current?.label).toMatch(/snatch/i);
    });

    it('Snatch effort carries a Resistance metric (inherited from parent 95 lb)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
    });

    it('Snatch resistance amount is 95 (parent default, no override)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(95);
    });

    it('Snatch resistance unit is lb (inherited from parent)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await currentResistance(await script.snapshot(), script))?.unit).toBe('lb');
    });
});

// ===========================================================================
// 🟢 Distance Unit Inheritance — `400 m` cascades to `(3)` Run children
//
// `400 m` declared at root level is merged with the following `(3)` rounds
// block by `buildChildGroupsWithContext`. MetricPromotionBehavior then
// cascades the Distance metric to every child Run effort.
//
// Spec: metric-inheritance.md#-distance-unit-inheritance
// ===========================================================================
describeCompliance('🟢 Distance Unit Inheritance — 400 m cascades to round children', '400 m\n(3)\n  Run', (ctx) => {

    it('RunN effort carries a Distance metric (400 m inherited from parent)', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → first block
        // Advance past any non-Run block if needed
        if (!(await script.snapshot()).current?.label?.match(/run/i)) {
            await script.next();
        }
        expect(await currentHasDistance(await script.snapshot(), script)).toBe(true);
    });

    it('Run effort distance amount is 400', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/run/i)) {
            await script.next();
        }
        expect((await currentDistance(await script.snapshot(), script))?.amount).toBe(400);
    });

    it('Run effort distance unit is m', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/run/i)) {
            await script.next();
        }
        expect((await currentDistance(await script.snapshot(), script))?.unit).toBe('m');
    });

    it('All 3 rounds have Run effort with inherited 400 m distance', async () => {
        const script = await ctx.compile();
        await script.next();
        if (!(await script.snapshot()).current?.label?.match(/run/i)) {
            await script.next();
        }
        // R1 should have distance
        expect(await currentHasDistance(await script.snapshot(), script)).toBe(true);
        await script.next(); // R2
        expect(await currentHasDistance(await script.snapshot(), script)).toBe(true);
        await script.next(); // R3
        expect(await currentHasDistance(await script.snapshot(), script)).toBe(true);
    });
});

// ===========================================================================
// 🟢 Three-Level Promotion — 75 kg → EMOM → Rounds → Effort
//
// `75 kg` declared at root level is merged with the following EMOM block by
// `buildChildGroupsWithContext`. MetricPromotionBehavior cascades the
// Resistance metric three levels deep: EMOM → Rounds → Clean effort.
//
// Spec: metric-inheritance.md#-three-level-promotion
// ===========================================================================
describeCompliance('🟢 Three-Level Promotion — 75 kg through EMOM → Rounds → Effort', '75 kg\n(5) 1:00 EMOM\n  (3)\n    Clean', (ctx) => {

    /**
     * Helper: advance through the structure until we reach an effort labelled "Clean".
     * Returns false if we run out of stack (session ended) before finding Clean.
     */
    async function advanceToClean(script: TestScript, maxSteps = 10): Promise<boolean> {
        for (let i = 0; i < maxSteps; i++) {
            if ((await script.snapshot()).current?.label?.match(/clean/i)) return true;
            if ((await script.snapshot()).depth === 0) return false;
            await script.next();
        }
        return (await script.snapshot()).current?.label?.match(/clean/i) !== null;
    }

    it('Clean effort is reachable in the nested structure', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        const found = await advanceToClean(script);
        expect(found).toBe(true);
    });

    it('Clean effort carries a Resistance metric (75 kg from root weight context)', async () => {
        const script = await ctx.compile();
        await script.next();
        await advanceToClean(script);
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
    });

    it('Clean effort resistance amount is 75', async () => {
        const script = await ctx.compile();
        await script.next();
        await advanceToClean(script);
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(75);
    });

    it('Clean effort resistance unit is kg', async () => {
        const script = await ctx.compile();
        await script.next();
        await advanceToClean(script);
        expect((await currentResistance(await script.snapshot(), script))?.unit).toBe('kg');
    });

    it('Second Clean iteration (different EMOM interval) still carries 75 kg', async () => {
        const script = await ctx.compile();
        await script.next();
        await advanceToClean(script); // find first Clean
        await script.next();    // complete first Clean
        // Now advance to the second Clean (next round/interval)
        await script.tick(60_000); // EMOM interval ticks over
        await advanceToClean(script);
        expect(await currentHasResistance(await script.snapshot(), script)).toBe(true);
        expect((await currentResistance(await script.snapshot(), script))?.amount).toBe(75);
    });
});
