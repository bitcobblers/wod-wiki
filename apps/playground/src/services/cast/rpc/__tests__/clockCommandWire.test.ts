/**
 * clockCommandWire.test.ts — Cast boundary validation for the clock command
 * channel and the receiver session's snapshot stream.
 *
 * Pins the trust boundary: malformed `{runId, command}` payloads are dropped
 * (never defaulted), and the receiver session replays the latest snapshot to
 * late subscribers (initial publication) while fanning out updates.
 */

import { describe, it, expect } from 'bun:test';
import { parseClockCommandPayload, isRpcClockSnapshot, type RpcMessage } from '../RpcMessages';
import { createReceiverSession, type ReceiverSessionHandle } from '../ReceiverSessionManager';
import { FakeRpcTransport, connectPair } from '@/testing/transport';
import type { ClockSnapshot } from '@/clock/clockCommands';

const snapshot = (overrides: Partial<ClockSnapshot> = {}): ClockSnapshot => ({
    runId: 'run-1',
    phase: 'live',
    status: 'running',
    canNext: true,
    canStop: true,
    stopRequested: false,
    reps: [],
    selectedOccurrenceId: null,
    entry: null,
    error: null,
    saving: false,
    ...overrides,
});

describe('parseClockCommandPayload', () => {
    it('accepts a well-formed clock-command payload', () => {
        expect(parseClockCommandPayload({ runId: 'run-1', command: { kind: 'next' } }))
            .toEqual({ runId: 'run-1', command: { kind: 'next' } });
        expect(parseClockCommandPayload({
            runId: 'run-1',
            command: { kind: 'entry-save', fieldId: 'f1', value: 21 },
        })).toEqual({ runId: 'run-1', command: { kind: 'entry-save', fieldId: 'f1', value: 21 } });
    });

    it('drops malformed payloads instead of guessing', () => {
        expect(parseClockCommandPayload(null)).toBeNull();
        expect(parseClockCommandPayload('next')).toBeNull();
        expect(parseClockCommandPayload({ command: { kind: 'next' } })).toBeNull(); // no runId
        expect(parseClockCommandPayload({ runId: '', command: { kind: 'next' } })).toBeNull();
        expect(parseClockCommandPayload({ runId: 'run-1', command: { kind: 'format-c-drive' } })).toBeNull();
        expect(parseClockCommandPayload({ runId: 'run-1', command: { kind: 'reps-adjust', occurrenceId: 'b1', delta: 5 } })).toBeNull();
        expect(parseClockCommandPayload({ runId: 'run-1', command: { kind: 'entry-save', fieldId: 'f1', value: '21' } })).toBeNull();
        expect(parseClockCommandPayload({ runId: 'run-1' })).toBeNull(); // no command
    });
});

describe('isRpcClockSnapshot', () => {
    it('accepts well-formed snapshot messages and null (no active run)', () => {
        const message: RpcMessage = { type: 'rpc-clock-snapshot', snapshot: snapshot() };
        expect(isRpcClockSnapshot(message)).toBe(true);
        expect(isRpcClockSnapshot({ type: 'rpc-clock-snapshot', snapshot: null })).toBe(true);
    });

    it('rejects other messages and snapshot shells missing required fields', () => {
        expect(isRpcClockSnapshot({ type: 'rpc-event', name: 'next', timestamp: 0 })).toBe(false);
        expect(isRpcClockSnapshot({ type: 'rpc-clock-snapshot', snapshot: { runId: 'x' } })).toBe(false);
        expect(isRpcClockSnapshot({ type: 'rpc-clock-snapshot', snapshot: {} })).toBe(false);
    });
});

describe('receiver session clock snapshot stream', () => {
    it('replays the latest snapshot to late subscribers and fans out updates', () => {
        const sender = new FakeRpcTransport();
        const receiver = new FakeRpcTransport();
        connectPair(sender, receiver);

        // Session builds a real ChromecastProxyRuntime against the fake
        // transport; runtime construction must not throw for this test.
        let handle: ReceiverSessionHandle | undefined;
        try {
            handle = createReceiverSession(receiver, { audio: false });

            const seen: Array<ClockSnapshot | null> = [];
            const unsubscribe = handle.onClockSnapshot((s) => seen.push(s));
            expect(seen).toEqual([null]); // immediate replay: nothing yet

            sender.send({ type: 'rpc-clock-snapshot', snapshot: snapshot({ canNext: false }) });
            expect(seen.length).toBe(2);
            expect(seen[1]?.canNext).toBe(false);
            expect(handle.getClockSnapshot()?.canNext).toBe(false);

            // A subscriber attaching mid-run sees the current snapshot.
            const late: Array<ClockSnapshot | null> = [];
            handle.onClockSnapshot((s) => late.push(s));
            expect(late).toEqual([snapshot({ canNext: false })]);

            // null is real data (run ended) and fans out too.
            sender.send({ type: 'rpc-clock-snapshot', snapshot: null });
            expect(handle.getClockSnapshot()).toBeNull();

            unsubscribe();
            sender.dispose();
            receiver.dispose();
        } finally {
            handle?.dispose();
        }
    });

    it('ignores malformed snapshot shells from the wire', () => {
        const sender = new FakeRpcTransport();
        const receiver = new FakeRpcTransport();
        connectPair(sender, receiver);

        let handle: ReceiverSessionHandle | undefined;
        try {
            handle = createReceiverSession(receiver, { audio: false });
            const seen: Array<ClockSnapshot | null> = [];
            handle.onClockSnapshot((s) => seen.push(s));

            sender.send({ type: 'rpc-clock-snapshot', snapshot: { runId: 'x' } } as unknown as RpcMessage);
            expect(seen).toEqual([null]);
            expect(handle.getClockSnapshot()).toBeNull();

            sender.dispose();
            receiver.dispose();
        } finally {
            handle?.dispose();
        }
    });
});
