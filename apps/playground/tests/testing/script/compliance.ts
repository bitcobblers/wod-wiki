import { describe, afterEach } from 'bun:test';
import { TestScript } from './TestScript';
import type { TestScriptConfig } from './TestScript';

export interface ComplianceContext {
    /** Compile (or recompile) the script. Assigns to the shared `script` variable. */
    compile(scriptText?: string, config?: TestScriptConfig): Promise<TestScript>;
    /** The currently compiled TestScript, if any. */
    readonly script: TestScript | undefined;
}

/**
 * Compliance-test helper that owns the `describe` block, `script` variable,
 * and `afterEach(dispose)` cleanup.
 *
 * Each `it()` in the callback receives a {@link ComplianceContext}.
 * Call `await ctx.compile()` at the start of each test; the helper guarantees
 * disposal in `afterEach`.
 *
 * Usage:
 * ```ts
 * describeCompliance('Classic AMRAP \u2014 Cindy', SCRIPT, (ctx) => {
 *     it('starts with depth 2', async () => {
 *         const s = await ctx.compile();
 *         expect((await s.snapshot()).depth).toBe(2);
 *     });
 * });
 * ```
 */
export function describeCompliance(
    label: string,
    defaultScript: string,
    fn: (ctx: ComplianceContext) => void,
): void {
    describe(label, () => {
        let script: TestScript | undefined;

        afterEach(async () => {
            if (script) {
                await script.dispose();
                script = undefined;
            }
        });

        const ctx: ComplianceContext = {
            async compile(scriptText = defaultScript, config?) {
                script = await TestScript.compile(scriptText, config);
                return script;
            },
            get script() {
                return script;
            },
        };

        fn(ctx);
    });
}
