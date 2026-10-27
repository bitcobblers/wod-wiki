import { IEvent } from './contracts/events/IEvent';
import { IEventHandler } from './contracts/events/IEventHandler';
import { IRuntimeAction } from './contracts/IRuntimeAction';
import { IRuntimeBlock } from './contracts/IRuntimeBlock';
import { IRuntimeClock } from './contracts/IRuntimeClock';
import type { IRuntimeContext } from './contracts/IRuntimeContext';
import { IMetric } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { OutputStatement, OutputStatementType } from '@bitcobblers/wod-wiki-core';
import type { OutputStatementOptions } from '@bitcobblers/wod-wiki-core';
import {  } from '@bitcobblers/wod-wiki-core';
import { TimeSpan } from './models/TimeSpan';
import { IMemoryLocation, MemoryLocation, MemoryTag } from './memory/MemoryLocation';
import {
    IBehaviorContext,
    BehaviorEventType,
    BehaviorEventListener,
    OutputOptions,
    SubscribeOptions,
    Unsubscribe,
} from './contracts/IBehaviorContext';

/**
 * BehaviorContext is the concrete implementation of IBehaviorContext.
 * 
 * It is created by RuntimeBlock when a block is mounted and provides
 * behaviors with a unified API for:
 * - Subscribing to events (tick, next, etc.)
 * - Emitting events (for coordination)
 * - Emitting output statements (for reporting)
 * - Reading and writing block memory
 * - Marking the block as complete
 * 
 * ## Lifecycle
 * 
 * 1. Created during block.mount()
 * 2. Passed to behavior.onMount(ctx)
 * 3. Same context passed to behavior.onNext(ctx)
 * 4. Same context passed to behavior.onUnmount(ctx)
 * 5. dispose() called during block.unmount() to clean up subscriptions
 */
export class BehaviorContext implements IBehaviorContext {
    private subscriptions: Array<{ eventType: string; unsubscribe: () => void }> = [];
    /**
     * Capabilities registered on this context (or shared from the persistent
     * per-block context if one was injected).
     *
     * Capability state is block-scoped, not call-scoped: the `inspectNext`
     * path in `RuntimeBlock` constructs a fresh `BehaviorContext` per
     * invocation so it can run the onNext chain without side effects, but
     * capabilities declared during `onMount` must still be visible to
     * peer behaviors in any subsequent call.  We therefore let an external
     * owner (the persistent `_behaviorContext` on `RuntimeBlock`) inject
     * the shared Set so all contexts for the same block observe the same
     * capabilities.
     */
    private _capabilities: Set<string>;

    constructor(
        readonly block: IRuntimeBlock,
        readonly clock: IRuntimeClock,
        readonly stackLevel: number,
        private runtime: IRuntimeContext,
        sharedCapabilities?: Set<string>
    ) {
        this._capabilities = sharedCapabilities ?? new Set<string>();
    }

    get nowProvider() {
        return this.runtime.nowProvider;
    }
    // ============================================================================
    // Event Subscription
    // ============================================================================

    subscribe(eventType: BehaviorEventType, listener: BehaviorEventListener, options?: SubscribeOptions): Unsubscribe {
        const self = this;
        const handler = {
            id: `behavior-${this.block.key.toString()}-${eventType}-${Date.now()}`,
            name: `BehaviorHandler-${this.block.label}-${eventType}`,
            handler: (event: IEvent, _runtime: IRuntimeContext): IRuntimeAction[] => {
                // For event callbacks, use the dispatching runtime's live clock
                // instead of the frozen mount-time SnapshotClock. This is critical
                // for tick handlers that need to see current time (e.g., TimerEndingBehavior).
                const callbackCtx: IBehaviorContext = Object.create(self, {
                    clock: { value: _runtime.clock, enumerable: true, configurable: true }
                });
                return listener(event, callbackCtx);
            }
        } as unknown as IEventHandler;

        // Register with event bus scoped to this block
        const unsub = this.runtime.eventBus.register(
            eventType,
            handler,
            this.block.key.toString(),
            { scope: options?.scope ?? 'active' }
        );

        this.subscriptions.push({ eventType, unsubscribe: unsub });
        return unsub;
    }

    // ============================================================================
    // Event Emission
    // ============================================================================

    emitEvent(event: IEvent): void {
        this.runtime.handle(event);
    }

    // ============================================================================
    // Output Emission
    // ============================================================================

