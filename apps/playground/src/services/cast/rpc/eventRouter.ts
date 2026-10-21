/**
 * eventRouter — pure mapping from a cast event name to a runtime-side action.
 *
 * Both the cast button (production) and the cast-roundtrip test need to
 * interpret the same event names that the cast receiver sends when the
 * user clicks Next / Start / Pause / Stop on the TV. The mapping itself
 * is a stable, headless decision: "given an event name, which side of
 * the runtime should be poked?" — but the *poke target* differs between
 * callers. The button pokes zustand handles; the test pokes a
 * `ScriptRuntime` directly.
 *
 * This module is the shared decision. Callers pass in a
 * `RuntimeEventHandles` shape that the router invokes. The router itself
 * has no React, no zustand, no runtime — just a `switch`.
 */

import type { IEvent } from '@bitcobblers/wod-wiki-engine';
import type { ClockCommand, ClockSnapshot } from '@/clock/clockCommands';

/**
 * The four runtime-side actions the cast receiver can trigger from the TV.
 * Each is a no-arg callback the router invokes when it sees the matching
 * event name. Unrecognized names are silently ignored (the cast protocol
 * may evolve; the sender should not crash on unknown events).
 */
export interface RuntimeEventHandles {
    /** Advance to the next block (or, in a stopped state, resume). */
    onNext: () => void;
    /** Start the timer / session. */
    onStart: () => void;
    /** Pause the timer. */
    onPause: () => void;
    /** Stop the timer / session. */
    onStop: () => void;
}

/**
 * Apply a runtime action by event name. Pure function — no side effects
 * beyond calling the provided handles.
 *
 * Recognized names: `'next'`, `'start'`, `'pause'`, `'stop'`. Anything
 * else is ignored. The router does not throw on unknown names so that
 * the cast protocol can add new names without breaking older senders.
 */
export function routeRuntimeEventByName(name: string, handles: RuntimeEventHandles): void {
    switch (name) {
        case 'next': handles.onNext(); return;
        case 'start': handles.onStart(); return;
        case 'pause': handles.onPause(); return;
        case 'stop': handles.onStop(); return;
    }
}

/**
 * Convenience: same routing, but takes an `IEvent` (the shape the cast
 * event provider hands to its handlers) and pulls the name off it.
 * Unused-name-only events (e.g. data-only events) are ignored.
 */
export function routeRuntimeEvent(event: IEvent, handles: RuntimeEventHandles): void {
    routeRuntimeEventByName(event.name, handles);
}

/**
 * Map a legacy receiver event name to the gated `ClockCommand` it must
 * travel as. Legacy names ('next'/'start'/'pause'/'stop'/'dismiss') predate
 * the clock-command channel; routing them through this mapper keeps them on
 * the same authority gates as native controls — a paused `next` from an old
 * receiver is rejected by the authority exactly like a local paused Next.
 *
 * Returns `null` for unknown names (caller drops them) and when there is no
 * active snapshot (no run → nothing to command; the authority would reject
 * anyway, but dropping avoids waking it).
 */
export function clockCommandForLegacyEvent(name: string, snapshot: ClockSnapshot | null): ClockCommand | null {
    if (!snapshot) return null;
    switch (name) {
        case 'next': return { kind: 'next' };
        case 'start': return snapshot.phase === 'ready' ? { kind: 'ready-start' } : { kind: 'playback' };
        case 'pause': return { kind: 'playback' };
        case 'stop': return { kind: 'stop-request' };
        case 'dismiss': return { kind: 'dismiss' };
        default: return null;
    }
}
