/**
 * useCastWakeLock.test.ts — screen wake lock tracks the cast session.
 *
 * Active ⇒ request('screen'); unmount (disconnect) ⇒ release; a
 * browser-initiated release (tab hide) is re-acquired on visibilitychange
 * while still active. Mounted directly in the target state — the repo's
 * hook tests avoid `rerender` (no act environment in bun test).
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useCastWakeLock } from './useCastWakeLock';

interface FakeSentinel {
    released: boolean;
    releaseListeners: Array<() => void>;
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
}

interface FakeWakeLock {
    requests: number;
    sentinel: FakeSentinel;
    request(type: 'screen'): Promise<FakeSentinel>;
}

function installFakeWakeLock(): FakeWakeLock {
    const fake: FakeWakeLock = {
        requests: 0,
        sentinel: {
            released: false,
            releaseListeners: [],
            async release() {
                this.released = true;
                for (const l of this.releaseListeners) l();
            },
            addEventListener(_t: 'release', l: () => void) {
                this.releaseListeners.push(l);
            },
        },
        async request() {
            this.requests++;
            this.sentinel.released = false;
            return this.sentinel;
        },
    };
    // jsdom's `navigator` is read-only — shadow it with a configurable own
    // property so the hook's feature detection sees the fake. jsdom also
    // defaults visibilityState to "prerender"; the hook (correctly) never
    // requests a lock for a hidden document, so pin it visible.
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { wakeLock: fake },
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    return fake;
}

afterEach(() => {
    cleanup();
    delete (globalThis as { navigator?: unknown }).navigator;
});

describe('useCastWakeLock', () => {
    it('requests the screen lock while casting and releases on disconnect', async () => {
        const fake = installFakeWakeLock();
        // act(): passive effects only flush inside act in this environment,
        // and sync act() does not return the callback's value.
        let unmountFn: () => void = () => {};
        act(() => {
            unmountFn = renderHook(() => useCastWakeLock(true)).unmount;
        });
        await waitFor(() => expect(fake.requests).toBe(1));

        act(() => unmountFn());
        await waitFor(() => expect(fake.sentinel.released).toBe(true));
    });

    it('re-acquires after a browser-initiated release while still casting', async () => {
        const fake = installFakeWakeLock();
        act(() => renderHook(() => useCastWakeLock(true)));
        await waitFor(() => expect(fake.requests).toBe(1));

        // Browser hides the tab → auto-release fires → sentinel ref clears.
        fake.sentinel.released = true;
        for (const l of [...fake.sentinel.releaseListeners]) l();

        // Tab becomes visible again → hook re-acquires.
        await act(async () => {
            document.dispatchEvent(new window.Event('visibilitychange'));
            await Promise.resolve();
        });
        await waitFor(() => expect(fake.requests).toBe(2));
    });
});
