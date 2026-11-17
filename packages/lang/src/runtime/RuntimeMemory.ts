import { IRuntimeMemory, MemorySearchCriteria } from './contracts/IRuntimeMemory';
import { IMemoryReference } from './contracts/IMemoryReference';
import { TypedMemoryReference } from './impl/TypedMemoryReference';

export type RuntimeMemoryLocation = {
    ref: IMemoryReference;
    data: unknown;
}

/**
 * RuntimeMemory is a pure storage system for runtime state.
 * 
 * Note: This class does not dispatch events. Memory events (allocate, set, release)
 * are dispatched by BlockContext, which wraps memory operations and dispatches
 * events to the EventBus. This keeps RuntimeMemory decoupled from the event system.
 */
export class RuntimeMemory implements IRuntimeMemory {
    // Linear storage for memory locations
    private readonly _references: RuntimeMemoryLocation[] = [];

    // Allocates a new memory location and returns a reference to it.
    allocate<T>(type: string, ownerId: string, initialValue?: T, visibility: 'public' | 'private' | 'inherited' = 'private'): TypedMemoryReference<T> {
        const ref = new TypedMemoryReference<T>(this, ownerId, type, visibility);
        this._references.push({ ref, data: initialValue });

        return ref;
    }


    // Gets the value for a given reference, or undefined if not found.
    get<T>(reference: TypedMemoryReference<T>): T | undefined {
        const loc = this._references.find(l => l.ref.id === reference.id);
        return (loc?.data as T) ?? undefined;
    }

    // Sets the value for a given reference. Throws if the reference is invalid.
    set<T>(reference: TypedMemoryReference<T>, value: T): void {
        const loc = this._references.find(l => l.ref.id === reference.id);
        if (!loc) {
            throw new Error(`Invalid memory reference: ${reference.id}`);
        }
        const oldValue = loc.data as T | undefined;
        loc.data = value;

        // Notify subscribers if value changed
        if (reference.hasSubscribers()) {
            reference.notifySubscribers(value, oldValue);
        }
    }

    // Searches for references matching any non-null fields in the criteria object.
    search(criteria: MemorySearchCriteria): IMemoryReference[] {

        return this._references
            .map(l => l.ref)
            .filter(ref => {
                if (criteria.id !== null && criteria.id !== undefined && criteria.id !== ref.id) return false;
                if (criteria.ownerId !== null && criteria.ownerId !== undefined && criteria.ownerId !== ref.ownerId) return false;
                if (criteria.type !== null && criteria.type !== undefined && criteria.type !== ref.type) return false;
                if (criteria.visibility !== null && criteria.visibility !== undefined && criteria.visibility !== ref.visibility) return false;
                return true;
            });
    }

    // Manually releases a memory reference.
    release(reference: IMemoryReference): void {
        const idx = this._references.findIndex(l => l.ref.id === reference.id);
        if (idx >= 0) {
            const loc = this._references[idx];
            const lastValue = loc.data;

            // If this is a TypedMemoryReference with subscribers, notify them before releasing
            const ref = loc.ref;
            if (ref instanceof TypedMemoryReference && ref.hasSubscribers()) {
                // Notify subscribers that the reference is being released
                ref.notifySubscribers(undefined, lastValue);
            }

            this._references.splice(idx, 1);
        }
    }
}

