import { IRuntimeAction } from '../../contracts/IRuntimeAction';
import type { IRuntimeContext } from '../../contracts/IRuntimeContext';
import { BlockLifecycleOptions } from '../../contracts/IRuntimeBlock';
import { NextAction } from './NextAction';
import { RuntimeLogger } from '../../RuntimeLogger';

/**
 * Action that pops the current block from the runtime stack.
 * Handles the full lifecycle: unmount, pop, dispose, emit output.
 * 
 * Returns unmount actions followed by a NextAction for the parent,
 * decoupling the pop and next phases into distinct actions processed
 * by the ExecutionContext.
 */
export class PopBlockAction implements IRuntimeAction {
    readonly type = 'pop-block';

    constructor(private readonly options: BlockLifecycleOptions = {}) { }

    do(runtime: IRuntimeContext): IRuntimeAction[] {
        const current = runtime.stack.current;
        if (!current) {
            return [];
        }

        // Set createdAt time if not provided
        const createdAt = this.options.createdAt ?? runtime.clock.currentDate;
        const lifecycleOptions: BlockLifecycleOptions = { ...this.options, createdAt };

        // Update block's execution timing
        if (current.executionTiming) {
            current.executionTiming.createdAt = createdAt;
        }

        // Forced-pop: if block was NOT marked complete before pop, mark it now.
        // This distinguishes a "clean pop" (next → markComplete → pop) from a
        // "forced pop" (direct pop on an incomplete block, e.g., parent timer expiry).
        // Forced pops still run the full unmount lifecycle so behaviors can report
        // their fragments via onUnmount.
        if (!current.isComplete && typeof current.markComplete === 'function') {
            current.markComplete('forced-pop');
            RuntimeLogger.logPop(current, 'forced-pop (incomplete block popped without next)', runtime.stack.blocks.length);
        }

        // Get unmount actions from the block
        const unmountActions = current.unmount(runtime, lifecycleOptions) ?? [];

        // Pop from stack
        const popped = runtime.stack.pop();
        if (!popped) {
            return [];
        }

        // Dispose and cleanup
        popped.dispose(runtime);
        popped.context?.release?.();

        // Log the pop (skip if already logged as forced-pop above). The pop
        // already happened — depth is post-pop length + 1.
        if (popped.completionReason !== 'forced-pop') {
            RuntimeLogger.logPop(popped, popped.completionReason, runtime.stack.blocks.length + 1);
        }

        // The 'segment' OutputStatement for this pop is emitted by the stack's
        // pop-event listener (OutputEmitter.emitSegmentFromResultMemory), which
        // reads the result memory ReportOutputBehavior.onUnmount wrote. PopBlockAction
        // does not emit output itself — there is exactly one emission site per pop.

        // If a parent block exists, queue a NextAction to notify it of child completion.
        // This decouples the pop and next steps into separate actions, ensuring each
        // lifecycle phase (unmount → next → push) is a distinct action in the ExecutionContext.
        const parent = runtime.stack.current;

        // Return unmount actions first, then a NextAction for the parent (if any).
        // ExecutionContext reverse-pushes returned arrays so first element executes first:
        // unmount effects run before parent advancement.
        return parent
            ? [...unmountActions, new NextAction(lifecycleOptions, runtime.nowProvider)]
            : unmountActions;
    }
}
