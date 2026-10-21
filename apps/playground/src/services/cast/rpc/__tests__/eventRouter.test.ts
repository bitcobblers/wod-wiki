import { describe, it, expect } from 'bun:test';
import { routeRuntimeEventByName, routeRuntimeEvent, clockCommandForLegacyEvent } from '../eventRouter';
import type { ClockSnapshot } from '@/clock/clockCommands';
import type { IEvent } from '@bitcobblers/wod-wiki-engine';

const makeHandles = () => {
    const calls: string[] = [];
    return {
        calls,
        handles: {
            onNext: () => { calls.push('next'); },
            onStart: () => { calls.push('start'); },
            onPause: () => { calls.push('pause'); },
            onStop: () => { calls.push('stop'); },
        },
    };
};

const event = (name: string): IEvent => ({ name, timestamp: new Date() });

describe('routeRuntimeEventByName', () => {
    it('routes "next" to handles.onNext', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEventByName('next', handles);
        expect(calls).toEqual(['next']);
    });

    it('routes "start" to handles.onStart', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEventByName('start', handles);
        expect(calls).toEqual(['start']);
    });

    it('routes "pause" to handles.onPause', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEventByName('pause', handles);
        expect(calls).toEqual(['pause']);
    });

    it('routes "stop" to handles.onStop', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEventByName('stop', handles);
        expect(calls).toEqual(['stop']);
    });

    it('ignores unknown event names without throwing', () => {
        const { calls, handles } = makeHandles();
        expect(() => routeRuntimeEventByName('select-block', handles)).not.toThrow();
        expect(calls).toEqual([]);
    });

    it('ignores the runtime internal "tick" event', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEventByName('tick', handles);
        expect(calls).toEqual([]);
    });
});

describe('routeRuntimeEvent (IEvent convenience)', () => {
    it('pulls the name off an IEvent and routes it', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEvent(event('next'), handles);
        expect(calls).toEqual(['next']);
    });

    it('ignores unknown event names from an IEvent', () => {
        const { calls, handles } = makeHandles();
        routeRuntimeEvent(event('arbitrary'), handles);
        expect(calls).toEqual([]);
    });
});

describe('clockCommandForLegacyEvent', () => {
    const snapshot = (overrides: Partial<ClockSnapshot> = {}) => ({
        runId: 'run-1', phase: 'live' as const, status: 'running' as const,
        canNext: true, canStop: true, stopRequested: false,
        reps: [], selectedOccurrenceId: null, entry: null, error: null, saving: false,
        ...overrides,
    });

    it('maps legacy names to their gated clock commands', () => {
        expect(clockCommandForLegacyEvent('next', snapshot())).toEqual({ kind: 'next' });
        expect(clockCommandForLegacyEvent('pause', snapshot())).toEqual({ kind: 'playback' });
        expect(clockCommandForLegacyEvent('stop', snapshot())).toEqual({ kind: 'stop-request' });
        expect(clockCommandForLegacyEvent('dismiss', snapshot())).toEqual({ kind: 'dismiss' });
    });

    it('maps legacy start to ready-start before the run and playback once live', () => {
        expect(clockCommandForLegacyEvent('start', snapshot({ phase: 'ready', status: 'idle' })))
            .toEqual({ kind: 'ready-start' });
        expect(clockCommandForLegacyEvent('start', snapshot({ phase: 'live', status: 'paused' })))
            .toEqual({ kind: 'playback' });
    });

    it('returns null without an active snapshot (nothing to command)', () => {
        expect(clockCommandForLegacyEvent('next', null)).toBeNull();
    });

    it('returns null for non-clock legacy names (select-block stays on its own channel)', () => {
        expect(clockCommandForLegacyEvent('select-block', snapshot())).toBeNull();
    });
});
