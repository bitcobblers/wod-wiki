import { TestScript } from './TestScript';
import type { TestScriptConfig } from './TestScript';

export interface ComplianceContext<TScript = TestScript> {
    /** Compile (or recompile) the script. Assigns to the shared `script` variable. */
    compile(scriptText?: string, config?: TestScriptConfig): Promise<TScript>;
    /** The currently compiled TestScript, if any. */
    readonly script: TScript | undefined;
}

type SuiteDescribe = (label: string, fn: () => void) => void;
type SuiteHook = (fn: () => unknown) => void;

/**
 * Resolve `describe`/`afterEach` from the active test runner WITHOUT importing
 * it, so this module loads identically under bun test and vitest.
 * bun test publishes them as globals; vitest suites that call this helper need
 * `globals: true` (the shared contract suites use TestScript directly and never
 * call it).
 * ponytail: if a vitest consumer ever needs describeCompliance, add per-runner
 * adapter modules and select by environment instead of globals.
 */
function runnerHooks(): { describe: SuiteDescribe; afterEach: SuiteHook } {
    const g = globalThis as unknown as { describe?: SuiteDescribe; afterEach?: SuiteHook };
    if (typeof g.describe !== 'function' || typeof g.afterEach !== 'function') {
        throw new Error(
            'describeCompliance requires runner globals: bun test provides them automatically; vitest requires `globals: true`.',
        );
    }
    return { describe: g.describe, afterEach: g.afterEach };
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
export function createComplianceRunner<TScript extends { dispose(): Promise<void> }>(
    compileFn: (scriptText: string, config?: TestScriptConfig) => Promise<TScript>,
) {
    return function describeComplianceWith(
        label: string,
        defaultScript: string,
        fn: (ctx: ComplianceContext<TScript>) => void,
    ): void {
        const { describe, afterEach } = runnerHooks();
        describe(label, () => {
            let script: TScript | undefined;

            afterEach(async () => {
                if (script) {
                    await script.dispose();
                    script = undefined;
                }
            });

            const ctx: ComplianceContext<TScript> = {
                async compile(scriptText = defaultScript, config?) {
                    script = await compileFn(scriptText, config);
                    return script;
                },
                get script() {
                    return script;
                },
            };

            fn(ctx);
        });
    };
}

export const describeCompliance = createComplianceRunner((scriptText, config) =>
    TestScript.compile(scriptText, config),
);
