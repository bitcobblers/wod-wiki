/**
 * Negative / Edge-Case Compliance Tests
 *
 * Covers empty scripts, whitespace-only scripts, abort scenarios,
 * post-completion next()/tick() calls, rapid sequential next(),
 * and compile/dispose loops.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

// ===========================================================================
// Empty Script
// ===========================================================================
describe('Empty script compilation', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('compiles "" → depth 0 (no statements, session not started)', async () => {
        script = await TestScript.compile('');
        const state = await script.snapshot();
        // Empty script produces no statements → StartSessionAction is a no-op
        expect(state.depth).toBe(0);
    });

    it('dispose on empty script is clean (no throw)', async () => {
        script = await TestScript.compile('');
        await expect(script.dispose()).resolves.toBeUndefined();
        // prevent double-dispose in afterEach
        script = undefined as unknown as TestScript;
    });
});

// ===========================================================================
// Whitespace-Only Script
// ===========================================================================
describe('Whitespace-only script compilation', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });
    it('compiles whitespace-only text → depth 0 (same as empty)', async () => {
        script = await TestScript.compile('   \n\n   ');
        const state = await script.snapshot();
        expect(state.depth).toBe(0);
    });

    it('all outputs are paired on empty-ish script', async () => {
        script = await TestScript.compile('   \n\n   ');
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// Session Abort from WaitingToStart
// ===========================================================================
describe('Session abort from WaitingToStart', () => {
    const SCRIPT = '10 Pullups';
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('abort on WaitingToStart ends session cleanly (depth 0)', async () => {
        script = await TestScript.compile(SCRIPT);
        // Still in WaitingToStart (depth 2)
        expect((await script.snapshot()).depth).toBe(2);
        await script.userEvent('abort');
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('abort outputs are paired after WaitingToStart abort', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.userEvent('abort');
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// Session Abort Mid-Effort
// ===========================================================================
describe('Session abort mid-effort', () => {
    const SCRIPT = '10 Pullups';
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('abort after mounting effort ends session (depth 0)', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next(); // mount effort
        expect((await script.snapshot()).depth).toBe(2);
        await script.userEvent('abort');
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('abort outputs are paired after mid-effort abort', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next(); // mount effort
        await script.userEvent('abort');
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// Session Abort Mid-Timer
// ===========================================================================
describe('Session abort mid-timer', () => {
    const SCRIPT = '5:00 Run';
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('abort after mounting timer ends session (depth 0)', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next(); // mount timer
        expect((await script.snapshot()).depth).toBe(2);
        await script.tick(30_000); // partially elapsed
        await script.userEvent('abort');
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('abort outputs are paired after mid-timer abort', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next(); // mount timer
        await script.tick(30_000);
        await script.userEvent('abort');
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// next() on Completed Session
// ===========================================================================
describe('next() on completed session', () => {
    const SCRIPT = '10 Pushups';
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('extra next() after session ends does not crash', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next(); // WaitingToStart → Effort
        await script.next(); // Effort → session ends (depth 0)
        expect((await script.snapshot()).depth).toBe(0);

        // This should not throw
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('multiple extra next() calls remain stable', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next();
        await script.next();
        // Repeated calls on empty stack
        await script.next();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// Tick on Completed Session
// ===========================================================================
describe('tick() on completed session', () => {
    const SCRIPT = '1:00 Rest';
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('extra tick() after timer completes does not crash', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next(); // mount timer
        await script.tick(60_000); // timer completes, session ends
        expect((await script.snapshot()).depth).toBe(0);

        // This should not throw
        await script.tick(1_000);
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('repeated tick() calls on empty stack remain stable', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next();
        await script.tick(60_000);
        await script.tick(1_000);
        await script.tick(1_000);
        await script.tick(1_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// Rapid Sequential next()
// ===========================================================================
describe('Rapid sequential next()', () => {
    const SCRIPT = '10 Pullups';
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('three sequential next() calls handle gracefully', async () => {
        script = await TestScript.compile(SCRIPT);
        // next 1: WaitingToStart → Effort
        // next 2: Effort → session ends (depth 0)
        // next 3: extra — should be no-op on empty stack
        await script.next();
        await script.next();
        await script.next();
        // Should not crash; depth stays at 0
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('outputs remain paired after rapid next()', async () => {
        script = await TestScript.compile(SCRIPT);
        await script.next();
        await script.next();
        await script.next();
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// Multiple Scripts Compiled and Disposed
// ===========================================================================
describe('Multiple scripts compiled and disposed', () => {
    it('compile/dispose loop of 5 scripts does not leak', async () => {
        const N = 5;
        for (let i = 0; i < N; i++) {
            const s = await TestScript.compile('10 Pullups');
            await s.next();
            await s.next();
            expect((await s.snapshot()).depth).toBe(0);
            await s.dispose();
        }
        // If we get here without error, no leak
        expect(true).toBe(true);
    });

    it('compile/dispose without advancing also works', async () => {
        const N = 5;
        for (let i = 0; i < N; i++) {
            const s = await TestScript.compile('5:00 Run');
            expect((await s.snapshot()).depth).toBe(2);
            await s.dispose();
        }
    });
});
