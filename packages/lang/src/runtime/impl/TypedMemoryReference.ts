/**
 * Concrete implementation of {@link IMemoryReference} for typed memory cells.
 *
 * This class lives in the `impl/` layer (not `contracts/`) so that
 * `contracts/IMemoryReference.ts` does not need to import
 * `contracts/IRuntimeMemory.ts` — breaking the cycle:
 *
 *   IMemoryReference ↔ IRuntimeMemory
 */
import { v7 as uuidv7 } from 'uuid';
import type {
    IMemoryReference,
    IMemorySubscription,
    SubscriptionOptions,
} from '../contracts/IMemoryReference';
import type { IRuntimeMemory } from '../contracts/IRuntimeMemory';
import type { RuntimeStackLogger } from '../contracts/IRuntimeOptions';

export class TypedMemoryReference<T> implements IMemoryReference {
    public id: string = uuidv7();
    private readonly _subscriptions: IMemorySubscription<T>[] = [];

    constructor(
        private readonly _memory: IRuntimeMemory,
        public readonly ownerId: string,
        public readonly type: string,
        public visibility: 'public' | 'private' | 'inherited' = 'private',
        private readonly _logger?: RuntimeStackLogger,
    ) {}

    /**
     * Get the current value in an untyped manner.
     * Implements IMemoryReference.value() for debugging and inspection.
     */
    value(): unknown {
        return this.get();
    }

    /**
     * Readonly access to subscriptions list.
     * Implements IMemoryReference.subscriptions for debugging and inspection.
     */
    get subscriptions(): ReadonlyArray<IMemorySubscription<unknown>> {
        return this._subscriptions as ReadonlyArray<IMemorySubscription<unknown>>;
    }

    get(): T | undefined {
        return this._memory.get<T>(this);
    }

    set(value: T): void {
        this._memory.set<T>(this, value);
    }

    /**
     * Subscribe to changes in this memory reference.
     * @param callback Function to call when the value changes
     * @param options Subscription options (immediate, throttle)
     * @returns Unsubscribe function
     */
    subscribe(
        callback: (newValue: T | undefined, oldValue: T | undefined) => void,
        options?: SubscriptionOptions,
    ): () => void {
        const subscriptionId = uuidv7();
        const subscription: IMemorySubscription<T> = {
            id: subscriptionId,
            callback,
            memoryId: this.id,
            createdAt: new Date(),
        };

        this._subscriptions.push(subscription);

        // Call immediately with current value if requested
        if (options?.immediate) {
            const currentValue = this.get();
            callback(currentValue, undefined);
        }

        // Return unsubscribe function
        return () => this.unsubscribe(subscriptionId);
    }

    /**
     * Unsubscribe from changes by subscription ID.
     * @param subscriptionId The ID of the subscription to remove
     */
    unsubscribe(subscriptionId: string): void {
        const index = this._subscriptions.findIndex(s => s.id === subscriptionId);
        if (index >= 0) {
            // Simply remove from array - no need for active flag
            this._subscriptions.splice(index, 1);
        }
    }

    /**
     * Check if this reference has any active subscribers.
     * @returns true if there are active subscribers
     */
    hasSubscribers(): boolean {
        return this._subscriptions.length > 0;
    }

    /**
     * Notify all subscribers of a value change.
     * This is called internally by RuntimeMemory.
     * @internal
     */
    notifySubscribers(newValue: T | undefined, oldValue: T | undefined): void {
        // All subscriptions in the array are active (removed ones are spliced out)
        for (const subscription of this._subscriptions) {
            try {
                subscription.callback(newValue, oldValue);
            } catch (error) {
                this._logger?.error?.('Error in memory subscription callback:', error);
            }
        }
    }
}
