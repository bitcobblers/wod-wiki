import { IMetric } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';

/**
 * Tags for memory locations. A block can have multiple locations with the same tag.
 * Tags replace the previous MemoryType keys but are no longer unique per block.
 *
 * Fragment tags follow the `metrics:*` namespace convention and are classified
 * into three visibility tiers:
 *
 * | Tier      | Tags                                     | Purpose                          |
 * |-----------|------------------------------------------|----------------------------------|
 * | display   | `metrics:display`                       | Shown on UI cards                |
 * | result    | `metric:result`                        | Block output collected on pop    |
 * | promote   | `metric:promote`, `metric:rep-target` | Inherited by child blocks       |
 * | private   | `metric:tracked`, `metric:label`      | Internal behavior state          |
 *
 * @see MetricVisibility for classification helpers.
 */
export type MemoryTag =
    | 'time'
    | 'round'
    | 'children:status'
    | 'completion'
    | 'display'
    | 'controls'
    |   'metrics'
    // metric:display — public metric rendered on the UI card
    | 'metric:display'
    // metric:promote — metric promoted/inherited to child blocks
    | 'metric:promote'
    | 'metric:rep-target'
    // metric:result — block output metric collected on pop/completion
    | 'metric:result'
    // metric:private — internal behavior state (not shown in normal UI)
    | 'metric:tracked'
    | 'metric:label'
    // metric:hint — compiler hints (from dialects or effort markdown) consumed
    // by strategies via the hints contract (see core/metrics/hints.ts).
    | 'metric:hint'
    // metric:next — preview metric for the next child to be executed
    | 'metric:next';

/**
 * A single memory location in a block's memory list.
 *
 * Memory locations are the fundamental unit of state storage in the runtime.
 * Multiple locations with the same tag can coexist, enabling:
 * - Multiple timers per block
 * - Multiple display rows per block (metrics:display)
 * - Multiple round counters
 *
 * All memory values are MetricContainer instances — metrics are the universal currency.
 */
export interface IMemoryLocation {
    /** Discriminator tag — multiple locations can share the same tag */
    readonly tag: MemoryTag;

    /** The metrics data stored at this location */
    readonly metrics: MetricContainer;

    /** Subscribe to changes at this location */
    subscribe(listener: (newValue: MetricContainer, oldValue: MetricContainer) => void): () => void;

    /** Update the metrics at this location */
    update(metrics: MetricContainer | IMetric[]): void;

    /** Dispose of this location and notify subscribers */
    dispose(): void;
}

/**
 * Concrete implementation of a memory location.
 *
 * Provides observable state storage with subscription management.
 * When disposed, sends empty array to all subscribers for cleanup.
 */
export class MemoryLocation implements IMemoryLocation {
    private readonly _listeners = new Set<(nv: MetricContainer, ov: MetricContainer) => void>();
    private _metrics: MetricContainer;
    private _isDisposed = false;

    constructor(
        public readonly tag: MemoryTag,
        initialFragments: MetricContainer | IMetric[] = MetricContainer.empty()
    ) {
        this._metrics = MetricContainer.from(initialFragments, tag);
    }

    get metrics(): MetricContainer {
        return this._metrics;
    }

    update(metrics: MetricContainer | IMetric[]): void {
        if (this._isDisposed) {
            console.warn(`Attempted to update disposed MemoryLocation with tag '${this.tag}'`);
            return;
        }

        const old = this._metrics;
        this._metrics = MetricContainer.from(metrics, this.tag);

        // Notify all listeners
        for (const listener of this._listeners) {
            listener(this._metrics, old);
        }
    }

    subscribe(listener: (nv: MetricContainer, ov: MetricContainer) => void): () => void {
        if (this._isDisposed) {
            console.warn(`Attempted to subscribe to disposed MemoryLocation with tag '${this.tag}'`);
            return () => {}; // No-op unsubscribe
        }

        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    dispose(): void {
        if (this._isDisposed) {
            return; // Multiple dispose calls are safe
        }

        this._isDisposed = true;
        const old = this._metrics;
        this._metrics = MetricContainer.empty(this.tag);

        // Notify all listeners about disposal
        for (const listener of this._listeners) {
            listener(this._metrics, old);
        }

        this._listeners.clear();
    }
}
