import { IBlockContext } from './contracts/IBlockContext';
import { IMemoryReference } from './contracts/IMemoryReference';
import { TypedMemoryReference } from './impl/TypedMemoryReference';
import type { IRuntimeContext } from './contracts/IRuntimeContext';
import { IRuntimeMemory } from './contracts/IRuntimeMemory';
import { RuntimeMemory } from './RuntimeMemory';
import { MemoryTypeEnum } from './models/MemoryTypeEnum';
import { IAnchorValue } from './contracts/IAnchorValue';
import { MemoryAllocateEvent, MemorySetEvent, MemoryReleaseEvent } from './events/MemoryEvents';

/**
 * BlockContext implementation for runtime block memory management.
 * 
 * Responsibilities:
 * - Allocate and track memory references for a single block
 * - Provide type-safe access to allocated memory
 * - Clean up all memory on release
 * 
 * Lifecycle:
 * 1. Created by strategy with runtime and ownerId
 * 2. Strategy allocates memory via allocate()
 * 3. Memory references injected into behaviors
 * 4. Consumer calls release() after block disposal
 * 
 * @example
 * ```typescript
 * const context = new BlockContext(runtime, 'block-123');
 * const ref = context.allocate<number>('counter', 0, 'private');
 * // ... use ref in behaviors ...
 * context.release(); // Clean up
 * ```
 */
export class BlockContext implements IBlockContext {
    private _references: IMemoryReference[] = [];
    private _released = false;
    private readonly _memory: IRuntimeMemory;

    constructor(
        private readonly runtime: IRuntimeContext,
        public readonly ownerId: string,
        public readonly exerciseId: string = '',
        initialReferences: IMemoryReference[] = [],
        memory?: IRuntimeMemory
    ) {
        this._references = [...initialReferences];
        this._memory = memory ?? new RuntimeMemory();
    }

    get references(): ReadonlyArray<IMemoryReference> {
        return [...this._references];
    }

    allocate<T>(
        type: MemoryTypeEnum | string,
        initialValue?: T,
        visibility: 'public' | 'private' | 'inherited' = 'private'
    ): TypedMemoryReference<T> {
        if (this._released) {
            throw new Error(
                `Cannot allocate on released context (ownerId: ${this.ownerId})`
            );
        }

        // Convert enum to string for storage (enums are strings in runtime)
        const typeStr = type as string;

        const ref = this._memory.allocate<T>(
            typeStr,
            this.ownerId,
            initialValue,
            visibility
        );

        this._references.push(ref);

        // Dispatch memory:allocate event
        this.runtime.eventBus.dispatch(
            new MemoryAllocateEvent(ref, initialValue, this.runtime.nowProvider),
            this.runtime
        );

        return ref;
    }

    get<T>(type: MemoryTypeEnum | string): TypedMemoryReference<T> | undefined {
        const typeStr = type as string;
        const ref = this._references.find(r => r.type === typeStr);
        return ref as TypedMemoryReference<T> | undefined;
    }

    getAll<T>(type: MemoryTypeEnum | string): TypedMemoryReference<T>[] {
        const typeStr = type as string;
        return this._references.filter(
            r => r.type === typeStr
        ) as TypedMemoryReference<T>[];
    }

    set<T>(reference: TypedMemoryReference<T>, value: T): void {
        if (this._released) {
            throw new Error(
                `Cannot set on released context (ownerId: ${this.ownerId})`
            );
        }

        const oldValue = reference.get();
        this._memory.set(reference, value);

        // Dispatch memory:set event
        this.runtime.eventBus.dispatch(
            new MemorySetEvent(reference, value, oldValue, this.runtime.nowProvider),
            this.runtime
        );
    }

    release(): void {
        if (this._released) {
            return; // Idempotent
        }

        for (const ref of this._references) {
            const lastValue = ref.value();
            this._memory.release(ref);

            // Dispatch memory:release event
            this.runtime.eventBus.dispatch(
                new MemoryReleaseEvent(ref, lastValue, this.runtime.nowProvider),
            this.runtime
            );
        }

        this._references = [];
        this._released = true;
    }

    isReleased(): boolean {
        return this._released;
    }

    getOrCreateAnchor(anchorId: string): TypedMemoryReference<IAnchorValue> {
        if (this._released) {
            throw new Error(
                `Cannot access anchor on released context (ownerId: ${this.ownerId})`
            );
        }

        // Search for existing anchor with this ID in the stack
        let existingRef: TypedMemoryReference<IAnchorValue> | undefined;

        for (const block of this.runtime.stack.blocks) {
            const matching = block.context.references.find(
                r => r.id === anchorId && r.type === MemoryTypeEnum.ANCHOR
            );
            if (matching) {
                existingRef = matching as TypedMemoryReference<IAnchorValue>;
                break;
            }
        }

        if (existingRef) {
            // Add to our references if not already tracked
            if (!this._references.find(r => r.id === existingRef.id)) {
                this._references.push(existingRef);
            }

            return existingRef;
        }

        // Create new anchor in this block's memory
        // We use 'public' visibility so it can be shared via the stack
        const anchorRef = this._memory.allocate<IAnchorValue>(
            MemoryTypeEnum.ANCHOR,
            this.ownerId,
            undefined, // No initial value
            'public'
        );

        // Ensure the ID matches the requested anchorId for consistent lookup
        anchorRef.id = anchorId;

        this._references.push(anchorRef);
        return anchorRef;
    }
}
