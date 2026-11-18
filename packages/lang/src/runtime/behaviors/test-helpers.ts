/**
 * Integration Test Helpers
 * 
 * Provides utilities for testing multi-behavior compositions
 * in realistic runtime scenarios.
 */

import { expect } from 'vitest';
import { IRuntimeBlock, IRuntimeBehavior } from '../contracts';
import { IBehaviorContext } from '../contracts/IBehaviorContext';
import { MemoryTypeMap, TimerState, MemoryType, RoundState } from '../memory/MemoryTypes';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { IMemoryLocation, MemoryLocation, MemoryTag } from '../memory/MemoryLocation';
import { TimeSpan } from '../models/TimeSpan';
import { MetricVisibility, getMetricVisibility } from '../memory/MetricVisibility';


/**
 * Mock clock for deterministic time control in tests.
 */
export class MockClock {
    private _now: number;

    constructor(startTime: number = 0) {
        this._now = startTime;
    }

    get currentDate(): Date {
        return new Date(this._now);
    }

    now(): Date {
        return new Date(this._now);
    }

    nowMs(): number {
        return this._now;
    }

    get timestamp(): number {
        return this._now;
    }

    advance(ms: number): void {
        this._now += ms;
    }

    set(time: number): void {
        this._now = time;
    }
}

/**
 * Mock runtime for integration testing.
 */
export interface MockRuntime {
    clock: MockClock;
    events: Array<{ name: string; data: unknown; timestamp: number }>;
    outputs: Array<{ type: string; metrics: unknown[]; metadata: unknown }>;
    completionReason: string | undefined;
    subscriptions: Map<string, Array<(event: unknown, ctx: IBehaviorContext) => unknown[]>>;
}

/**
 * Creates a mock runtime for testing.
 */
export function createMockRuntime(startTime: number = 0): MockRuntime {
    return {
        clock: new MockClock(startTime),
        events: [],
        outputs: [],
        completionReason: undefined,
        subscriptions: new Map()
    };
}

/**
 * Mock block for integration testing.
 */
export interface MockBlock {
    key: { toString: () => string };
    blockType: string;
    /** Computed label derived from metrics:label memory. */
    readonly label: string;
    metrics: unknown[][];
    memory: Map<MemoryType, unknown>;
    /** List-based memory storage for new API */
    _memoryList: IMemoryLocation[];
    /** Push a memory location (list-based API) */
    pushMemory(location: IMemoryLocation): void;
    /** Get memory locations by tag (list-based API) */
    getMemoryByTag(tag: MemoryTag): IMemoryLocation[];
    /** Get all memory locations */
    getAllMemory(): IMemoryLocation[];
    /** Get metrics memory by visibility tier */
    getMetricMemoryByVisibility(visibility: MetricVisibility): IMemoryLocation[];
    /** Backward-compat shim */
    getMemory<T extends MemoryType>(type: T): LegacyMemoryHandle | undefined;
    /** Backward-compat shim */
    hasMemory(type: MemoryType): boolean;
    /** Backward-compat shim */
    setMemoryValue<T extends MemoryType>(type: T, value: unknown): void;
}

/** Legacy map-based memory handle returned by the mock `getMemory` shim. */
interface LegacyMemoryHandle<T = unknown> {
  value: T | undefined;
  subscribe(listener: (next: T | undefined, prev: T | undefined) => void): () => void;
}

/**
 * Creates a mock block.
 */
