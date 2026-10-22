import { describe, it, expect, beforeEach } from 'bun:test';
import { getCastBackend, __setCastBackendForTest, __resetCastBackendForTest } from '../getCastBackend';
import { ChromecastBackend } from '../adapters/ChromecastBackend';
import type { ICastBackend } from '../ICastBackend';

describe('getCastBackend', () => {
    beforeEach(() => {
        __resetCastBackendForTest();
    });

    describe('getCastBackend (memoization)', () => {
        it('returns the same ChromecastBackend instance on repeated calls', () => {
            const a = getCastBackend();
            const b = getCastBackend();
            expect(a).toBe(b);
            expect(a).toBeInstanceOf(ChromecastBackend);
        });
    });

    describe('test injection', () => {
        it('__setCastBackendForTest replaces the memoized instance', () => {
            const real = getCastBackend();
            const fake: ICastBackend = {
                state: 'ready',
                startSession: () => Promise.reject(new Error('not used')),
                endSession: () => { /* noop */ },
                onStateChanged: () => () => { /* noop */ },
            };
            __setCastBackendForTest(fake);
            expect(getCastBackend()).toBe(fake);
            expect(getCastBackend()).not.toBe(real);
        });

        it('__resetCastBackendForTest clears the instance', () => {
            const fake: ICastBackend = {
                state: 'ready',
                startSession: () => Promise.reject(new Error('not used')),
                endSession: () => { /* noop */ },
                onStateChanged: () => () => { /* noop */ },
            };
            __setCastBackendForTest(fake);
            __resetCastBackendForTest();
            // After reset, getCastBackend constructs from the build's CAST_BACKEND.
            const fresh = getCastBackend();
            expect(fresh).not.toBe(fake);
        });

        it('setting the same instance twice does not double-dispose', () => {
            const fake: ICastBackend = {
                state: 'ready',
                startSession: () => Promise.reject(new Error('not used')),
                endSession: () => { /* noop */ },
                onStateChanged: () => () => { /* noop */ },
            };
            let disposeCount = 0;
            const tracking: ICastBackend = {
                ...fake,
                dispose: () => { disposeCount++; },
            };
            __setCastBackendForTest(tracking);
            __setCastBackendForTest(tracking);
            expect(disposeCount).toBe(0);
        });

        it('replacing the instance disposes the previous one', () => {
            let disposeCount = 0;
            const a: ICastBackend = {
                state: 'ready',
                startSession: () => Promise.reject(new Error('not used')),
                endSession: () => { /* noop */ },
                onStateChanged: () => () => { /* noop */ },
                dispose: () => { disposeCount++; },
            };
            const b: ICastBackend = {
                state: 'ready',
                startSession: () => Promise.reject(new Error('not used')),
                endSession: () => { /* noop */ },
                onStateChanged: () => () => { /* noop */ },
            };
            __setCastBackendForTest(a);
            __setCastBackendForTest(b);
            expect(disposeCount).toBe(1);
        });
    });
});
