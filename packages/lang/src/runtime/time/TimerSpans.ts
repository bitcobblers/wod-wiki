import { IBehaviorContext } from '../contracts/IBehaviorContext';
import { TimerState } from '../memory/MemoryTypes';
import { TimeSpan } from '../models/TimeSpan';

/**
 * TimerSpans — the single module that owns how a block's timer span list is
 * read and transformed.
 *
 * ## Why this exists
 *
 * The open-span / close-span / append-span / reset dance was previously
 * hand-threaded (and `closeCurrentSpan` literally copy-pasted) across
 * CountupTimerBehavior, CountdownTimerBehavior, and SpanTrackingBehavior, with
 * the read-modify-write of `time` memory spelled out at every pause, resume,
 * unmount, and reset site. The span invariant (only the trailing span is open;
 * mutations preserve the metric fragment and only swap `spans`) lived nowhere.
 *
 * This module concentrates it:
 *
 * - **Pure span transforms** (`startSpan`, `closeCurrentSpan`, `openSpan`) are
 *   unit-testable as plain array transforms, independent of any block.
 * - **`readTimer` / `mutateTimerSpans`** own the one correct way to read and
 *   write the `time` memory location, preserving the metric fragment.
 *
 * Behaviors orchestrate *which* transform runs on *which* lifecycle hook; the
 * span math and memory plumbing live here.
 */

/** Memory tag under which a block's timer state lives. */
const TIME_TAG = 'time';

/** A list of execution spans. The trailing span may be open (`ended === undefined`). */
export type SpanList = readonly TimeSpan[];

/**
 * Start a fresh span list with a single open span.
 * Used for the initial mount span and for interval/timer resets.
 */
export function startSpan(nowMs: number): TimeSpan[] {
    return [new TimeSpan(nowMs)];
}

/**
 * Close the trailing open span at `nowMs` (pause / unmount).
 * No-op for spans that are already closed.
 */
export function closeCurrentSpan(spans: SpanList, nowMs: number): TimeSpan[] {
    return spans.map((span, i) =>
        i === spans.length - 1 && span.ended === undefined
            ? new TimeSpan(span.started, nowMs)
            : span
    );
}

/** Append a new open span at `nowMs` (resume). */
export function openSpan(spans: SpanList, nowMs: number): TimeSpan[] {
    return [...spans, new TimeSpan(nowMs)];
}

/**
 * Read the `TimerState` from a block's `time` memory, or `undefined` if absent.
 * This is the canonical accessor — prefer it over reaching into
 * `getMemoryByTag('time')[0]?.metrics[0]?.value` by hand.
 */
export function readTimer(ctx: IBehaviorContext): TimerState | undefined {
    return ctx.getMemoryByTag(TIME_TAG)[0]?.metrics[0]?.value as TimerState | undefined;
}

/**
 * Apply a span transform to the block's `time` memory, preserving the metric
 * fragment (image, direction, durationMs, label, role) and swapping only the
 * `spans` array.
 *
 * @returns `true` when the timer existed and was updated; `false` otherwise.
 */
export function mutateTimerSpans(
    ctx: IBehaviorContext,
    transform: (spans: SpanList, nowMs: number) => TimeSpan[]
): boolean {
    const fragment = ctx.getMemoryByTag(TIME_TAG)[0]?.metrics[0];
    const timer = fragment?.value as TimerState | undefined;
    if (!timer || !fragment) return false;

    const spans = transform(timer.spans, ctx.clock.currentDate.getTime());
    ctx.updateMemory(TIME_TAG, [{ ...fragment, value: { ...timer, spans } }]);
    return true;
}
