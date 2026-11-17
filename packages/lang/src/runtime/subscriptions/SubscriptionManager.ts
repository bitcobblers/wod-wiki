import { IRuntimeSubscription } from '../contracts/IRuntimeSubscription';
import { IScriptRuntime } from '../contracts/IScriptRuntime';
import { StackSnapshot } from '../contracts/IRuntimeStack';
import { IOutputStatement } from '@bitcobblers/wod-wiki-core';
import { Unsubscribe } from '../contracts/IRuntimeStack';

/**
 * SubscriptionManager — fans out runtime stack and output events to
 * multiple IRuntimeSubscription instances.
 *
 * Lifecycle:
 * 1. Created when a runtime is initialized (by RuntimeLifecycleProvider)
 * 2. Always holds a LocalRuntimeSubscription for the browser UI
 * 3. ChromecastRuntimeSubscription added/removed via cast session lifecycle
 * 4. Disposed when the runtime is disposed
 *
 * The manager subscribes once to the runtime's stack and output APIs,
 * then iterates over all registered subscriptions for each event.
 */
export class SubscriptionManager {
    private readonly subscriptions = new Map<string, IRuntimeSubscription>();
    private stackUnsub: Unsubscribe | null = null;
    private outputUnsub: Unsubscribe | null = null;
    private disposed = false;

    constructor(private readonly runtime: IScriptRuntime) {
        // Subscribe once to the runtime and fan out to all subscriptions
        this.stackUnsub = this.runtime.subscribeToStack((snapshot: StackSnapshot) => {
            for (const sub of this.subscriptions.values()) {
                try {
                    sub.onStackSnapshot(snapshot);
                } catch (err) {
                    console.error(`[SubscriptionManager] Error in subscription '${sub.id}' onStackSnapshot:`, err);
                }
            }
        });

        this.outputUnsub = this.runtime.subscribeToOutput((output: IOutputStatement) => {
            for (const sub of this.subscriptions.values()) {
                try {
                    sub.onOutput(output);
                } catch (err) {
                    console.error(`[SubscriptionManager] Error in subscription '${sub.id}' onOutput:`, err);
                }
            }
        });

    }

    /**
     * Register a subscription. If a subscription with the same ID already exists,
     * the old one is disposed and replaced.
     * 
     * New subscriptions immediately receive the current stack state and any
     * existing output statements to catch them up.
     */
    add(subscription: IRuntimeSubscription): void {
        if (this.disposed) {
            console.warn('[SubscriptionManager] Cannot add subscription after dispose');
            return;
        }

        const existing = this.subscriptions.get(subscription.id);
        if (existing) {
            existing.dispose();
        }
        this.subscriptions.set(subscription.id, subscription);

        // Catch up the new subscription with the current runtime state
        try {
            subscription.onStackSnapshot({
                type: 'initial',
                blocks: [...this.runtime.stack.blocks],
                depth: this.runtime.stack.count,
                clockTime: this.runtime.clock.currentDate,
            });

            const currentOutputs = this.runtime.getOutputStatements();
            for (const output of currentOutputs) {
                subscription.onOutput(output);
            }

        } catch (err) {
            console.error(`[SubscriptionManager] Error catching up subscription '${subscription.id}':`, err);
        }
    }

    /**
     * Remove and dispose a subscription by ID.
     * Returns true if the subscription was found and removed.
     */
    remove(id: string): boolean {
        const sub = this.subscriptions.get(id);
        if (!sub) return false;
        sub.dispose();
        this.subscriptions.delete(id);
        return true;
    }

    /**
     * Check if a subscription with the given ID is registered.
     */
    has(id: string): boolean {
        return this.subscriptions.has(id);
    }

    /**
     * Get the number of active subscriptions.
     */
    get count(): number {
        return this.subscriptions.size;
    }

    /**
     * Dispose all subscriptions and unsubscribe from the runtime.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        // Unsubscribe from the runtime
        this.stackUnsub?.();
        this.stackUnsub = null;
        this.outputUnsub?.();
        this.outputUnsub = null;

        // Dispose all subscriptions
        for (const sub of this.subscriptions.values()) {
            try {
                sub.dispose();
            } catch (err) {
                console.error(`[SubscriptionManager] Error disposing subscription '${sub.id}':`, err);
            }
        }
        this.subscriptions.clear();
    }
}
