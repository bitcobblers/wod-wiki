import type { IRuntimeAction } from '../../contracts/IRuntimeAction';
import type { IRuntimeBlock } from '../../contracts/IRuntimeBlock';
import type { IRuntimeContext } from '../../contracts/IRuntimeContext';
import type { BlockLifecycleOptions } from '../../contracts';
import { RuntimeLogger } from "../../RuntimeLogger";

/**
 * Action that pushes a compiled block onto the runtime stack.
 * Used by behaviors to add child blocks for execution.
 */
export class PushBlockAction implements IRuntimeAction {
    private _type = 'push-block';

    constructor(public readonly block: IRuntimeBlock, private readonly options: BlockLifecycleOptions = {}) { }

    get type(): string {
        return this._type;
    }

    set type(_value: string) {
        throw new Error('Cannot modify readonly property type');
    }

    do(runtime: IRuntimeContext): IRuntimeAction[] {
        if (!runtime.stack) {
            return [];
        }

        try {
            // Block push timing rules:
            // If startTime is explicitly provided in options, use it
            // Otherwise: if clock running → create start time automatically
            // Note: Use options.clock if provided (e.g., SnapshotClock) to maintain timing consistency

            let startTime: Date | undefined = this.options.startTime;
            const clock = this.options.clock ?? runtime.clock;

            if (!startTime && clock?.isRunning) {
                // Clock running → create startTime automatically
                // Uses frozen clock if provided for timing consistency
                startTime = clock.currentDate;
            }

            const lifecycle: BlockLifecycleOptions = startTime
                ? { ...this.options, startTime }
                : { ...this.options };

            const target = this.block as IRuntimeBlock & { executionTiming?: BlockLifecycleOptions };
            if (startTime) {
                target.executionTiming = { ...(target.executionTiming ?? {}), startTime };
            }

            // Push the block onto the stack
            runtime.stack.push(this.block);

            // Mount the block with lifecycle options - returns actions to be executed
            const mountActions = this.block.mount(runtime, lifecycle);

            // Log the push with behaviors (depth = landed stack depth, 1-based)
            const parentKey = runtime.stack.blocks.length > 1
                ? runtime.stack.blocks[1]?.key.toString()
                : undefined;
            RuntimeLogger.logPush(this.block, parentKey, runtime.stack.blocks.length);

            return mountActions;

        } catch (error) {
            // Check if runtime has optional setError method
            const runtimeWithSetError = runtime as IRuntimeContext & { setError?: (error: unknown) => void };
            if (typeof runtimeWithSetError.setError === 'function') {
                runtimeWithSetError.setError(error);
            }
            return [];
        }
    }
}
