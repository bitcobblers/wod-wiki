/**
 * BlockTemplateComposer — executes a `BlockTemplate` against a
 * `BlockBuilder`, replacing the ~20 lines of metadata-and-aspect boilerplate
 * that every compound strategy repeats.
 *
 * Strategies still attach strategy-specific behaviors via
 * `builder.addBehavior(...)` after `compose()` returns.  The composer's job
 * is to materialize the "common chassis" — key, context, label, source
 * ids, fragments, plus the timer/repeater aspects — so the strategy only
 * has to express the *delta*.
 *
 * ## Usage
 *
 * ```ts
 * apply(builder, statements, runtime) {
 *   compose(builder, {
 *     blockType: 'AMRAP',
 *     defaultLabel: 'AMRAP',
 *     statements,
 *     runtime,
 *     timer: { direction: 'down', durationMs, mode: 'complete-block' },
 *     repeater: { startRound: 1, totalRounds: undefined, addCompletion: false },
 *   });
 *   builder.addBehavior(new LabelingBehavior({ mode: 'countdown', label: ... }));
 *   builder.addBehavior(new SoundProfileBehavior({ profile }));
 * }
 * ```
 */
import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { BlockKey } from '@bitcobblers/wod-wiki-core';
import { BlockContext } from '../BlockContext';
import { LabelComposer } from './utils/LabelComposer';
import { PassthroughMetricDistributor } from '../impl/PassthroughMetricDistributor';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import type { BlockBuilder } from './BlockBuilder';
import type { BlockTemplate } from './BlockTemplate';

const DEFAULT_PICK = (statements: ICodeStatement[]): ICodeStatement => statements[0];

/**
 * Apply a {@link BlockTemplate} to the supplied builder.  Returns the
 * label so callers can attach downstream behaviors that reference it
 * (e.g. `LabelingBehavior`, `SoundProfileBehavior`) without re-deriving it.
 */
export function compose(builder: BlockBuilder, template: BlockTemplate): string {
    const { statements, runtime, blockType, defaultLabel } = template;

    const pick = template.pickStatement ?? DEFAULT_PICK;
    const anchorStatement = pick(statements);

    // Block metadata
    const blockKey = template.key ?? new BlockKey();
    const context = template.context ?? new BlockContext(
        runtime,
        blockKey.toString(),
        anchorStatement.exerciseId || ''
    );

    const label = LabelComposer.build(statements, { defaultLabel });

    builder
        .setContext(context)
        .setKey(blockKey)
        .setBlockType(blockType)
        .setLabel(label)
        .setSourceIds(statements.map(s => s.id));

    // Metric fragments — fanned through the existing distributor.  The
    // distributor type doubles as a "display group" key in the
    // existing pipeline, so we honor the override but default to the
    // block type so each strategy keeps its own grouping semantics.
    const distributorType = template.metricDistributorType ?? blockType;
    const distributor = new PassthroughMetricDistributor();
    const filter = template.filterMetrics;
    const metricGroups = statements
        .flatMap(s => {
            const source = filter
                ? MetricContainer.from(s.metrics.filter(filter))
                : MetricContainer.from(s.metrics);
            return distributor.distribute(source, distributorType);
        })
        .filter(group => group.length > 0);
    builder.setFragments(metricGroups);

    // Timer aspect — only emitted when the template carries a timer slot.
    // The composer deliberately keeps the call to `asTimer()` so the
    // existing `CountdownTimerBehavior` factory wiring (including
    // `restBlockFactory`) stays in one place.
    if (template.timer) {
        const t = template.timer;
        // `asTimer` derives `mode` from `completionConfig.completesBlock`:
        //   mode = 'reset-interval' when completesBlock === false
        //   mode = 'complete-block' otherwise (default)
        const completionConfig = t.mode === 'reset-interval'
            ? { completesBlock: false }
            : undefined;
        builder.asTimer({
            direction: t.direction,
            durationMs: t.durationMs,
            label: t.label,
            role: t.role ?? 'primary',
            addCompletion: t.mode !== 'reset-interval',
            completionConfig,
            injectRest: t.injectRest,
            required: t.required,
            ...(template.countdownTimerConfig ?? {}),
        });
    }

    // Repeater aspect — only emitted when the template carries a repeater slot.
    if (template.repeater) {
        const r = template.repeater;
        builder.asRepeater({
            totalRounds: r.totalRounds,
            startRound: r.startRound ?? 1,
            addCompletion: r.addCompletion,
        });
    }

    return label;
}
