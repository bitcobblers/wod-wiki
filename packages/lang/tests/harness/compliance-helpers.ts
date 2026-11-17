/**
 * Shared Compliance Test Helpers
 *
 * Utility functions for runtime compliance tests. Extracted from
 * duplicated definitions across tests/runtime-compliance/*.test.ts
 * to ensure consistency and reduce maintenance burden.
 *
 * Two groups:
 *   1. ScriptState-based (sync) — operate on a snapshot from TestScript.snapshot()
 *   2. TestScript-based (async) — operate on a live TestScript (snapshot internally)
 */
import { MetricType, type IMetric } from '@bitcobblers/wod-wiki-core';
import { assertions } from './script';
import type { ScriptState } from './script';
import type { TestScript } from './script/TestScript';
import type { RoundState, TimerState } from '@bitcobblers/wod-wiki-engine';
import { calculateElapsed } from '@bitcobblers/wod-wiki-engine';

// ═══════════════════════════════════════════════════════════════════
// ScriptState helpers (sync — pass a snapshot)
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns the blockType of the top-of-stack block, or undefined when empty.
 */
export function currentBlockType(state: ScriptState): string | undefined {
    return state.current?.blockType;
}

/**
 * Returns display metrics for the current top-of-stack block.
 */
export function blockDisplayMetrics(state: ScriptState): IMetric[] {
    const block = state.current;
    if (!block) return [];
    return block.getMemoryByTag('metric:display').flatMap(loc => loc.metrics.toArray());
}

/**
 * Checks whether the current block's display memory contains a metric of the given type.
 */
export function blockHasDisplayMetric(state: ScriptState, metricType: MetricType | string): boolean {
    const block = state.current;
    if (!block) return false;
    return block.getMemoryByTag('metric:display')
        .flatMap(loc => loc.metrics.toArray())
        .some(m => m.type === metricType);
}

/**
 * Checks whether any block currently on the runtime stack carries a display
 * metric of the given type.
 */
export function stackHasMetric(state: ScriptState, metricType: MetricType | string): boolean {
    return state.blocks
        .flatMap(b => b.getMemoryByTag('metric:display'))
        .flatMap(loc => loc.metrics.toArray())
        .some(m => m.type === metricType);
}

/**
 * Checks whether any OUTPUT statement includes a metric of the given type.
 */
export function anyOutputHasMetric(state: ScriptState, metricType: MetricType | string): boolean {
    return assertions(state).outputs().all().some(o =>
        [...o.metrics].some(m => m.type === metricType)
    );
}

/**
 * Reads the current round state from a block of the given type on the stack.
 * Returns undefined when no matching block is present.
 */
export function getRoundState(state: ScriptState, blockType: string): RoundState | undefined {
    const block = state.blocks.find(b => b.blockType === blockType);
    if (!block) return undefined;
    return block.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
}

/**
 * Returns system pop event values from the output tracer, in emission order.
 */
export function systemPopValues(state: ScriptState): Array<Record<string, unknown>> {
    return assertions(state).outputs().all()
        .filter(o => o.outputType === 'system')
        .map(o => {
            const m = [...o.metrics].find(m => m.type === MetricType.System);
            return m?.value as Record<string, unknown> | undefined;
        })
        .filter((v): v is Record<string, unknown> => !!v && v['event'] === 'pop');
}

/**
 * Checks whether any system pop event carries the given completionReason.
 */
export function anySystemPopHasReason(state: ScriptState, reason: string): boolean {
    return assertions(state).outputs().all()
        .filter(o => o.outputType === 'system')
        .some(o => {
            const sysMetric = [...o.metrics].find(m => m.type === MetricType.System);
            const v = sysMetric?.value as Record<string, unknown> | undefined;
            return v?.event === 'pop' && v?.completionReason === reason;
        });
}

// ═══════════════════════════════════════════════════════════════════
// TestScript helpers (async — take a live TestScript)
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns the blockType of the current top-of-stack block.
 */
export async function currentBlockTypeAsync(script: TestScript): Promise<string | undefined> {
    const s = await script.snapshot();
    return s.current?.blockType;
}

/**
 * Returns the elapsed active time (ms) for the timer on the current block.
 */
export async function currentTimerElapsedMs(script: TestScript): Promise<number | undefined> {
    const s = await script.snapshot();
    const block = s.current;
    if (!block) return undefined;
    const timeLoc = block.getMemoryByTag('time')[0];
    const timer = timeLoc?.metrics[0]?.value as TimerState | undefined;
    if (!timer) return undefined;
    return calculateElapsed(timer, s.clockTime.getTime());
}

/**
 * Returns true if the current timer is paused (last span has ended set).
 */
export async function isTimerPaused(script: TestScript): Promise<boolean> {
    const s = await script.snapshot();
    const block = s.current;
    if (!block) return false;
    const timeLoc = block.getMemoryByTag('time')[0];
    const timer = timeLoc?.metrics[0]?.value as TimerState | undefined;
    if (!timer || timer.spans.length === 0) return false;
    const lastSpan = timer.spans[timer.spans.length - 1];
    return lastSpan.ended !== undefined;
}
