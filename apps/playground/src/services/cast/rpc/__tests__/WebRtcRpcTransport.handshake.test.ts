/**
 * WebRtcRpcTransport.handshake.test.ts — WebRTC handshake protocol behavior.
 *
 * Pins the control-plane contract that the mobile cast failure exposed:
 *
 *   1. An offer injected via `receiveSignal()` (the offer that triggered a
 *      fresh receiver transport) must be processed — the receiver used to
 *      drop it, deadlocking the handshake until the sender timed out.
 *   2. The offerer retransmits its offer on an interval until the answer
 *      arrives, so a cold/slow receiver app can still answer a later copy.
 *   3. Duplicate offers (same SDP) and duplicate answers (already stable)
 *      are ignored instead of throwing or double-answering.
 *   4. A `cast-ready` signal from a freshly-booted receiver triggers an
 *      immediate offer resend rather than waiting for the next retry tick.
 *   5. The connect timeout reports how many local ICE candidates were
 *      gathered — the key diagnostic for "stays on connecting".
 */

import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { WebRtcRpcTransport, type ISignaling } from '../WebRtcRpcTransport';
import type { WebRTCSignalMessage } from '@/types/cast/messages';

// ── Fake RTC layer ──────────────────────────────────────────────────────────

class FakeDataChannel {
    readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    readonly sent: string[] = [];
    constructor(readonly label: string) {}
    send(data: string): void {
        this.sent.push(data);
    }
    close(): void {
        this.readyState = 'closed';
        this.onclose?.();
    }
    open(): void {
        this.readyState = 'open';
        this.onopen?.();
    }
}

class FakePeerConnection {
    static instances: FakePeerConnection[] = [];
    readonly config: RTCConfiguration | undefined;
    signalingState = 'stable';
    connectionState = 'new';
    iceConnectionState = 'new';
    localDescription: RTCSessionDescriptionInit | null = null;
    remoteDescription: RTCSessionDescriptionInit | null = null;
    onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    oniceconnectionstatechange: (() => void) | null = null;
    onsignalingstatechange: (() => void) | null = null;
    ondatachannel: ((e: { channel: FakeDataChannel }) => void) | null = null;
    readonly createdDataChannels: FakeDataChannel[] = [];
    readonly addedCandidates: RTCIceCandidateInit[] = [];
    closed = false;

    constructor(config?: RTCConfiguration) {
        this.config = config;
        FakePeerConnection.instances.push(this);
    }

    createDataChannel(label: string): FakeDataChannel {
        const dc = new FakeDataChannel(label);
        this.createdDataChannels.push(dc);
        return dc;
    }

    async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'offer', sdp: 'local-offer-sdp' };
    }

    async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'answer', sdp: 'local-answer-sdp' };
    }

    async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
        this.localDescription = desc;
        this.setSignalingState(desc.type === 'offer' ? 'have-local-offer' : 'stable');
    }

    async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
        this.remoteDescription = desc;
        this.setSignalingState(desc.type === 'offer' ? 'have-remote-offer' : 'stable');
    }

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        this.addedCandidates.push(candidate);
    }

    private setSignalingState(state: string): void {
        this.signalingState = state;
        this.onsignalingstatechange?.();
    }

    close(): void {
        this.closed = true;
        this.connectionState = 'closed';
    }
}

function fakeCandidate(sdp: string): RTCIceCandidate {
    const init: RTCIceCandidateInit = { candidate: sdp, sdpMid: '0' };
    return { ...init, toJSON: () => init } as unknown as RTCIceCandidate;
}

// ── Fake signaling bus ──────────────────────────────────────────────────────

