// @vitest-environment happy-dom
/**
 * Tests for useBlockMemory hooks
 * 
 * These tests verify that the hooks correctly subscribe to block memory
 * and update when behaviors modify the memory state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
    useBlockMemory,
    useTimerState,
    useRoundState,
    useDisplayState,
    useTimerDisplay,
    useRoundDisplay
} from '../../src/react/hooks/useBlockMemory';
import { IRuntimeBlock } from '../../src/runtime/contracts/IRuntimeBlock';
import { MemoryEntry } from '../../src/runtime/types/executionSnapshot';
import { TimerState, RoundState, DisplayState } from '../../src/runtime/memory/MemoryTypes';
import { TimeSpan } from '../../src/runtime/models/TimeSpan';

import { MemoryLocation, MemoryTag } from '../../src/runtime/memory/MemoryLocation';

// Workspace has no `globals: true`, so testing-library's auto-cleanup never
// registers. Without this, mounted useTimerDisplay/useRoundDisplay rAF loops
// keep scheduling React work past happy-dom teardown (window is gone → uncaught
// ReferenceError fails the whole vitest run).
afterEach(() => cleanup());

// Mock block factory
function createMockBlock(initialMemory: Map<string, unknown> = new Map()): IRuntimeBlock {
    const memoryLocations: MemoryLocation[] = [];

    // Initialize with any provided memory
    for (const [tag, value] of initialMemory) {
        if (tag === 'round') {
            // For rounds, the metrics itself IS the RoundState (it has current/total properties)
            memoryLocations.push(new MemoryLocation(tag as MemoryTag, [value as any]));
        } else {
            memoryLocations.push(new MemoryLocation(tag as MemoryTag, [{ type: 0 as any, image: '', origin: 'runtime' as any, value }]));
        }
    }

    return {
        key: { toString: () => 'test-block' },
        blockType: 'Test',
        label: 'Test Block',
        sourceIds: [],
        context: {} as any,
        executionTiming: {},
        getMemoryByTag: (tag: MemoryTag) => memoryLocations.filter(l => l.tag === tag),
        hasMemory: (tag: MemoryTag) => memoryLocations.some(l => l.tag === tag),
        pushMemory: (loc: MemoryLocation) => memoryLocations.push(loc),
        // Expose for test manipulation
        _memoryLocations: memoryLocations
    } as unknown as IRuntimeBlock;
}

describe('useBlockMemory', () => {
    describe('basic functionality', () => {
        it('should return undefined when block is undefined', () => {
            const { result } = renderHook(() =>
                useBlockMemory(undefined, 'time')
            );
            expect(result.current).toBeUndefined();
        });

        it('should return initial value from memory', () => {
            const timerState: TimerState = {
                spans: [],
                direction: 'up',
                label: 'Test',
                role: 'primary'
            };
            const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));

            const { result } = renderHook(() =>
                useBlockMemory(block, 'time')
            );

            expect(result.current).toEqual(timerState);
        });

        it('should update when memory changes', () => {
            const initialState: TimerState = {
                spans: [],
                direction: 'up',
                label: 'Test',
                role: 'primary'
            };
            const block = createMockBlock(new Map<string, unknown>([['time', initialState]]));

            const { result } = renderHook(() =>
                useBlockMemory(block, 'time')
            );

            expect(result.current).toEqual(initialState);

            // Update memory
            const updatedState: TimerState = {
                ...initialState,
                spans: [new TimeSpan(1000)]
            };

            act(() => {
                const loc = (block as any)._memoryLocations.find((l: any) => l.tag === 'time');
                loc?.update([{ type: 0 as any, image: '', origin: 'runtime' as any, value: updatedState }]);
            });

            expect(result.current).toEqual(updatedState);
        });

        it('should clean up subscription on unmount', () => {
            const timerState: TimerState = {
                spans: [],
                direction: 'up',
                label: 'Test',
                role: 'primary'
            };
            const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));
            const entry = (block as any)._memoryLocations.find((l: any) => l.tag === 'time') as MemoryLocation;

            const { unmount } = renderHook(() =>
                useBlockMemory(block, 'time')
            );

            // Entry should have a subscriber
            expect((entry as any)._listeners.size).toBe(1);

            unmount();

            // Subscriber should be removed
            expect((entry as any)._listeners.size).toBe(0);
        });
    });
});

describe('useTimerState', () => {
    it('should return timer state from block', () => {
        const timerState: TimerState = {
            spans: [new TimeSpan(1000)],
            direction: 'down',
            durationMs: 60000,
            label: 'Countdown',
            role: 'primary'
        };
        const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));

        const { result } = renderHook(() => useTimerState(block));

        expect(result.current).toEqual(timerState);
        expect(result.current?.direction).toBe('down');
        expect(result.current?.durationMs).toBe(60000);
    });
});

describe('useRoundState', () => {
    it('should return round state from block', () => {
        const roundState: RoundState = {
            current: 3,
            total: 5
        };
        const block = createMockBlock(new Map<string, unknown>([['round', roundState]]));

        const { result } = renderHook(() => useRoundState(block));

        expect(result.current).toEqual(roundState);
        expect(result.current?.current).toBe(3);
        expect(result.current?.total).toBe(5);
    });
});

describe('useDisplayState', () => {
    it('should return display state from block', () => {
        const displayState: DisplayState = {
            mode: 'countdown',
            label: 'EMOM',
            roundDisplay: 'Round 2 of 10'
        };
        const block = createMockBlock(new Map<string, unknown>([['display', displayState]]));

        const { result } = renderHook(() => useDisplayState(block));

        expect(result.current).toEqual(displayState);
        expect(result.current?.mode).toBe('countdown');
    });
});

describe('useTimerDisplay', () => {
    let originalDateNow: () => number;

    beforeEach(() => {
        originalDateNow = Date.now;
    });

    afterEach(() => {
        Date.now = originalDateNow;
    });

    it('should return null when no timer state', () => {
        const block = createMockBlock();

        const { result } = renderHook(() => useTimerDisplay(block));

        expect(result.current).toBeNull();
    });

    it('should calculate elapsed time from spans', () => {
        // Use completed spans so Date.now() isn't needed
        const timerState: TimerState = {
            spans: [new TimeSpan(5000, 8000)], // 3 seconds elapsed
            direction: 'up',
            label: 'Test',
            role: 'primary'
        };
        const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));

        const { result } = renderHook(() => useTimerDisplay(block));

        expect(result.current?.elapsed).toBe(3000);
        expect(result.current?.isRunning).toBe(false);
        expect(result.current?.formatted).toBe('00:03');
    });

    it('should calculate remaining time for countdown', () => {
        // Use completed spans so Date.now() isn't needed
        const timerState: TimerState = {
            spans: [new TimeSpan(5000, 8000)], // 3 seconds elapsed
            direction: 'down',
            durationMs: 60000, // 60 second countdown
            label: 'Countdown',
            role: 'primary'
        };
        const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));

        const { result } = renderHook(() => useTimerDisplay(block));

        expect(result.current?.elapsed).toBe(3000);
        expect(result.current?.remaining).toBe(57000); // 60s - 3s
        expect(result.current?.isComplete).toBe(false);
        expect(result.current?.direction).toBe('down');
        expect(result.current?.formatted).toBe('00:57'); // Shows remaining for countdown
    });

    it('should detect running timer', () => {
        // Mock Date.now for running timer test
        const mockNow = 10000;
        Date.now = () => mockNow;

        const timerState: TimerState = {
            spans: [new TimeSpan(5000)], // No end time = running
            direction: 'up',
            label: 'Test',
            role: 'primary'
        };
        const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));

        const { result } = renderHook(() => useTimerDisplay(block));

        expect(result.current?.isRunning).toBe(true);
        expect(result.current?.elapsed).toBe(5000); // now - started
    });

    it('should mark complete when countdown reaches 0', () => {
        // Use completed spans that exceed duration
        const timerState: TimerState = {
            spans: [new TimeSpan(0, 65000)], // 65 seconds elapsed
            direction: 'down',
            durationMs: 60000,
            label: 'Done',
            role: 'primary'
        };
        const block = createMockBlock(new Map<string, unknown>([['time', timerState]]));

        const { result } = renderHook(() => useTimerDisplay(block));

        expect(result.current?.isComplete).toBe(true);
        expect(result.current?.remaining).toBe(0);
    });
});

describe('useRoundDisplay', () => {
    it('should return null when no round state', () => {
        const block = createMockBlock();

        const { result } = renderHook(() => useRoundDisplay(block));

        expect(result.current).toBeNull();
    });

    it('should format bounded rounds', () => {
        const roundState: RoundState = { current: 3, total: 5 };
        const block = createMockBlock(new Map<string, unknown>([['round', roundState]]));

        const { result } = renderHook(() => useRoundDisplay(block));

        expect(result.current?.current).toBe(3);
        expect(result.current?.total).toBe(5);
        expect(result.current?.label).toBe('Round 3 of 5');
        expect(result.current?.progress).toBeCloseTo(0.4); // (3-1)/5
    });

    it('should format unbounded rounds', () => {
        const roundState: RoundState = { current: 7, total: undefined };
        const block = createMockBlock(new Map<string, unknown>([['round', roundState]]));

        const { result } = renderHook(() => useRoundDisplay(block));

        expect(result.current?.label).toBe('Round 7');
        expect(result.current?.progress).toBeUndefined();
    });

    it('should use roundDisplay from display state if available', () => {
        const roundState: RoundState = { current: 2, total: 10 };
        const displayState: DisplayState = {
            mode: 'countdown',
            label: 'EMOM',
            roundDisplay: 'Minute 2 of 10'
        };
        const block = createMockBlock(new Map<string, unknown>([
            ['round', roundState],
            ['display', displayState]
        ]));

        const { result } = renderHook(() => useRoundDisplay(block));

        expect(result.current?.label).toBe('Minute 2 of 10');
    });
});
