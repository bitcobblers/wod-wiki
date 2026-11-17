import { describe, it, expect } from 'vitest';

import { ChromecastSdk } from '../ChromecastSdk';

// The repo bun preload (tests/unit-setup.ts) provides jsdom window/document;
// the SDK's script-tag loading and global callback run against them. Cast
// globals are declared on Window in ChromecastSdk.ts's `declare global`.
function fireSdkCallback(available: boolean): void {
    window.__onGCastApiAvailable?.(available, available ? undefined : new Error('no cast'));
}

describe('ChromecastSdk.load retry semantics', () => {
    it('a failed load does not poison later load() calls', async () => {
        // First attempt: SDK reports itself unavailable.
        const first = ChromecastSdk.load('TESTAPP01');
        fireSdkCallback(false);
        await expect(first).rejects.toThrow();

        // Second attempt must create a fresh promise (pending until the SDK
        // callback fires), not hand back the already-rejected memo. Flush a
        // few microtask ticks so an immediate rejection would have landed.
        const retry = ChromecastSdk.load('TESTAPP01');
        let settled: 'resolved' | 'rejected' | undefined;
        void retry.then(
            () => {
                settled = 'resolved';
            },
            () => {
                settled = 'rejected';
            },
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBeUndefined();

        // Success path needs the framework stubs _initFramework touches.
        window.cast = {
            framework: {
                CastContextEventType: { SESSION_STATE_CHANGED: 'sessionstatechanged' },
                CastContext: {
                    getInstance: () => ({
                        setOptions: () => {},
                        addEventListener: () => {},
                        getCurrentSession: () => null,
                        requestSession: async () => undefined,
                    }),
                },
            },
        };
        window.chrome = { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' } } };

        fireSdkCallback(true);
        await expect(retry).resolves.toBeUndefined();
        expect(settled).toBe('resolved');
    });
});