function createFakeSignaling() {
    const handlers = new Set<(signal: WebRTCSignalMessage) => void>();
    const sent: WebRTCSignalMessage[] = [];
    const signaling: ISignaling = {
        send: (signal) => {
            sent.push(signal);
        },
        onSignal: (handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        dispose: () => {},
    };
    return { signaling, sent, emit: (signal: WebRTCSignalMessage) => {
        for (const handler of [...handlers]) handler(signal);
    } };
}

// ── Microtask flushing (works under fake timers) ────────────────────────────

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const flush = async (times = 25) => {
    for (let i = 0; i < times; i++) await tick();
};

const lastPc = () => {
    const pc = FakePeerConnection.instances.at(-1);
    if (!pc) throw new Error('no FakePeerConnection constructed');
    return pc;
};

beforeEach(() => {
    FakePeerConnection.instances = [];
    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePeerConnection;
});

describe('WebRtcRpcTransport handshake', () => {
    it('answerer processes an offer injected via receiveSignal and answers it', async () => {
        const { signaling, sent } = createFakeSignaling();
        const transport = new WebRtcRpcTransport('answerer', signaling);

        const connectPromise = transport.connect();
        const pc = lastPc();

        // The offer that triggered the receiver to build this transport is
        // injected directly — it was dispatched before this transport existed.
        transport.receiveSignal({ type: 'webrtc-offer', sdp: 'offer-1' });
        await flush();

        expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'offer-1' });
        expect(sent).toContainEqual({ type: 'webrtc-answer', sdp: 'local-answer-sdp' });

        const dc = new FakeDataChannel('wod-wiki-rpc');
        pc.ondatachannel?.({ channel: dc });
        dc.open();
        await connectPromise;
        expect(transport.connected).toBe(true);
    });

    it('offerer retransmits the offer on an interval until the answer arrives', async () => {
        jest.useFakeTimers();
        try {
            const { signaling, sent } = createFakeSignaling();
            const transport = new WebRtcRpcTransport('offerer', signaling, { offerRetryIntervalMs: 1000 });

            const connectPromise = transport.connect();
            const pc = lastPc();
            await flush();

            const offers = () => sent.filter((m) => m.type === 'webrtc-offer');
            expect(offers()).toHaveLength(1);

            jest.advanceTimersByTime(1000);
            await flush();
            expect(offers()).toHaveLength(2);

            jest.advanceTimersByTime(1000);
            await flush();
            expect(offers()).toHaveLength(3);

            // Answer arrives → retransmit stops, handshake completes.
            transport.receiveSignal({ type: 'webrtc-answer', sdp: 'answer-1' });
            await flush();
            expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-1' });

            const countAfterAnswer = offers().length;
            jest.advanceTimersByTime(10_000);
            await flush();
            expect(offers()).toHaveLength(countAfterAnswer);

            pc.createdDataChannels[0]!.open();
            await connectPromise;
        } finally {
            jest.useRealTimers();
        }
    });

    it('offerer stops retransmitting once connect resolves and on dispose', async () => {
        jest.useFakeTimers();
        try {
            const { signaling, sent } = createFakeSignaling();
            const transport = new WebRtcRpcTransport('offerer', signaling, { offerRetryIntervalMs: 1000 });
            const connectPromise = transport.connect();
            const pc = lastPc();
            await flush();

            transport.receiveSignal({ type: 'webrtc-answer', sdp: 'answer-1' });
            await flush();
            pc.createdDataChannels[0]!.open();
            await connectPromise;

            const offers = () => sent.filter((m) => m.type === 'webrtc-offer');
            const settled = offers().length;
            jest.advanceTimersByTime(60_000);
            await flush();
            expect(offers()).toHaveLength(settled);

            transport.dispose();
            jest.advanceTimersByTime(60_000);
            await flush();
            expect(offers()).toHaveLength(settled);
        } finally {
            jest.useRealTimers();
        }
    });

    it('answerer ignores a duplicate offer with the same SDP but processes a changed one', async () => {
        const { signaling, sent } = createFakeSignaling();
        const transport = new WebRtcRpcTransport('answerer', signaling);
        void transport.connect();
        const pc = lastPc();

        transport.receiveSignal({ type: 'webrtc-offer', sdp: 'offer-1' });
        await flush();
        transport.receiveSignal({ type: 'webrtc-offer', sdp: 'offer-1' });
        await flush();

        const answers = () => sent.filter((m) => m.type === 'webrtc-answer');
        expect(answers()).toHaveLength(1);

        transport.receiveSignal({ type: 'webrtc-offer', sdp: 'offer-2' });
        await flush();
        expect(answers()).toHaveLength(2);
        expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'offer-2' });
    });

    it('offerer ignores a duplicate answer once the handshake is stable', async () => {
        const { signaling } = createFakeSignaling();
        const transport = new WebRtcRpcTransport('offerer', signaling);
        void transport.connect();
        const pc = lastPc();
        await flush();

        transport.receiveSignal({ type: 'webrtc-answer', sdp: 'answer-1' });
        await flush();
        expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-1' });

        // Stray duplicate answer from a retried offer must not throw.
        transport.receiveSignal({ type: 'webrtc-answer', sdp: 'answer-1' });
        await flush();
        expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-1' });
    });

    it('offerer resends the offer immediately when the receiver announces cast-ready', async () => {
        const { signaling, sent } = createFakeSignaling();
        const transport = new WebRtcRpcTransport('offerer', signaling, { offerRetryIntervalMs: 60_000 });
        void transport.connect();
        await flush();

        const offers = () => sent.filter((m) => m.type === 'webrtc-offer');
        expect(offers()).toHaveLength(1);

        transport.receiveSignal({ type: 'cast-ready' });
        await flush();
        expect(offers()).toHaveLength(2);
    });

    it('connect timeout reports the gathered ICE candidate count', async () => {
        jest.useFakeTimers();
        try {
            const { signaling } = createFakeSignaling();
            const transport = new WebRtcRpcTransport('offerer', signaling, { offerRetryIntervalMs: 60_000 });
            const connectPromise = transport.connect();
            const pc = lastPc();
            await flush();

            pc.onicecandidate?.({ candidate: fakeCandidate('candidate-1') });
            pc.onicecandidate?.({ candidate: fakeCandidate('candidate-2') });
            pc.onicecandidate?.({ candidate: null });

            jest.advanceTimersByTime(15_000);
            await expect(connectPromise).rejects.toThrow(/localCandidates=2/);
        } finally {
            jest.useRealTimers();
        }
    });

    it('passes ICE server config through to the peer connection', () => {
        const { signaling } = createFakeSignaling();
        const transport = new WebRtcRpcTransport('offerer', signaling);
        void transport;
        expect(lastPc().config?.iceServers?.[0]?.urls).toBe('stun:stun.l.google.com:19302');
    });
});
