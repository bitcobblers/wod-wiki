/**
 * Parser Compliance: Parse-Then-Run Integration
 *
 * Demonstrates the "parse first, validate tree, then pass to runtime" pattern.
 * Uses the shared WhiteboardScript to avoid double-parsing:
 *
 *   1. Parse once via createParser() → WhiteboardScript
 *   2. Assert on the statement tree via parseFromScript()
 *   3. Hand the same script to TestScript.fromScript() for runtime testing
 *
 * This is the pattern from the proposal §2.7.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parseFromScript } from '@wod-wiki/lang-harness/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { TestScript } from '@wod-wiki/lang-harness/script';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';

function parseScript(text: string): WhiteboardScript {
    return createParser().read(text) as WhiteboardScript;
}

// ── Single Effort: parse then run ─────────────────────────────────

describe('🔗 Parse-Then-Run: Single Effort (10 Pullups)', () => {
    const SCRIPT = '10 Pullups';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces correct statement tree', () => {
        parsed = parseScript(SCRIPT);
        parseFromScript(parsed)
            .hasStatementCount(1)
            .hasNoErrors()
            .roots()[0]
                .isLeaf()
                .hasMetric(MetricType.Rep)
                .hasMetricValue(MetricType.Rep, 10)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Pullups');
    });

    it('runtime: executes effort correctly', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        // SessionRoot + WaitingToStart
        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2);

        // next() mounts the effort
        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/effort/i);

        // Second next() completes the effort
        await script.next();
        const s2 = await script.snapshot();
        expect(s2.depth).toBe(0);
    });
});

// ── Countdown Timer: parse then run ───────────────────────────────

describe('🔗 Parse-Then-Run: Countdown Timer (5:00 Run)', () => {
    const SCRIPT = '5:00 Run';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces Duration + Effort metrics', () => {
        parsed = parseScript(SCRIPT);
        parseFromScript(parsed)
            .hasStatementCount(1)
            .hasNoErrors()
            .roots()[0]
                .hasMetric(MetricType.Duration)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('runtime: timer starts and expires', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.current?.blockType).toMatch(/timer/i);

        // Advance past halfway — timer still active
        await script.tick(150_000);
        const s2 = await script.snapshot();
        expect(s2.depth).toBeGreaterThan(0);

        // Advance past end — timer expires
        await script.tick(150_000);
        const s3 = await script.snapshot();
        expect(s3.depth).toBe(0);
    });
});

// ── AMRAP: parse then run ─────────────────────────────────────────

describe('🔗 Parse-Then-Run: AMRAP (10:00 AMRAP + children)', () => {
    const SCRIPT = '10:00 AMRAP\n  5 Pullups\n  10 Pushups';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces parent with 2 children + dialect hints', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        tree.roots()[0]
            .hasChildren(2)
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'AMRAP')
            .hasHint('workout.amrap');

        tree.roots()[0].children()[0]
            .hasMetricValue(MetricType.Rep, 5)
            .hasMetricValue(MetricType.Effort, 'Pullups');

        tree.roots()[0].children()[1]
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetricValue(MetricType.Effort, 'Pushups');
    });

    it('runtime: compiles and starts AMRAP session', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        // SessionRoot + WaitingToStart
        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2);

        // next() starts the AMRAP
        await script.next();
        const s1 = await script.snapshot();
        expect(s1.depth).toBeGreaterThan(0);
    });
});

// ── Rounds: parse then run ────────────────────────────────────────

describe('🔗 Parse-Then-Run: Rounds (3 rounds + 2 movements)', () => {
    const SCRIPT = '(3)\n  10 Air Squats\n  10 Push Ups';
    let script: TestScript;
    let parsed: WhiteboardScript;

    afterEach(async () => { if (script) await script.dispose(); script = undefined; });

    it('parser: produces parent with 2 children + rounds metric', () => {
        parsed = parseScript(SCRIPT);
        const tree = parseFromScript(parsed);
        tree.hasStatementCount(3).hasNoErrors();

        const parent = tree.roots()[0];
        parent
            .hasChildren(2)
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 3);

        // Verify children reference parent
        for (const child of parent.children()) {
            child.hasParent(parent);
        }
    });

    it('runtime: compiles and starts rounds session', async () => {
        parsed = parseScript(SCRIPT);
        script = await TestScript.fromScript(parsed);

        const s0 = await script.snapshot();
        expect(s0.depth).toBe(2);

        await script.next();
        const s1 = await script.snapshot();
        expect(s1.depth).toBeGreaterThan(0);
    });
});