export function createMockBlock(config: Partial<MockBlock> = {}): MockBlock {
    const memoryList: IMemoryLocation[] = [];
    const memoryMap = config.memory ?? new Map();
    const block: MockBlock = {
        key: { toString: () => config.key?.toString() ?? 'test-block' },
        blockType: config.blockType ?? 'Test',
        get label(): string {
            for (const loc of memoryList) {
                for (const frag of loc.metrics) {
                    if (frag.type === MetricType.Label) {
                        return frag.image || (frag.value != null ? String(frag.value) : '') || block.blockType || 'Block';
                    }
                }
            }
            return block.blockType || 'Block';
        },
        metrics: config.metrics ?? [],
        memory: memoryMap,
        _memoryList: memoryList,
        pushMemory(location: IMemoryLocation): void {
            memoryList.push(location);
        },
        getMemoryByTag(tag: MemoryTag): IMemoryLocation[] {
            return memoryList.filter(loc => loc.tag === tag);
        },
        getAllMemory(): IMemoryLocation[] {
            return [...memoryList];
        },
        getMetricMemoryByVisibility(visibility: MetricVisibility): IMemoryLocation[] {
            return memoryList.filter(loc => getMetricVisibility(loc.tag) === visibility);
        },
        getMemory<T extends MemoryType>(type: T): LegacyMemoryHandle | undefined {
            const tag = type as string as MemoryTag;
            const locations = memoryList.filter(loc => loc.tag === tag);
            if (locations.length > 0) {
                const loc = locations[0];
                return {
                    get value() {
                        if (loc.metrics.length === 0) return undefined;
                        return loc.metrics[0]?.value;
                    },
                    subscribe(listener: (nv: unknown, ov: unknown) => void): () => void {
                        return loc.subscribe((nf, of_) => {
                            listener(nf[0]?.value, of_[0]?.value);
                        });
                    }
                };
            }
            // Fall back to legacy map
            const val = memoryMap.get(type);
            if (val !== undefined) {
                return { value: val, subscribe: () => () => {} };
            }
            return undefined;
        },
        hasMemory(type: MemoryType): boolean {
            const tag = type as string as MemoryTag;
            return memoryList.some(loc => loc.tag === tag) || memoryMap.has(type);
        },
        setMemoryValue<T extends MemoryType>(type: T, value: unknown): void {
            const tag = type as string as MemoryTag;
            const locations = memoryList.filter(loc => loc.tag === tag);
            if (locations.length > 0) {
                const loc = locations[0];
                if (loc.metrics.length > 0) {
                    loc.update(loc.metrics.map((f, i) => i === 0 ? { ...f, value } : f));
                } else {
                    loc.update([{ type: 0, image: '', origin: 'runtime', value } as unknown as IMetric]);
                }
            } else {
                memoryMap.set(type, value);
            }
        },
    };

    // Store label as a Label metrics in memory list
    const labelText = config.label ?? config.blockType ?? 'Test Block';
    if (labelText) {
        memoryList.push(new MemoryLocation('metric:label', [{
            type: MetricType.Label,
            image: labelText,
            origin: 'parser',
            value: labelText
        } as IMetric]));
    }

    return block;
}

/**
 * Creates a behavior context for integration testing.
 */
export function createIntegrationContext(
    runtime: MockRuntime,
    block: MockBlock
): IBehaviorContext {
    const declared: Set<string> = new Set();
    return {
        block: block as unknown as IRuntimeBlock,
        clock: runtime.clock,
        stackLevel: 0,

        subscribe(eventType: string, handler: (event: unknown, ctx: IBehaviorContext) => unknown[]) {
            if (!runtime.subscriptions.has(eventType)) {
                runtime.subscriptions.set(eventType, []);
            }
            runtime.subscriptions.get(eventType)!.push(handler);
        },

        emitEvent(event: { name: string; timestamp: Date; data: unknown }) {
            runtime.events.push({
                name: event.name,
                data: event.data,
                timestamp: event.timestamp.getTime()
            });
        },

        emitOutput(type: string, _metrics: unknown[], metadata: unknown) {
            runtime.outputs.push({ type, metrics: _metrics, metadata });
        },

        declareCapability(cap: string) {
            declared.add(cap);
        },

        hasCapability(cap: string) {
            return declared.has(cap);
        },

        markComplete(reason: string) {
            runtime.completionReason = reason;
        },

        getMemoryByTag(tag: MemoryTag): IMemoryLocation[] {
            return block.getMemoryByTag(tag);
        },

        updateMemory(tag: string, metrics: IMetric[]): void {
            const locations = block.getMemoryByTag(tag as MemoryTag);
            if (locations.length > 0) {
                locations[0].update(metrics);
            }
        }
    } as unknown as IBehaviorContext;
}

