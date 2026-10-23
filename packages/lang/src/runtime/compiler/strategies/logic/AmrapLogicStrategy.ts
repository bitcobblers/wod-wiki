import { IRuntimeBlockStrategy } from "../../../contracts/IRuntimeBlockStrategy";
import { BlockBuilder } from "../../BlockBuilder";
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import type { IRuntimeContext } from "../../../contracts/IRuntimeContext";
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { DurationMetric } from "../../metrics/DurationMetric";
import { compose } from "../../BlockTemplateComposer";
import type { BlockTemplate } from "../../BlockTemplate";
import {
    LabelingBehavior
} from "../../../behaviors";

/**
 * AmrapLogicStrategy handles "As Many Rounds As Possible" blocks.
 *
 * Pattern: Timer (countdown) + Rounds (unbounded)
 *
 * Uses aspect composer methods:
 * - .asTimer() - Time tracking with countdown
 * - .asRepeater() - Unbounded rounds (no completion)
 * Plus specific behaviors for display, output, rest, and sound.
 */
export class AmrapLogicStrategy implements IRuntimeBlockStrategy {
    priority = 90; // High priority - runs before generic strategies
    readonly id = 'amrap-logic';

    match(statements: ICodeStatement[], _runtime: IRuntimeContext): boolean {
        if (!statements || statements.length === 0) return false;
        
        // Match if ANY statement has timer and ANY statement has rounds/amrap keyword
        const hasTimer = statements.some(s => s.hasMetric(MetricType.Duration));
        const hasRounds = statements.some(s => s.hasMetric(MetricType.Rounds));
        const hasRoundsKeyword = statements.some(s => s.metrics.some(
            f => (f.type === MetricType.Effort || f.type === MetricType.Action)
                && typeof f.value === 'string'
                && (f.value.toLowerCase() === 'rounds' || f.value.toLowerCase() === 'amrap')
        ));

        return hasTimer && (hasRounds || hasRoundsKeyword);
    }

    apply(builder: BlockBuilder, statements: ICodeStatement[], runtime: IRuntimeContext): void {
        const firstStatementWithTimer = statements.find(s => s.hasMetric(MetricType.Duration)) || statements[0];

        const timerFragment = firstStatementWithTimer.metrics.find(
            f => f.type === MetricType.Duration
        ) as DurationMetric | undefined;
        const durationMs = timerFragment?.value || 0;

        // Build the common chassis via the template composer; strategy-specific
        // behaviors (Labeling, SoundCue) are added below.
        const template: BlockTemplate = {
            blockType: 'AMRAP',
            defaultLabel: `AMRAP ${Math.round(durationMs / 60000)} min`,
            statements,
            runtime,
            // AMRAP uses countdown timer that marks block complete when expired
            timer: {
                direction: 'down',
                durationMs,
                label: 'AMRAP',
                role: 'primary',
                mode: 'complete-block',
                injectRest: false,
            },
            // Unbounded rounds — no completion on round exhaustion, the timer
            // drives completion.
            repeater: {
                totalRounds: undefined,
                startRound: 1,
                addCompletion: false,
            },
            pickStatement: (stmts) => stmts.find(s => s.hasMetric(MetricType.Duration)) || stmts[0],
        };

        const label = compose(builder, template);

        // =====================================================================
        // Display Aspect
        // =====================================================================
        builder.addBehavior(new LabelingBehavior({
            mode: 'countdown',
            label
        }));

        // Sound cues are attached by SoundStrategy from the block's sound
        // profile — no cues are hardcoded here.
    }
}
