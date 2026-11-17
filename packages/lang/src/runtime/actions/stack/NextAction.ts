import { IRuntimeAction } from '../../contracts/IRuntimeAction';
import type { IRuntimeContext } from '../../contracts/IRuntimeContext';
import { BlockLifecycleOptions } from '../../contracts/IRuntimeBlock';
import { SnapshotClock } from '../../RuntimeClock';
import { INowProvider, wallClockNow } from '../../INowProvider';
export class NextAction implements IRuntimeAction {
  readonly type = 'next';

  /**
   * @param options Optional lifecycle options to pass to the block's next() method.
   *   When provided (e.g., from PopBlockAction carrying createdAt), these options
   *   are merged with a snapshot clock. When omitted (e.g., user-triggered next),
   *   a fresh snapshot clock is created.
   * @param now Clock provider used when minting a fresh snapshot clock.
   */
  constructor(
    private readonly options?: BlockLifecycleOptions,
    private readonly now: INowProvider = wallClockNow,
  ) {}

  do(runtime: IRuntimeContext): IRuntimeAction[] {
    // Validate runtime state
    if (!this.validateRuntimeState(runtime)) {
      return [];
    }

    // Get current block
    const currentBlock = runtime.stack.current;
    if (!currentBlock) {
      return [];
    }

    try {
      // Build lifecycle options: merge any provided options with a snapshot clock.
      // The snapshot clock ensures any child blocks pushed during next() start at the same time.
      const snapshotClock = runtime.clock 
        ? { clock: SnapshotClock.now(runtime.clock) } 
        : undefined;
      const lifecycleOptions = { ...snapshotClock, ...this.options };

      // Execute block's next logic with the lifecycle options
      // System output for next lifecycle is now emitted by RuntimeBlock.next() itself
      return currentBlock.next(runtime, lifecycleOptions);

    } catch (error) {
      // Add error to runtime errors array if available
      if (runtime.errors && Array.isArray(runtime.errors)) {
        runtime.errors.push({
          error: error as Error,
          source: 'NextAction',
          timestamp: this.now.now(),
          blockKey: currentBlock.key.toString()
        });
      }
      return [];
    }
  }

  private validateRuntimeState(runtime: IRuntimeContext): boolean {
    // Check for undefined/null stack
    if (!runtime.stack) {
      return false;
    }

    // Note: We intentionally do NOT check runtime.errors here.
    // The errors array is append-only and never cleared, so a single
    // transient error would permanently halt all block advancement.
    // Errors are logged and tracked separately; NextAction should
    // continue to function so the user can still advance.

    return true;
  }
}
