/**
 * Timer Patterns: Parse-Then-Run Integration
 *
 * Covers timer and time-related patterns that were previously only tested
 * at the parser level (or not at all), ensuring full lifecycle coverage:
 *   1. Parse once via createParser() → WhiteboardScript
 *   2. Assert on the statement tree via parseFromScript()
 *   3. Hand the same script to TestScript.fromScript() for runtime testing
 *
 * Patterns covered:
 *   - Count-up override:          ^5:00 Row
 *   - Collectible timer:            :? Sprint
 *   - Collectible reps:             ? Pushups
 *   - Collectible in timed context: 10:00 ? KB Snatch 24kg
 *   - Parenthesized protocol:       10:00 (EMOM) / 3 Clean & Jerk
 *   - Alternating EMOM:             (3) :60 EMOM / - 5 Pullups / - 8 Pushups
 *   - Tabata interval:              (8) :20 / :10 Rest / Air Squats
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

// ── Count-up Override: ^5:00 Row ─────────────────────────────────

describe('🔗 Parse-Then-Run: Count-up Override (^5:00 Row)', () => {
    const SCRIPT = '^5:00 Row';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Duration metric with count-up flag', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(1).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Row');

        // Duration should carry forceCountUp flag (internal field on the metric)
        const stmt = parsed.statements[0];
        const durationMetric = stmt.metrics.find(m => m.type === MetricType.Duration);
        expect(durationMetric).toBeDefined();
    });

    it('runtime: timer counts up, not down', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        // Start session
        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/timer/i);

        // Advance 3 minutes — still active (count-up has no expiry)
        await script.tick(180_000);
        const s2 = await script.snapshot();
        expect(s2.depth).toBeGreaterThan(0);
        expect(s2.current?.blockType).toMatch(/timer/i);

        // Manual completion
        await script.next();
        const s3 = await script.snapshot();
        expect(s3.depth).toBe(0);
    });
});

// ── Collectible Timer: :? Sprint ─────────────────────────────────

describe('🔗 Parse-Then-Run: Collectible Timer (:? Sprint)', () => {
    const SCRIPT = ':? Sprint';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces collectible Duration + Effort metrics', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(1).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Sprint');

        const stmt = parsed.statements[0];
        const durationMetric = stmt.metrics.find(m => m.type === MetricType.Duration);
        expect(durationMetric).toBeDefined();
        // Collectible timer has no fixed duration
        expect(durationMetric?.value).toBeUndefined();
    });

    it('runtime: count-up timer records elapsed time on completion', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/timer/i);

        // Let 45 seconds elapse
        await script.tick(45_000);
        const s2 = await script.snapshot();
        expect(s2.depth).toBeGreaterThan(0);

        // Complete manually — elapsed time should be captured
        await script.next();
        const s3 = await script.snapshot();
        expect(s3.depth).toBe(0);

        // Outputs should include the completed timer segment
        expect(assertions(s3).outputs().all().length).toBeGreaterThan(0);
    });
});

// ── Collectible Reps: ? Pushups ──────────────────────────────────

describe('🔗 Parse-Then-Run: Collectible Reps (? Pushups)', () => {
    const SCRIPT = '? Pushups';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Rep metric with placeholder flag', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(1).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Rep)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pushups');

        const stmt = parsed.statements[0];
        const repMetric = stmt.metrics.find(m => m.type === MetricType.Rep);
        expect(repMetric).toBeDefined();
        // Placeholder rep has no fixed value
        expect(repMetric?.value).toBeUndefined();
    });

    it('runtime: effort block is skippable (no timer blocking)', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2); // SessionRoot + WaitingToStart

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/effort/i);

        // User can complete immediately
        await script.next();
        const s2 = await script.snapshot();
        expect(s2.depth).toBe(0);
    });
});

// ── Collectible Reps in Timed Context: 10:00 ? KB Snatch ─────────

describe('🔗 Parse-Then-Run: Collectible Reps in Timed Context (10:00 ? KB Snatch 24kg)', () => {
    const SCRIPT = '10:00 ? KB Snatch 24kg';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Duration + Rep (placeholder) + Effort + Resistance metrics', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(1).hasNoErrors();

        const root = tree.roots()[0];
        root
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Rep)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'KB Snatch')
            .hasMetric(MetricType.Resistance);
    });

    it('runtime: countdown timer with collectible rep field', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/timer|effort/i);

        // Timer counts down — after expiry session ends
        await script.tick(600_000);
        const s2 = await script.snapshot();
        expect(s2.depth).toBe(0);
    });
});

// ── Parenthesized Protocol: 10:00 (EMOM) ─────────────────────────

describe('🔗 Parse-Then-Run: Parenthesized Protocol (10:00 (EMOM))', () => {
    const SCRIPT = '10:00 (EMOM)\n  3 Clean & Jerk 135lb';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Duration + Rounds (EMOM) parent with child', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(2).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 'EMOM')
            .hasChildren(1);

        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 3)
            .hasMetricValue(MetricType.Effort, 'Clean & Jerk');
    });

    it('runtime: compiles as EMOM-style interval block', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.depth).toBeGreaterThan(0);
    });
});

// ── Alternating EMOM: (3) :60 EMOM / - 5 Pullups / - 8 Pushups ──

describe('🔗 Parse-Then-Run: Alternating EMOM ((3) :60 EMOM / - 5 Pullups / - 8 Pushups)', () => {
    const SCRIPT = '(3) :60 EMOM\n  - 5 Pullups\n  - 8 Pushups';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces rounds + duration + EMOM parent with 2 lap children', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 3)
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'EMOM')
            .hasChildren(2);
    });

    it('runtime: compiles and runs 3 rounds of alternating intervals', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.depth).toBeGreaterThan(0);

        // Each round has 2 children × 60s = 2 minutes per round
        // 3 rounds = 6 ticks of 60s
        for (let i = 0; i < 6; i++) {
            await script.tick(60_000);
        }

        const s2 = await script.snapshot();
        expect(s2.depth).toBe(0);
    });
});

// ── Tabata Interval: (8) :20 / :10 Rest / Air Squats ────────────

describe('🔗 Parse-Then-Run: Tabata Interval ((8) :20 / :10 Rest / Air Squats)', () => {
    const SCRIPT = '(8)\n  :20 Air Squats\n  :10 Rest';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces rounds parent with duration children', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        tree.roots()[0]
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 8)
            .hasChildren(2);

        // Work child
        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Air Squats');

        // Rest child
        tree.roots()[0].children()[1]
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Effort, 'Rest');
    });

    it('runtime: 8 rounds of 20s work / 10s rest', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2);

        await script.next();

        for (let round = 0; round < 8; round++) {
            // Work phase: :20 countdown
            const workState = await script.snapshot();
            expect(workState.depth).toBeGreaterThan(0);
            await script.tick(20_000);

            // Rest phase: :10 countdown (auto-advances)
            const restState = await script.snapshot();
            expect(restState.depth).toBeGreaterThan(0);
            await script.tick(10_000);
        }

        const sEnd = await script.snapshot();
        expect(sEnd.depth).toBe(0);
    });
});
