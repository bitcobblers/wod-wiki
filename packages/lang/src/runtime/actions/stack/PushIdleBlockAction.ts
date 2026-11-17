import { IRuntimeAction } from '../../contracts/IRuntimeAction';
import type { IRuntimeContext } from '../../contracts/IRuntimeContext';
import { BlockLifecycleOptions } from '../../contracts/IRuntimeBlock';
import { IdleBlockStrategy, IdleBlockConfig } from '../../compiler/strategies/IdleBlockStrategy';
import { PushBlockAction } from './PushBlockAction';

/**
 * PushIdleBlockAction - Creates and pushes an idle block onto the stack.
 * 
 * Now uses IdleBlockStrategy to compose the idle block from single-responsibility
 * behaviors instead of the monolithic IdleBehavior.
 */
export class PushIdleBlockAction implements IRuntimeAction {
    private readonly _type = 'push-idle-block';
    // Direct-build: IdleBlockStrategy is invoked by class here, not via JitCompiler.compile()
    private readonly strategy = new IdleBlockStrategy();

    constructor(
        private readonly id: string,
        private readonly label: string,
        private readonly config: {
            popOnNext?: boolean;
            popOnEvents?: string[];
            buttonLabel?: string;
            buttonAction?: string;
        },
        private readonly options?: BlockLifecycleOptions
    ) { }

    get type(): string {
        return this._type;
    }

    /* istanbul ignore next */
    set type(_value: string) {
        throw new Error('Cannot modify readonly property type');
    }

    do(runtime: IRuntimeContext): IRuntimeAction[] {
        // Convert old IdleBehaviorConfig to new IdleBlockConfig
        const idleConfig: IdleBlockConfig = {
            id: this.id,
            label: this.label,
            popOnNext: this.config.popOnNext,
            popOnEvents: this.config.popOnEvents,
            trackTiming: true,
            displayMode: 'clock'
        };

        // Create button from config if provided
        if (this.config.buttonLabel && this.config.buttonAction) {
            const labelLower = this.config.buttonLabel.toLowerCase();
            const actionLower = this.config.buttonAction.toLowerCase();

            // Derive button properties from label/action
            let buttonId = 'btn-next';
            let icon: 'play' | 'analytics' | 'next' = 'next';
            let variant: 'default' | 'secondary' = 'secondary';

            if (labelLower.includes('start') || actionLower.includes('start')) {
                buttonId = 'btn-start';
                icon = 'play';
                variant = 'default';
            } else if (labelLower.includes('analytics') || actionLower.includes('analytics')) {
                buttonId = 'btn-analytics';
                icon = 'analytics';
                variant = 'default';
            }

            idleConfig.button = {
                id: buttonId,
                label: this.config.buttonLabel,
                icon,
                action: this.config.buttonAction,
                variant,
                size: 'lg'
            };
        }

        // Use strategy to build the idle block
        const block = this.strategy.build(runtime, idleConfig);

        // Delegate to PushBlockAction to handle the actual push and mount
        return [new PushBlockAction(block, this.options)];
    }
}
