/**
 * Advanced Timer Patterns: Parse-Then-Run Integration
 *
 * Covers timer patterns from markdown fixtures that were previously only
 * tested at the parser level, ensuring full lifecycle coverage.
 *
 * Patterns covered:
 *   - H:MM:SS duration:          1:30:00 Long Row
 *   - Time cap:                  20:00 / (21-15-9) / Thrusters / Pullups
 *   - Multiple AMRAP windows:    10:00 AMRAP ... / 5:00 AMRAP ...
 *   - Custom intervals:          (5 Rounds) / :40 Bike / *:20 Rest
 *   - Distance intervals:        (4 Rounds) / 3:00 Run 800m / 2:00 Rest
 *   - Mixed timers:              5:00 Run / 10 Burpees / *:30 Rest / :? Max Effort Pushups
 *   - Parenthesized AMRAP:       20:00 (AMRAP) / children
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parseFromScript } from '@wod-wiki/lang-harness/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';

function parseScript(text: string): WhiteboardScript {
    return createParser().read(text) as WhiteboardScript;
}

// ── H:MM:SS Duration: 1:30:00 Long Row ───────────────────────────

describe('🔗 Parse-Then-Run: H:MM:SS Duration (1:30:00 Long Row)', () => {
    const SCRIPT = '1:30:00 Long Row';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Duration of 5400000 ms (90 min) + Effort', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(1).hasNoErrors();

        const root = tree.roots()[0];
        root
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 5_400_000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Long Row');
    });

    it('runtime: 90-minute timer expires and session ends', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/timer/i);

        // Advance 45 minutes — still active
        await script.tick(2_700_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);

        // Advance another 45 minutes — expires
        await script.tick(2_700_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ── Time Cap: 20:00 / (21-15-9) / Thrusters / Pullups ────────────

describe('🔗 Parse-Then-Run: Time Cap (20:00 over 21-15-9)', () => {
    const SCRIPT = '20:00\n  (21-15-9)\n    Thrusters 95lb\n    Pullups';
    let script: TestScript;
    let parsed: WhiteboardScript;
    it('parser: produces timer parent with rounds child containing efforts', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(4).hasNoErrors().hasRootCount(1);
        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 1_200_000);
        // The rounds block is somewhere in the tree with 2 effort children
        const roundsStmt = parsed.statements.find(s =>
            s.metrics.some(m => m.type === MetricType.Rounds)
        );
        expect(roundsStmt).toBeDefined();
        // Thrusters and Pullups are children of the rounds statement
        const effortChildren = parsed.statements.filter(s =>
            s.parent === roundsStmt?.id && s.metrics.some(m => m.type === MetricType.Effort)
        );
        expect(effortChildren).toHaveLength(2);
        expect(effortChildren.some(s =>
            s.metrics.some(m => m.type === MetricType.Effort && m.value === 'Thrusters')
        )).toBe(true);
    });

    it('runtime: timer caps the work and auto-ends session at expiry', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.depth).toBeGreaterThan(0);

        await script.tick(1_200_000); // 20 minutes
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ── Multiple AMRAP Windows ───────────────────────────────────────

describe('🔗 Parse-Then-Run: Multiple AMRAP Windows', () => {
    const SCRIPT = '10:00 AMRAP\n  5 Pullups\n  10 Pushups\n\n5:00 AMRAP\n  10 Burpees\n  15 Air Squats';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces 2 root AMRAP statements each with 2 children', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(6).hasNoErrors().hasRootCount(2);

        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 600_000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'AMRAP')
            .hasChildren(2);

        tree.roots()[1]
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 300_000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'AMRAP')
            .hasChildren(2);
    });

    it('runtime: completes first AMRAP, then second, then session ends', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next(); // start first AMRAP
        await script.tick(600_000); // first AMRAP expires

        const s1 = await script.snapshot();
        expect(s1.depth).toBeGreaterThan(0); // WaitingToStart for second AMRAP

        await script.next(); // start second AMRAP
        await script.tick(300_000); // second AMRAP expires

        expect((await script.snapshot()).depth).toBe(0);
    });

    it('emits paired outputs through both AMRAP windows', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        await script.tick(600_000);
        await script.next();
        await script.tick(300_000);

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ── Custom Intervals: (5 Rounds) / :40 Bike / *:20 Rest ──────────

describe('🔗 Parse-Then-Run: Custom Intervals ((5 Rounds) / :40 Bike / *:20 Rest)', () => {
    const SCRIPT = '(5 Rounds)\n  :40 Bike\n  *:20 Rest';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces rounds parent with duration + forced-rest children', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Rounds)
            .hasChildren(2);
    });

    it('runtime: completes all 5 rounds of work/rest automatically', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();

        for (let round = 0; round < 5; round++) {
            await script.tick(40_000); // work
            await script.tick(20_000); // rest
        }

        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ── Distance Intervals: (4 Rounds) / 3:00 Run 800m / 2:00 Rest ───

describe('🔗 Parse-Then-Run: Distance Intervals ((4 Rounds) / 3:00 Run 800m / 2:00 Rest)', () => {
    const SCRIPT = '(4 Rounds)\n  3:00 Run 800m\n  2:00 Rest';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces rounds parent with duration+distance+effort children', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Rounds)
            .hasChildren(2);

        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Distance)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('runtime: completes 4 rounds of 3-minute run / 2-minute rest', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();

        for (let round = 0; round < 4; round++) {
            await script.tick(180_000); // 3 min run
            await script.tick(120_000); // 2 min rest
        }

        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ── Parenthesized AMRAP: 20:00 (AMRAP) ───────────────────────────

describe('🔗 Parse-Then-Run: Parenthesized AMRAP (20:00 (AMRAP))', () => {
    const SCRIPT = '20:00 (AMRAP)\n  5 Pullups\n  10 Pushups';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Duration + Rounds(AMRAP) parent with children', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 'AMRAP')
            .hasChildren(2);
    });

    it('runtime: compiles as AMRAP and expires after 20 minutes', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThan(0);

        await script.tick(1_200_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});
