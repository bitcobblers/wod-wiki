/**
 * Forced Timer JIT Compilation Tests
 *
 * Tests that forced timers (*5:00 Run, *:30 Rest) compile correctly,
 * produce paired outputs, and require timer completion before next() advances.
 *
 * Forced timers are compiled by GenericTimerStrategy with the
 * `behavior.required_timer` hint, which sets ExitBehavior to
 * `mode: 'immediate', onNext: false, onEvents: ['timer:complete']`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('Forced Timer JIT Compilation', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    describe('*5:00 Run — forced countdown timer', () => {

        it('compiles and starts at depth 2', async () => {
            script = await TestScript.compile('*5:00 Run');
            expect((await script.snapshot()).depth).toBe(2);
        });

        it('starts timer on next()', async () => {
            script = await TestScript.compile('*5:00 Run');
            await script.next();
            const snap = await script.snapshot();
            expect(snap.depth).toBe(2);
            expect(snap.current?.blockType).toMatch(/timer/i);
            expect(snap.current?.label).toContain('Run');
        });

        it('cannot be skipped by next() — depth stays the same', async () => {
            script = await TestScript.compile('*5:00 Run');
            await script.next(); // start
            const depthBefore = (await script.snapshot()).depth;
            await script.next(); // attempt skip
            await script.next(); // another attempt
            expect((await script.snapshot()).depth).toBe(depthBefore);
        });

        it('timer completion emits paired outputs', async () => {
            script = await TestScript.compile('*5:00 Run');
            await script.next(); // start
            await script.tick(300_000); // expire
            const snap = await script.snapshot();
            expect(snap.depth).toBe(0);
            expect(assertions(snap).outputs().assertPairedOutputs()).toEqual([]);
        });

        it('timer completion requires timer:complete event — auto-advances after expiry', async () => {
            script = await TestScript.compile('*5:00 Run');
            await script.next(); // start
            // Advance to just before expiry
            await script.tick(299_000);
            expect((await script.snapshot()).depth).toBeGreaterThan(0);
            // Complete the timer
            await script.tick(1_000);
            expect((await script.snapshot()).depth).toBe(0);
        });
    });

    describe('*:30 Rest — forced rest timer', () => {

        it('compiles and starts at depth 2', async () => {
            script = await TestScript.compile('*:30 Rest');
            expect((await script.snapshot()).depth).toBe(2);
        });

        it('starts forced rest timer on next()', async () => {
            script = await TestScript.compile('*:30 Rest');
            await script.next();
            const snap = await script.snapshot();
            expect(snap.current?.blockType).toMatch(/rest|timer/i);
            expect(snap.current?.label).toContain('Rest');
        });

        it('cannot be skipped by next()', async () => {
            script = await TestScript.compile('*:30 Rest');
            await script.next(); // start
            const depthBefore = (await script.snapshot()).depth;
            await script.next(); // attempt skip
            expect((await script.snapshot()).depth).toBe(depthBefore);
        });

        it('expires after 30s and produces paired outputs', async () => {
            script = await TestScript.compile('*:30 Rest');
            await script.next(); // start
            await script.tick(30_000); // expire
            const snap = await script.snapshot();
            expect(snap.depth).toBe(0);
            expect(assertions(snap).outputs().assertPairedOutputs()).toEqual([]);
        });

        it('emits sound outputs on completion', async () => {
            script = await TestScript.compile('*:30 Rest');
            await script.next(); // start
            // Advance to last 3 seconds for countdown beeps
            await script.tick(27_000); // 3s remaining
            await script.tick(1_000); // 2s
            await script.tick(1_000); // 1s
            await script.tick(1_000); // complete
            const snap = await script.snapshot();
            const soundOutputs = assertions(snap).outputs().all().filter(o =>
                o.metrics.some(m => m.type === 'sound')
            );
            expect(soundOutputs.length).toBeGreaterThan(0);
            // Should have countdown beeps and a completion sound
            const completeSound = soundOutputs.find(o =>
                o.metrics.some(m => m.value?.trigger === 'complete')
            );
            expect(completeSound).toBeDefined();
        });
    });

    describe('Forced timer in multi-statement script', () => {

        it('*:30 Rest between exercises produces paired outputs for all blocks', async () => {
            script = await TestScript.compile('5:00 Run\n10 Burpees\n*:30 Rest\n:? Sprint');
            await script.next(); // start 5:00 Run
            await script.tick(300_000); // expire → effort
            await script.next(); // skip effort → forced rest
            await script.tick(30_000); // expire rest → collectible
            await script.tick(10_000); // some elapsed
            await script.next(); // complete collectible
            const snap = await script.snapshot();
            expect(snap.depth).toBe(0);
            expect(assertions(snap).outputs().assertPairedOutputs()).toEqual([]);
        });

        it('*5:00 Run followed by effort blocks advances correctly', async () => {
            script = await TestScript.compile('*5:00 Run\n10 Burpees\n5 Pushups');
            await script.next(); // start forced timer
            await script.next(); // attempt skip — no-op
            await script.next(); // attempt skip — no-op
            await script.tick(300_000); // expire → effort mounts
            const snap = await script.snapshot();
            expect(snap.depth).toBeGreaterThan(0);
            // Next block should be an effort
            expect(snap.current?.blockType).toMatch(/effort/i);
        });
    });
});
