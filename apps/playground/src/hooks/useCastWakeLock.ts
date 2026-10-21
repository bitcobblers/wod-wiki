/**
 * useCastWakeLock — keep the screen awake while a cast session is active.
 *
 * A casting browser tab must keep receiving receiver events (workout control
 * from the couch), so the machine must not sleep mid-workout. Uses the
 * Screen Wake Lock API when available; browsers release the lock when the
 * tab hides, so the lock is re-acquired on visibilitychange while active.
 * Denied/unsupported is a no-op — casting still works, the screen may sleep.
 */

import { useEffect, useRef } from 'react';

interface WakeLockSentinelLike {
    released: boolean;
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Resolve the Screen Wake Lock API — a real platform API absent from this
 * DOM lib snapshot, so the surface is declared locally and narrowed via
 * `in` guards instead of an unchecked cast.
 */
function getScreenWakeLock(): WakeLockLike | undefined {
    if (!('wakeLock' in navigator)) return undefined;
    const candidate: unknown = navigator.wakeLock;
    if (typeof candidate !== 'object' || candidate === null || !('request' in candidate)) return undefined;
    return candidate as WakeLockLike;
}

export function useCastWakeLock(active: boolean): void {
    const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

    useEffect(() => {
        const wakeLock = getScreenWakeLock();
        if (!wakeLock || !active) return;

        let cancelled = false;

        const acquire = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const sentinel = await wakeLock.request('screen');
                if (cancelled) {
                    void sentinel.release();
                    return;
                }
                sentinelRef.current = sentinel;
                // The browser auto-releases on tab hide; clear the stale
                // sentinel so the visibility handler can re-acquire.
                sentinel.addEventListener('release', () => {
                    if (sentinelRef.current === sentinel) sentinelRef.current = null;
                });
            } catch {
                // Denied or unsupported — not fatal, just let the OS decide.
            }
        };

        const onVisibility = () => {
            if (document.visibilityState === 'visible' && !sentinelRef.current) void acquire();
        };

        void acquire();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', onVisibility);
            const sentinel = sentinelRef.current;
            sentinelRef.current = null;
            if (sentinel && !sentinel.released) void sentinel.release();
        };
    }, [active]);
}
