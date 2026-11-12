/**
 * BlockTemplate — the data-only shape of a strategy's intent.
 *
 * The five "compound" strategies (`GenericTimerStrategy`,
 * `GenericLoopStrategy`, `GenericGroupStrategy`, `IntervalLogicStrategy`,
 * `AmrapLogicStrategy`) all repeat the same builder chain:
 *
 *   1. resolve first statement that owns the relevant metric
 *   2. mint a fresh `BlockKey` and `BlockContext`
 *   3. ask `LabelComposer` to derive the human-readable label
 *   4. fan the source metrics through `PassthroughMetricDistributor`
 *   5. write key / context / label / sourceIds / fragments onto the builder
 *   6. apply the relevant aspect composers (`asTimer`, `asRepeater`, …)
 *   7. attach one or two aspect-specific behaviors
 *
 * Phase C of plan-candidates-2-3-4-5 lifts steps 1-5 into a single
 * data object so the per-strategy `apply()` only has to express the
 * *delta* — the timer/repeater/sound cue config that distinguishes an
 * AMRAP from a Timer from a Group.
 *
 * @see BlockTemplateComposer for the executor that materializes a
 * template onto a `BlockBuilder`.
 */
import type { IMetric } from '@bitcobblers/wod-wiki-core';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import type { IRuntimeContext } from '../contracts/IRuntimeContext';
import type { IBlockContext } from '../contracts/IBlockContext';
import type { BlockKey } from '@bitcobblers/wod-wiki-core';
import type { CountdownMode, CountdownTimerConfig } from '../behaviors/CountdownTimerBehavior';
import type { TimerPolarity } from '../memory/MemoryTypes';
import type { RepeaterConfig } from './BlockBuilder';

export interface TimerAspectConfig {
    /** `down` with a duration => CountdownTimerBehavior; otherwise Countup. */
    direction: 'up' | 'down';
    durationMs?: number;
    label?: string;
    role?: 'primary' | 'secondary' | 'hidden' | 'auto';
    /** Countdown mode: marks block complete vs. resets interval. */
    mode?: CountdownMode;
    /** Auto-push a Rest block on next() if more than 1s remains. */
    injectRest?: boolean;
    /** Required timers cannot be skipped by user `next`. */
    required?: boolean;
    /** Semantic Work vs Rest polarity stored in TimerState. */
    polarity?: TimerPolarity;
}

export interface RepeaterAspectConfig extends RepeaterConfig {
    /** Round at which the counter starts. Defaults to 1. */
    startRound?: number;
}

/**
 * Optional secondary behaviors the strategy wants added after the
 * common boilerplate is in place.  `BlockTemplateComposer` does NOT
 * attach these — strategies still call `builder.addBehavior(...)` for
 * any strategy-specific behaviors.  This keeps the template focused on
 * the duplicated metadata and aspect-composition path.
 */
export interface BlockTemplate {
    /** Block type tag (e.g. `'Timer'`, `'AMRAP'`, `'EMOM'`, `'Group'`). */
    blockType: string;
    /** Human-readable label fallback when `LabelComposer` returns blank. */
    defaultLabel: string;
    /** Source statements the strategy is currently compiling. */
    statements: ICodeStatement[];
    /** Runtime used to construct per-block `BlockContext` instances. */
    runtime: IRuntimeContext;
    /** Optional pre-minted `BlockKey` (otherwise a fresh one is created). */
    key?: BlockKey;
    /** Optional pre-built `BlockContext` (otherwise a fresh one is created). */
    context?: IBlockContext;
    /** Timer aspect, when the block owns a countdown/countup timer. */
    timer?: TimerAspectConfig;
    /** Repeater aspect, when the block owns round/iteration state. */
    repeater?: RepeaterAspectConfig;
    /**
     * Filter predicate that picks the statement used as the source of
     * label/exerciseId. Defaults to the first statement.
     */
    pickStatement?: (statements: ICodeStatement[]) => ICodeStatement;
    /**
     * Filter for which metrics flow into the `metric:display` memory
     * locations. Defaults to all non-`Hint`/`Choice` metrics from every
     * statement, run through `PassthroughMetricDistributor`.
     */
    metricDistributorType?: string;
    /**
     * Optional filter to drop specific metrics before they are fanned
     * through the distributor. Used by strategies (e.g. Rounds) that
     * want to suppress metric types the legacy path excluded.
     */
    filterMetrics?: (metric: IMetric) => boolean;
    /** Override the `CountdownTimerBehavior` config when supplied. */
    countdownTimerConfig?: Partial<CountdownTimerConfig>;
}
