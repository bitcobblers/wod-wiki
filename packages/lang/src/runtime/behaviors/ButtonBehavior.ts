import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import type { ButtonConfig } from '../memory/MemoryTypes';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';

// Re-export types for consumers
export type { ButtonConfig };

export interface ControlsConfig {
    /** Initial buttons to display */
    buttons: ButtonConfig[];
}

/**
 * ButtonBehavior initializes control button state in memory.
 *
 * ## Aspect: Controls
 *
 * Sets up the button configurations in memory that the UI observes.
 * When buttons are clicked, the UI emits the corresponding `eventName`
 * as an external event that behaviors can subscribe to.
 *
 * ## Memory Contract
 *
 * - **Writes**: `controls` memory on mount
 * - **Clears**: `controls` memory on unmount (sets empty buttons array)
 *
 * ## UI Integration
 *
 * The UI should:
 * 1. Subscribe to `controls` memory changes
 * 2. Render buttons based on action metrics
 * 3. Emit `button.eventName` when user clicks a button
 *
 * @example
 * ```typescript
 * new ButtonBehavior({
 *   buttons: [
 *     { id: 'next', label: 'Next', variant: 'primary', visible: true, enabled: true, eventName: 'next' },
 *     { id: 'pause', label: 'Pause', variant: 'secondary', visible: true, enabled: true, eventName: 'timer:pause' }
 *   ]
 * })
 * ```
 */
export class ButtonBehavior implements IRuntimeBehavior {
    constructor(private readonly config: ControlsConfig) { }

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        // Create action metrics for each button
        const metrics = MetricContainer.from(this.config.buttons.map(button => ({
            type: MetricType.Action,
            image: button.label,
            origin: 'runtime',
            value: {
                id: button.id,
                label: button.label,
                variant: button.variant,
                visible: button.visible,
                enabled: button.enabled,
                eventName: button.eventName
            },
            sourceBlockKey: ctx.block.key.toString(),
            timestamp: ctx.clock.currentDate,
        })), ctx.block.key.toString());

        // Push action metrics to list-based memory
        if (metrics.length > 0) {
            ctx.pushMemory('controls', metrics.toArray());
        }

        return [];
    }

    onNext(_ctx: IBehaviorContext): IRuntimeAction[] {
        return [];
    }

    onUnmount(ctx: IBehaviorContext): IRuntimeAction[] {
        // Clear controls memory (signals UI to remove buttons)
        ctx.updateMemory('controls', []);

        return [];
    }

    onDispose(_ctx: IBehaviorContext): void {
        // No cleanup needed
    }

    /**
     * Update a specific button's state dynamically.
     * Call this from other behaviors to enable/disable buttons.
     */
    static updateButton(
        ctx: IBehaviorContext,
        buttonId: string,
        updates: Partial<Pick<ButtonConfig, 'visible' | 'enabled' | 'label'>>
    ): void {
        const controlsLocs = ctx.block.getMemoryByTag('controls');
        if (controlsLocs.length === 0) return;

        const loc = controlsLocs[0];
        const updatedFragments = loc.metrics.map(f => {
            const btn = f.value as ButtonConfig;
            if (btn.id === buttonId) {
                return { ...f, value: { ...btn, ...updates } };
            }
            return f;
        });

        ctx.updateMemory('controls', updatedFragments);
    }
}
