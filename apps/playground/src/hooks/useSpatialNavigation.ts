/**
 * useSpatialNavigation — Spatial focus management for TV remote (D-Pad) navigation.
 *
 * This hook manages a registry of focusable elements on screen and moves focus
 * between them based on directional arrow key input. It is designed for the
 * Chromecast Web Receiver "10-foot" experience where the only input device is
 * a standard TV remote with a D-Pad (Up/Down/Left/Right) and Select button.
 *
 * Elements register themselves by placing `data-nav-id` attributes. The hook
 * scans the DOM for these elements, tracks which one is currently focused,
 * and uses spatial proximity (bounding rect) to determine the next target
 * when an arrow key is pressed.
 *
 * Usage:
 * ```tsx
 * const { focusedId, getFocusProps } = useSpatialNavigation({
 *   onSelect: (id, el) => el.click(),
 * });
 *
 * <button {...getFocusProps('play-btn')}>Play</button>
 * <button {...getFocusProps('stop-btn')}>Stop</button>
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeClockKey, type ClockKeyAction, type ClockKeyMode } from '@/clock/clockCommands';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpatialNavigationOptions {
    /** Called when the user presses Enter/Select on the focused element. */
    onSelect?: (elementId: string, element: HTMLElement) => void;
    /** Called whenever focus moves to a different element (including programmatic changes). */
    onFocusChanged?: (elementId: string | null, element: HTMLElement | null) => void;
    /**
     * Clock command keys surfaced from the shared normalizer: playback,
     * cancel, values, reps-adjust, context primary, and (while value entry is
     * open) digit/back draft edits. The receiver maps these to clock-command
     * dispatches; unhandled kinds are simply not consumed.
     */
    onClockAction?: (action: Extract<ClockKeyAction, { kind: 'playback' | 'cancel' | 'values' | 'reps-adjust' | 'primary' | 'digit' | 'back' }>) => void;
    /** When false, the hook is inert and does not intercept key events. */
    enabled?: boolean;
    /** Optional initial element to focus. */
    initialFocusId?: string;
    /**
     * CSS class applied to the currently focused element in addition to
     * the built-in `[data-nav-focused]` attribute. Defaults to `'tv-focus'`.
     */
    focusClassName?: string;
    /**
     * True while a value-entry surface is open (clock `snapshot.entry`):
     * every digit key — including Numpad 8/2/4/6 with Num Lock off — is
     * data, never navigation. Arrow keys still move focus.
     */
    entryOpen?: boolean;
    /**
     * Shared Navigation/Keypad key mode (`getClockKeyMode()` by default):
     * `'navigation'` reads main Enter as Select; `'keypad'` reads it as the
     * context primary for remotes with indistinguishable Enter keys.
     */
    controlMode?: ClockKeyMode;
}

export interface FocusProps {
    'data-nav-id': string;
    'data-nav-focused': boolean;
    tabIndex: number;
    ref: (el: HTMLElement | null) => void;
    /** Keeps the registry in sync with real DOM focus (click, Tab). */
    onFocus: () => void;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
    cx: number;
    cy: number;
}

function getRect(el: HTMLElement): Rect {
    const r = el.getBoundingClientRect();
    return {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
    };
}

type Direction = 'up' | 'down' | 'left' | 'right';


/**
 * For a given direction, filter candidate rects that lie in that direction
 * relative to `origin`, then pick the nearest one using a weighted distance
 * that favours alignment on the perpendicular axis.
 */
