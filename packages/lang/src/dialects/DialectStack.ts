import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import type { IDialect } from '@bitcobblers/wod-wiki-core';
import { Registry } from '../registry/Registry';
import { UnitsDialect } from './UnitsDialect';
import { CrossFitDialect } from './CrossFitDialect';
import { WodDialect } from './WodDialect';
import { CardioDialect } from './CardioDialect';
import { YogaDialect } from './YogaDialect';
import { HabitsDialect } from './HabitsDialect';
import { ClimbDialect } from './ClimbDialect';
import { langWarn } from '../logger';

/** Id of the base Units Dialect — always part of a sport-scoped stack. */
const UNITS_DIALECT_ID = 'units';

/**
 * User-facing `:sport` suffixes that differ from their dialect registry id.
 * The fence suffix is a sport name (` ```log:climbing `); the registry id is
 * the dialect's short id (`climb`). Exact registry ids always match directly.
 */
export const SPORT_ALIASES: Readonly<Record<string, string>> = {
    climbing: 'climb',
};

/** Suffixes already warned about — one warning per unknown suffix, not per parse. */
const warnedSports = new Set<string>();

/**
 * DialectStack — the single ordered place where the base Units Dialect and
 * the sport/personal Dialects are composed and run.
 *
 * Replaces both:
 * - The parse-time `baseUnits` singleton in `lezer-mapper.ts` (hardcoded to
 *   one Dialect with no extension hook).
 * - The empty compile-time `DialectRegistry` that was removed from `JitCompiler`
 *   in S5a (no production path ever registered a Dialect).
 *
 * Ordering: base Units Dialect runs first (fuses bare Number + unit-word into
 * dimensioned metrics); sport Dialects run after (they observe fused units);
 * personal-overrides run last (a `CONTEXT.md` concept that was previously
 * impossible). Later-wins metric merge and hint accumulation are handled by
 * the per-statement `transform` + `analyze` + append loop.
 */
export class DialectStack {
    private readonly dialects?: readonly IDialect[];
    private readonly registry?: Registry<IDialect>;

    /**
     * Accepts either a frozen array (the `createDialectStack(overrides)` /
     * test-fixture case) or a live `Registry<IDialect>` (the production
     * singleton below). When constructed from a registry, every `process()`
     * call re-reads `registry.list()`, so a `dialectRegistry.register(...)`
     * made by a consumer after import is honored on the next parse — a
     * frozen array snapshot taken once at module-load time would not see it.
     */
    constructor(dialects: readonly IDialect[] | Registry<IDialect>) {
        if (dialects instanceof Registry) {
            this.registry = dialects;
        } else {
            this.dialects = dialects;
        }
    }

    private get effectiveDialects(): readonly IDialect[] {
        return this.registry ? this.registry.list() : (this.dialects ?? []);
    }

    /**
     * Resolve the effective Dialect list for a block's `:sport` suffix.
     *
     * - No suffix → the full stack (a bare `time`/`log` block — unchanged).
     * - Known suffix (registry id or {@link SPORT_ALIASES} entry) → the base
     *   Units Dialect plus the named sport Dialect, in registration order.
     * - Unknown suffix → warn once per suffix and fall back to the full stack.
     */
    dialectsFor(sport?: string): readonly IDialect[] {
        const all = this.effectiveDialects;
        if (!sport) return all;
        const id = SPORT_ALIASES[sport] ?? sport;
        if (!all.some(d => d.id === id)) {
            if (!warnedSports.has(sport)) {
                warnedSports.add(sport);
                langWarn(
                    `[DialectStack] Unknown :sport suffix "${sport}" — falling back to the full ` +
                    `dialect stack. Known dialect ids: ${all.map(d => d.id).join(', ')}.`,
                );
            }
            return all;
        }
        return all.filter(d => d.id === UNITS_DIALECT_ID || d.id === id);
    }

    /**
     * Process a single statement through the Dialects selected by `sport`
     * (full stack when omitted). Each Dialect's `transform` runs before its
     * `analyze`, and the emitted metrics (hint markers + domain values) are
     * appended onto the statement.
     */
    process(statement: ICodeStatement, sport?: string): void {
        this.applyDialects(statement, this.dialectsFor(sport));
    }

    /** Process a batch of statements through the Dialects selected by `sport`. */
    processAll(statements: ICodeStatement[], sport?: string): void {
        const dialects = this.dialectsFor(sport);
        for (const statement of statements) {
            this.applyDialects(statement, dialects);
        }
    }

    private applyDialects(statement: ICodeStatement, dialects: readonly IDialect[]): void {
        for (const dialect of dialects) {
            dialect.transform?.(statement);
            const analysis = dialect.analyze(statement);
            if (analysis?.metrics?.length) {
                statement.metrics.add(...analysis.metrics);
            }
        }
    }

    /** The ordered Dialect list (for inspection / testing). Live when registry-backed. */
    get list(): readonly IDialect[] {
        return this.effectiveDialects;
    }
}

/**
 * Consumer-facing dialect registry, pre-seeded with the built-in dialects.
 *
 * Replaces the previous `createDialectStack(overrides)` parameter as the way
 * to extend the dialect set. Consumer code can call
 * `dialectRegistry.register(new MyDialect())` to add a personal-overrides
 * dialect, and the production `dialectStack` below reads its ordered list
 * from this registry.
 *
 * Built-ins can be removed or overridden by `id`.
 */
export const dialectRegistry = new Registry<IDialect>([
    // Base — fuses bare Number + unit-word into dimensioned metrics.
    // Must run first so sport Dialects see fused units.
    new UnitsDialect(),

    // Sport Dialects — emit hints (workout.amrap, workout.emom, etc.)
    // and domain-specific metrics (climb grades, cardio distances).
    new CrossFitDialect(),
    new WodDialect(),
    new CardioDialect(),
    new YogaDialect(),
    new HabitsDialect(),
    new ClimbDialect(),
]);

/**
 * Build a DialectStack from an explicit list — preserved signature for
 * tests and the `personal-overrides` pattern. Production uses
 * {@link dialectStack} (which reads the registry) via `extractStatements`.
 */
export function createDialectStack(overrides: IDialect[] = []): DialectStack {
    return new DialectStack([
        // Base — fuses bare Number + unit-word into dimensioned metrics.
        new UnitsDialect(),
        // Sport Dialects — emit hints (workout.amrap, workout.emom, etc.)
        // and domain-specific metrics (climb grades, cardio distances).
        new CrossFitDialect(),
        new WodDialect(),
        new CardioDialect(),
        new YogaDialect(),
        new HabitsDialect(),
        new ClimbDialect(),
        // Personal-overrides Dialect last (later wins). A `CONTEXT.md`
        // concept that was impossible before the Stack existed.
        ...overrides,
    ]);
}

/**
 * Module singleton — the default Dialect Stack used by the parse pipeline.
 *
 * Registry-backed (not a frozen array snapshot): every `process()`/`processAll()`
 * call re-reads {@link dialectRegistry} live, so a consumer `dialectRegistry.register(...)`
 * call is honored on the very next parse, no matter when it happens relative to
 * module load. Equivalent to the old `const baseUnits = new UnitsDialect()` but
 * with the full sport-Dialect set wired, and genuinely extensible.
 */
export const dialectStack: DialectStack = new DialectStack(dialectRegistry);
