/**
 * runtimeStore.test.ts — parked-run registry.
 *
 * A run whose surface unmounts mid-workout is parked (not disposed) so the
 * clock keeps running; the next visit re-binds it. These are the seams that
 * make that work.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
    clearParkedRun,
    findParkedRunByDate,
    parkRun,
    parkedRuns,
    peekParkedRun,
    takeParkedRun,
    type ParkedRun,
} from './runtimeStore';

const runtime = { id: 'runtime-1' } as unknown as ParkedRun['runtime'];

function run(overrides: Partial<ParkedRun> = {}): ParkedRun {
    return {
        runtimeId: 'run-1',
        block: { id: 'block-1' } as ParkedRun['block'],
        noteId: 'note-1',
        runtime,
        journalDate: '2026-10-21',
        ...overrides,
    };
}

describe('parked runs', () => {
    beforeEach(() => {
        parkedRuns.clear();
    });

    it('parks a run and finds it by id', () => {
        parkRun(run());
        expect(peekParkedRun('run-1')?.runtime).toBe(runtime);
    });

    it('finds a parked run by journal date', () => {
        parkRun(run());
        expect(findParkedRunByDate('2026-10-21')?.runtimeId).toBe('run-1');
        expect(findParkedRunByDate('2026-10-22')).toBeUndefined();
    });

    it('take transfers ownership (read + remove)', () => {
        parkRun(run());
        expect(takeParkedRun('run-1')?.runtime).toBe(runtime);
        expect(parkedRuns.size).toBe(0);
        expect(takeParkedRun('run-1')).toBeUndefined();
    });

    it('clear drops a finished run', () => {
        parkRun(run());
        clearParkedRun('run-1');
        expect(parkedRuns.size).toBe(0);
    });
});