/**
 * Simulates tick events for timer testing.
 */
export function simulateTicks(
    runtime: MockRuntime,
    ctx: IBehaviorContext,
    count: number,
    intervalMs: number = 1000
): void {
    for (let i = 0; i < count; i++) {
        runtime.clock.advance(intervalMs);
        dispatchEvent(runtime, ctx, 'tick', { timestamp: runtime.clock.timestamp });
    }
}

/**
 * Dispatches an event to all subscribed handlers.
 */
export function dispatchEvent(
    runtime: MockRuntime,
    ctx: IBehaviorContext,
    eventType: string,
    eventData: unknown = {}
): void {
    const handlers = runtime.subscriptions.get(eventType) || [];
    // Create proper event object with name field as behaviors expect
    const event = {
        name: eventType,
        timestamp: runtime.clock.currentDate,
        data: eventData
    };
    for (const handler of handlers) {
        handler(event, ctx);
    }
}

/**
 * Mounts all behaviors and returns the context.
 */
export function mountBehaviors(
    behaviors: IRuntimeBehavior[],
    runtime: MockRuntime,
    block: MockBlock
): IBehaviorContext {
    const ctx = createIntegrationContext(runtime, block);
    for (const behavior of behaviors) {
        behavior.onMount(ctx);
    }
    return ctx;
}

/**
 * Calls onNext on all behaviors.
 */
export function advanceBehaviors(
    behaviors: IRuntimeBehavior[],
    ctx: IBehaviorContext
): void {
    for (const behavior of behaviors) {
        behavior.onNext(ctx);
    }
}

/**
 * Unmounts all behaviors.
 */
export function unmountBehaviors(
    behaviors: IRuntimeBehavior[],
    ctx: IBehaviorContext
): void {
    for (const behavior of behaviors) {
        behavior.onUnmount(ctx);
    }
}

/**
 * Asserts memory state matches expected values.
 */
export function expectMemoryState<T extends MemoryType>(
    block: MockBlock,
    type: T,
    expected: Partial<MemoryTypeMap[T]>
): void {
    const actual = block.memory.get(type) as MemoryTypeMap[T] | undefined;
    expect(actual).toBeDefined();
    expect(actual).toMatchObject(expected);
}

/**
 * Calculates elapsed time from timer state.
 */
export function calculateElapsed(timer: TimerState, now: number): number {
    let total = 0;
    for (const span of timer.spans) {
        const end = span.ended ?? now;
        total += end - span.started;
    }
    return total;
}

/**
 * Creates initial timer state for testing.
 */
export function createTimerState(config: {
    direction?: 'up' | 'down';
    durationMs?: number;
    startTime?: number;
    label?: string;
}): TimerState {
    return {
        direction: config.direction ?? 'up',
        durationMs: config.durationMs,
        spans: [new TimeSpan(config.startTime ?? 0)],
        label: config.label ?? 'Test Timer',
        role: 'primary'
    };
}

/**
 * Creates initial round state for testing.
 */
export function createRoundState(config: {
    current?: number;
    total?: number;
}): RoundState {
    return {
        current: config.current ?? 1,
        total: config.total
    };
}

/**
 * Finds events by name.
 */
export function findEvents(runtime: MockRuntime, name: string): Array<{ name: string; data: unknown; timestamp: number }> {
    return runtime.events.filter(e => e.name === name);
}

/**
 * Finds outputs by type.
 */
export function findOutputs(runtime: MockRuntime, type: string): Array<{ type: string; metrics: unknown[]; metadata: unknown }> {
    return runtime.outputs.filter(o => o.type === type);
}