function findNearest(
    originRect: Rect,
    candidates: { id: string; rect: Rect }[],
    direction: Direction,
): string | null {
    // Filter candidates that are in the correct direction
    const inDirection = candidates.filter(({ rect }) => {
        switch (direction) {
            case 'up':
                return rect.cy < originRect.cy;
            case 'down':
                return rect.cy > originRect.cy;
            case 'left':
                return rect.cx < originRect.cx;
            case 'right':
                return rect.cx > originRect.cx;
        }
    });

    if (inDirection.length === 0) return null;

    // Score: weighted Euclidean distance.
    // Primary axis distance is weighted 1×, secondary (perpendicular) 3×.
    // This makes it prefer items that are roughly aligned on the off-axis.
    let bestId: string | null = null;
    let bestScore = Infinity;

    for (const { id, rect } of inDirection) {
        const dx = rect.cx - originRect.cx;
        const dy = rect.cy - originRect.cy;

        let score: number;
        if (direction === 'up' || direction === 'down') {
            // Primary axis is Y, secondary is X
            score = Math.abs(dy) + Math.abs(dx) * 3;
        } else {
            // Primary axis is X, secondary is Y
            score = Math.abs(dx) + Math.abs(dy) * 3;
        }

        if (score < bestScore) {
            bestScore = score;
            bestId = id;
        }
    }

    return bestId;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSpatialNavigation(options: SpatialNavigationOptions = {}) {
    const {
        onSelect,
        onFocusChanged,
        onClockAction,
        enabled = true,
        initialFocusId,
        focusClassName = 'tv-focus',
        entryOpen = false,
        controlMode,
    } = options;

    const [focusedId, setFocusedId] = useState<string | null>(initialFocusId ?? null);
    const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
    const focusedIdRef = useRef<string | null>(focusedId);

    // Live refs for the keydown listener: callbacks/options change every
    // render, the listener must not re-subscribe (and drop mid-press).
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const onClockActionRef = useRef(onClockAction);
    onClockActionRef.current = onClockAction;
    const entryOpenRef = useRef(entryOpen);
    entryOpenRef.current = entryOpen;
    const controlModeRef = useRef(controlMode);
    controlModeRef.current = controlMode;

    // Keep ref in sync and notify listener
    useEffect(() => {
        focusedIdRef.current = focusedId;
        if (onFocusChanged) {
            const el = focusedId ? elementsRef.current.get(focusedId) ?? null : null;
            onFocusChanged(focusedId, el);
        }
    }, [focusedId, onFocusChanged]);

    // ── Element registration via ref callback ────────────────────────────────

    const registerElement = useCallback((id: string, el: HTMLElement | null) => {
        if (el) {
            elementsRef.current.set(id, el);
            // Apply focus class immediately when the currently-focused element
            // registers (e.g., on initial mount when focusedId is already set).
            // Without this, the element registers AFTER the focusedId useEffect
            // fires, leaving it without a visible focus indicator.
            if (id === focusedIdRef.current) {
                el.classList.add(focusClassName);
                el.setAttribute('data-nav-focused', 'true');
            }
        } else {
            const existing = elementsRef.current.get(id);
            if (existing) {
                existing.classList.remove(focusClassName);
                existing.setAttribute('data-nav-focused', 'false');
            }
            elementsRef.current.delete(id);
        }
    }, [focusClassName]);

    // ── Apply / remove focus class + real DOM focus ──────────────────────────

    useEffect(() => {
        if (!enabled) return;

        // Remove class from all, add to focused. The focused element also
        // receives real DOM focus so `document.activeElement`, native
        // :focus-visible styles, and screen readers agree with the spatial
        // selection (one selection, one truth).
        for (const [id, el] of elementsRef.current.entries()) {
            if (id === focusedId) {
                el.classList.add(focusClassName);
                el.setAttribute('data-nav-focused', 'true');
                el.focus({ preventScroll: true });
                // Scroll focused element into view for TV/10-foot UIs.
                // 'nearest' avoids unnecessary scrolling when the element is
                // already fully visible; 'auto' keeps D-Pad navigation snappy.
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } else {
                el.classList.remove(focusClassName);
                el.setAttribute('data-nav-focused', 'false');
            }
        }
    }, [focusedId, enabled, focusClassName]);

    // ── Keydown handler ─────────────────────────────────────────────────────

    useEffect(() => {
        if (!enabled) return;

        const moveFocus = (direction: Direction, entryOpen: boolean): void => {
            const currentId = focusedIdRef.current;
            const elements = elementsRef.current;

            // While the value-entry card is open, D-pad stays inside the card.
            const entryCard = entryOpen
                ? document.querySelector<HTMLElement>('[data-clock-entry]')
                : null;

            // If nothing is focused yet, focus the first registered element
            if (!currentId || !elements.has(currentId)) {
                const fallback = entryCard
                    ? [...elements.entries()].find(([, el]) => entryCard.contains(el))?.[0]
                    : undefined;
                const firstId = fallback ?? elements.keys().next().value;
                if (firstId) setFocusedId(firstId as string);
                return;
            }

            const originEl = elements.get(currentId);
            if (!originEl) return;

            // Origin drifted outside the open card: pull focus back in.
            if (entryCard && !entryCard.contains(originEl)) {
                const inside = [...elements.entries()].find(([, el]) => entryCard.contains(el) && el.offsetParent !== null);
                if (inside) setFocusedId(inside[0]);
                return;
            }

            const originRect = getRect(originEl);

            const candidates: { id: string; rect: Rect }[] = [];
            for (const [id, el] of elements.entries()) {
                if (id === currentId) continue;
                // Only consider visible elements
                if (el.offsetParent === null) continue;
                // Entry open: candidates are scoped to the entry card.
                if (entryCard && !entryCard.contains(el)) continue;
                candidates.push({ id, rect: getRect(el) });
            }

            const nextId = findNearest(originRect, candidates, direction);
            if (nextId) {
                setFocusedId(nextId);
            }
        };

        const activateFocused = (): void => {
            const currentId = focusedIdRef.current;
            if (!currentId) return;
            const el = elementsRef.current.get(currentId);
            if (el && onSelectRef.current) {
                onSelectRef.current(currentId, el);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl/Alt/Meta shortcuts and IME composition are never D-Pad input.
            if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
            // A clock modal (key-check dialog) owns the keys while open — the
            // navigator must not move focus or click controls behind it.
            if (document.body.dataset.clockModal) return;

            // Inside the entry card the card's own keyboard handling owns the
            // keys (digits, back, cancel, keypad Enter, focus trap) — the
            // navigator must not double-edit the draft or double-commit.
            const entryCard = entryOpenRef.current
                ? document.querySelector<HTMLElement>('[data-clock-entry]')
                : null;
            const target = e.target as Node | null;

            const action = normalizeClockKey(e, {
                entryOpen: entryOpenRef.current,
                mode: controlModeRef.current,
            });
            if (entryCard && target && (target === entryCard || entryCard.contains(target)) && action.kind !== 'direction' && !(action.kind === 'select' && e.key !== 'Enter')) return;

            switch (action.kind) {
                case 'direction':
                    // Held-key repeat is desirable for movement.
                    e.preventDefault();
                    moveFocus(action.direction, entryOpenRef.current);
                    return;

                case 'digit':
                case 'back':
                    // Draft edits only while entry is open; digits/back may repeat.
                    if (!entryOpenRef.current) return;
                    e.preventDefault();
                    onClockActionRef.current?.(action);
                    return;

                case 'playback':
                case 'cancel':
                case 'values':
                case 'reps-adjust':
                case 'primary':
                    // Mutation keys ignore held-key repeats.
                    e.preventDefault();
                    if (e.repeat) return;
                    onClockActionRef.current?.(action);
                    return;

                case 'select':
                    // One activation per press: preventDefault suppresses the
                    // native click this keydown would produce on the (real)
                    // focused element, then we issue exactly one virtual one.
                    e.preventDefault();
                    if (e.repeat) return;
                    activateFocused();
                    return;

                case 'none':
                    // Data keys are never consumed by navigation.
                    return;
            }
        };

        // Use capture phase on document so we intercept key events BEFORE
        // the Cast Receiver SDK's own handlers can consume them.
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [enabled]);

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Returns props to spread onto a focusable element.
     *
     * ```tsx
     * <button {...getFocusProps('my-btn')}>Click me</button>
     * ```
     */
    /**
     * Clear all registered elements and optionally reset focus.
     * Use this when the entire focusable surface changes (e.g. cross-mode
     * transitions in the Chromecast receiver) so stale elements from the
     * previous mode don't pollute spatial navigation in the new mode.
     */
    const reset = useCallback((newInitialFocusId?: string | null) => {
        // Clean up focus classes from all tracked elements before clearing
        for (const [_id, el] of elementsRef.current.entries()) {
            el.classList.remove(focusClassName);
            el.setAttribute('data-nav-focused', 'false');
        }
        elementsRef.current.clear();
        const nextId = newInitialFocusId ?? null;
        setFocusedId(nextId);
        focusedIdRef.current = nextId;
    }, [focusClassName]);

    const getFocusProps = useCallback(
        (id: string): FocusProps => ({
            'data-nav-id': id,
            'data-nav-focused': focusedId === id,
            tabIndex: 0,
            ref: (el: HTMLElement | null) => registerElement(id, el),
            // Clicks and Tab move real DOM focus first; keep the spatial
            // selection in lockstep so there is exactly one selection.
            onFocus: () => setFocusedId(id),
        }),
        [focusedId, registerElement],
    );

    return {
        /** The ID of the currently focused element, or null. */
        focusedId,
        /** Programmatically move focus to a specific element. */
        setFocusedId,
        /** Spread these props onto any element that should participate in navigation. */
        getFocusProps,
        /** Clear the registry and optionally reset focus — useful on mode transitions. */
        reset,
    } as const;
}