    emitOutput(
        type: OutputStatementType,
        metrics: MetricContainer | IMetric[],
        _options?: OutputOptions
    ): void {
        const now = this.clock.currentDate;

        // Extract raw spans from the block's timer memory.
        // These spans represent continuous periods of active (unpaused) execution.
        // A "timestamp" is a degenerate span where started === ended (zero duration).
        //
        // Time semantics derived from spans:
        //   elapsed = sum of all span durations (pause-aware active time)
        //   total   = start of first span to end of last span (wall-clock bracket)
        const timerLocations = this.block.getMemoryByTag('time');
        let startTime = now.getTime();
        const endTime = now.getTime();
        let timerSpans: TimeSpan[] = [];

        if (timerLocations.length > 0) {
            const timerFragments = timerLocations[0].metrics;
            if (timerFragments.length > 0) {
                const timerValue = timerFragments[0].value as { spans?: TimeSpan[] } | undefined;
                if (timerValue?.spans && timerValue.spans.length > 0) {
                    timerSpans = [...timerValue.spans];
                    // Use the earliest span start as the output start time
                    startTime = timerSpans[0].started;
                }
            }
        }

        // If the caller provided no metrics, pull display metrics from the
        // block's metrics:display memory so the output carries the source
        // label, effort, rep, etc. metrics that the UI needs to render.
        let effectiveFragments = MetricContainer.from(metrics, this.block.key.toString());
        if (effectiveFragments.length === 0) {
            const displayLocations = this.block.getMemoryByTag('metric:display');
            if (displayLocations.length > 0) {
                effectiveFragments = displayLocations[0].metrics.clone(this.block.key.toString());
            }
        }

        // Tag metrics with source block and timestamp
        const taggedFragments = effectiveFragments.map(f => ({
            ...f,
            sourceBlockKey: f.sourceBlockKey ?? this.block.key.toString(),
            timestamp: f.timestamp ?? now
        }));

        // Create the output statement with both the wall-clock timeSpan
        // and the raw spans for pause-aware elapsed/total computation.
        const output = new OutputStatement({
            outputType: type,
            timeSpan: new TimeSpan(startTime, endTime),
            spans: timerSpans.length > 0 ? timerSpans : undefined,
            sourceBlockKey: this.block.key.toString(),
            sourceStatementId: this.block.sourceIds?.[0],
            stackLevel: this.stackLevel,
            metrics: taggedFragments,
            completionReason: _options?.completionReason,
        } as OutputStatementOptions);

        // Add to runtime's output collection and notify subscribers
        this.addOutputToRuntime(output);
    }

    /**
     * Add output to the runtime's collection and notify subscribers.
     */
    private addOutputToRuntime(output: OutputStatement): void {
        this.runtime.addOutput(output);
    }

    // ============================================================================
    // List-Based Memory API
    // ============================================================================

    pushMemory(tag: MemoryTag, metrics: MetricContainer | IMetric[]): IMemoryLocation {
        const location = new MemoryLocation(tag, metrics);
        this.block.pushMemory(location);
        return location;
    }

    getMemoryByTag(tag: MemoryTag): IMemoryLocation[] {
        return this.block.getMemoryByTag(tag);
    }

    updateMemory(tag: MemoryTag, metrics: MetricContainer | IMetric[]): void {
        const locations = this.block.getMemoryByTag(tag);
        if (locations.length > 0) {
            locations[0].update(metrics);
        }
    }

    // ============================================================================
    // Capability Registry
    // ============================================================================

    declareCapability(cap: string): void {
        this._capabilities.add(cap);
    }

    hasCapability(cap: string): boolean {
        return this._capabilities.has(cap);
    }

    /**
     * Returns the Set used to store declared capabilities.  Internal callers
     * (e.g. `RuntimeBlock.inspectNext`) pass this back to a fresh
     * `BehaviorContext` so that all contexts for the same block observe the
     * same capabilities without coupling the inspection context to a
     * specific owner.
     */
    getCapabilities(): Set<string> {
        return this._capabilities;
    }

    // ============================================================================
    // Block Control
    // ============================================================================

    markComplete(reason?: string): void {
        this.block.markComplete(reason);
    }
    // ============================================================================
    // Lifecycle
    // ============================================================================

    /**
     * Dispose of all subscriptions.
     * Called by RuntimeBlock during unmount.
     */
    dispose(): void {
        for (const { unsubscribe } of this.subscriptions) {
            try {
                unsubscribe();
            } catch (err) {
                this.runtime.options.logger?.error?.('[BehaviorContext] Unsubscribe error:', err);
            }
        }
        this.subscriptions = [];
    }
}
