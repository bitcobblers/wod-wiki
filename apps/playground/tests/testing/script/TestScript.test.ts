import { describe, it, expect, afterEach } from 'bun:test';
import { TestScript } from './TestScript';

describe('TestScript builder', () => {
    let script: TestScript | undefined;

    afterEach(async () => {
        if (script) {
            await script.dispose();
            script = undefined;
        }
    });

    it('compile returns a TestScript with a non-empty stack', async () => {
        script = await TestScript.compile('5:00 Run\n');
        expect(script.runtime.stack.count).toBeGreaterThan(0);
    });

    it('snapshot returns a frozen ScriptState with the right shape', async () => {
        script = await TestScript.compile('5:00 Run\n');
        const state = await script.snapshot();
        expect(Array.isArray(state.blocks)).toBe(true);
        expect(typeof state.depth).toBe('number');
        expect(state.clockTime instanceof Date).toBe(true);
        expect(Array.isArray(state.castSent)).toBe(true);
        expect(Array.isArray(state.stackHistory)).toBe(true);
        expect(Object.isFrozen(state)).toBe(true);
    });

    it('next advances the stack', async () => {
        script = await TestScript.compile('5:00 Run\n');
        const before = await script.snapshot();
        await script.next();
        const after = await script.snapshot();
        const changed = before.depth !== after.depth || before.current?.key !== after.current?.key;
        expect(changed).toBe(true);
    });

    it('userEvent does not crash when no handler matches', async () => {
        script = await TestScript.compile('5:00 Run\n');
        await expect(script.userEvent('tick', { data: 'x' })).resolves.toBe(script);
    });

    it('cast.sent accumulates rpc-stack-update messages', async () => {
        script = await TestScript.compile('5:00 Run\n');
        await script.snapshot();
        const updates = script.cast.filter('rpc-stack-update');
        expect(updates.length).toBeGreaterThan(0);
    });
});
