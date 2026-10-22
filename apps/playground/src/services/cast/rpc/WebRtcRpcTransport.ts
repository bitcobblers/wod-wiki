/**
 * WebRtcRpcTransport — Typed RPC transport over WebRTC DataChannel.
 *
 * Replaces the untyped WebRTCTransport with a strongly-typed message protocol.
 * Reuses the existing ISignaling adapters (SenderCastSignaling, ReceiverCastSignaling)
 * for SDP/ICE exchange via the Cast SDK custom namespace.
 *
 * Usage — Sender (offerer):
 *   const transport = new WebRtcRpcTransport('offerer', signaling);
 *   await transport.connect();
 *   transport.send({ type: 'rpc-stack-update', ... });
 *
 * Usage — Receiver (answerer):
 *   const transport = new WebRtcRpcTransport('answerer', signaling);
 *   await transport.connect();
 *   transport.onMessage(msg => { ... });
 */

import type { WebRTCSignalMessage } from '@/types/cast/messages';
import type { IRpcTransport, RpcUnsubscribe } from './IRpcTransport';
import type { RpcMessage } from './RpcMessages';
import { CAST_ICE_SERVERS } from '../config';

// ── Signaling interface (same as WebRTCTransport) ───────────────────────────

export interface ISignaling {
    send(signal: WebRTCSignalMessage): void;
    onSignal(handler: (signal: WebRTCSignalMessage) => void): () => void;
    dispose(): void;
}

// ── Transport options ───────────────────────────────────────────────────────

export interface WebRtcRpcTransportOptions {
    /**
     * Interval (ms) between offer retransmits while the offerer waits for an
     * answer. The receiver app can take seconds to boot on a cold Chromecast,
     * and the first offer is fire-and-forget over the Cast message bus —
     * retransmission is what lets a slow receiver answer a later copy.
     * Default 1000 ms.
     */
    offerRetryIntervalMs?: number;
}

/** DOM timer handle for the offer-retransmit interval. */
export type OfferRetryTimer = number;

// ── Transport ───────────────────────────────────────────────────────────────

export class WebRtcRpcTransport implements IRpcTransport {
    private pc: RTCPeerConnection;
    private dc: RTCDataChannel | null = null;
    private signalUnsub: (() => void) | null = null;
    private disposed = false;

    private messageHandlers = new Set<(message: RpcMessage) => void>();
    private connectedHandlers = new Set<() => void>();
    private disconnectedHandlers = new Set<() => void>();

    // Queuing for signals to ensure sequential processing
    private signalQueue: Promise<void> = Promise.resolve();
    private pendingIceCandidates: RTCIceCandidateInit[] = [];

    // Offer retransmission (offerer only): null while not retrying.
    private offerRetryTimer: OfferRetryTimer | null = null;
    private readonly offerRetryIntervalMs: number;

    // ICE diagnostics for the connect-timeout error message.
    private localCandidateCount = 0;
    private gatheringComplete = false;

    constructor(
        private readonly role: 'offerer' | 'answerer',
        private readonly signaling: ISignaling,
        options: WebRtcRpcTransportOptions = {},
    ) {
        console.log(`[WebRtcRpcTransport:${role}] Initializing transport`);
        this.offerRetryIntervalMs = options.offerRetryIntervalMs ?? 1000;

        this.pc = new RTCPeerConnection({ iceServers: CAST_ICE_SERVERS });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.localCandidateCount++;
                console.log(`[WebRtcRpcTransport:${role}] ICE candidate (local):`, event.candidate.candidate.substring(0, 60) + '...');
                this.signaling.send({
                    type: 'webrtc-ice',
                    candidate: event.candidate.toJSON(),
                });
            } else {
                this.gatheringComplete = true;
                console.log(`[WebRtcRpcTransport:${role}] ICE gathering complete (${this.localCandidateCount} candidates)`);
            }
        };

        this.pc.onconnectionstatechange = () => {
            const state = this.pc.connectionState;
            console.log(`[WebRtcRpcTransport:${role}] Connection state: ${state}`);
            if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                this.notifyDisconnected();
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            console.log(`[WebRtcRpcTransport:${role}] ICE connection state: ${this.pc.iceConnectionState}`);
        };

        this.pc.onsignalingstatechange = () => {
            console.log(`[WebRtcRpcTransport:${role}] Signaling state: ${this.pc.signalingState}`);
        };

        // Wire up incoming signals. We queue them to ensure sequential async processing.
        this.signalUnsub = this.signaling.onSignal((signal) => this.receiveSignal(signal));
    }

    /**
     * Inject a signal into the sequential processing queue.
     *
     * Also the entry point for signals that were dispatched *before* this
     * transport subscribed to the signaling bus — the receiver rebuilds its
     * transport when an offer arrives, and the offer that triggered the
     * rebuild would otherwise never reach the new transport (the mobile
     * "stays on connecting, then disconnected" failure).
     */
    receiveSignal(signal: WebRTCSignalMessage): void {
        console.log(`[WebRtcRpcTransport:${this.role}] Incoming signal: ${signal.type}`);
        this.signalQueue = this.signalQueue.then(() => this.handleSignal(signal));
    }

    // ── Offer retransmission (offerer only) ────────────────────────────────

    /**
     * (Re)send the local offer while we are still waiting for an answer.
     * Returns false when there is nothing left to retry (answer received,
     * disposed, or no local description yet) so the caller stops the timer.
     */
    private retransmitOffer(): boolean {
        if (this.disposed || this.pc.signalingState !== 'have-local-offer' || !this.pc.localDescription) {
            return false;
        }
        console.log(`[WebRtcRpcTransport:${this.role}] Retransmitting offer`);
        this.signaling.send({
            type: 'webrtc-offer',
            sdp: this.pc.localDescription.sdp,
        });
        return true;
    }

    private startOfferRetry(): void {
        if (this.role !== 'offerer' || this.offerRetryTimer !== null) return;
        this.offerRetryTimer = window.setInterval(() => {
            if (!this.retransmitOffer()) this.stopOfferRetry();
        }, this.offerRetryIntervalMs) as unknown as OfferRetryTimer;
    }

    private stopOfferRetry(): void {
        if (this.offerRetryTimer !== null) {
            window.clearInterval(this.offerRetryTimer);
            this.offerRetryTimer = null;
        }
    }

    // ── IRpcTransport implementation ────────────────────────────────────────

    get connected(): boolean {
        return this.dc?.readyState === 'open';
    }

    /**
     * Real-network transport — the chromecast's wall clock drifts relative
     * to the browser. Clock sync measures the offset and feeds it to
     * `ChromecastProxyRuntime` so elapsed-time display matches the sender.
     */
    get needsClockSync(): boolean {
        return true;
    }

    send(message: RpcMessage): void {
        if (!this.dc || this.dc.readyState !== 'open') {
            console.warn('[WebRtcRpcTransport] DataChannel not open — dropping message');
            return;
        }
        this.dc.send(JSON.stringify(message));
    }

    onMessage(handler: (message: RpcMessage) => void): RpcUnsubscribe {
        this.messageHandlers.add(handler);
        return () => this.messageHandlers.delete(handler);
    }

    onConnected(handler: () => void): RpcUnsubscribe {
        this.connectedHandlers.add(handler);
        return () => this.connectedHandlers.delete(handler);
    }

    onDisconnected(handler: () => void): RpcUnsubscribe {
        this.disconnectedHandlers.add(handler);
        return () => this.disconnectedHandlers.delete(handler);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.stopOfferRetry();
        this.signalUnsub?.();
        this.signalUnsub = null;

        // Snapshot and clear handlers BEFORE notifying so that re-entrant
        // calls inside the notification (e.g. cleanupCast → transport.dispose())
        // find an already-empty handler set and do nothing additional.
        const wasConnected = this.dc?.readyState === 'open';
        const disconnectedSnapshot = [...this.disconnectedHandlers];

        this.messageHandlers.clear();
        this.connectedHandlers.clear();
        this.disconnectedHandlers.clear();

        this.dc?.close();
        this.pc.close();
        this.signaling.dispose();

        // Notify AFTER clearing so the listeners don’t see a half-torn-down
        // transport in their handler sets, and re-entrant dispose() calls are
        // no-ops.  Only fire if the DataChannel was actually open — avoids
        // spurious disconnect events for transports that never connected.
        if (wasConnected) {
            for (const handler of disconnectedSnapshot) handler();
        }
    }

    // ── Connection lifecycle ────────────────────────────────────────────────

    /**
     * Establish the peer connection.
     * Resolves when the RTCDataChannel is open and ready for messages.
     */
    connect(timeoutMs = 15_000): Promise<void> {
        console.log(`[WebRtcRpcTransport:${this.role}] connect() starting, timeout=${timeoutMs}ms`);
        if (this.connected) {
            console.log(`[WebRtcRpcTransport:${this.role}] Already connected — short-circuiting`);
            return Promise.resolve();
        }
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const t0 = Date.now();
        const timer = setTimeout(() => {
            this.stopOfferRetry();
            const diag = `pcState=${this.pc.connectionState}, iceState=${this.pc.iceConnectionState}, sigState=${this.pc.signalingState}, dcState=${this.dc?.readyState ?? 'null'}, localCandidates=${this.localCandidateCount}${this.gatheringComplete ? '' : ' (still gathering)'}`;
            console.error(`[WebRtcRpcTransport:${this.role}] TIMEOUT after ${timeoutMs}ms — ${diag}`);
            reject(new Error(`WebRTC connect timed out after ${timeoutMs}ms — ${diag}`));
        }, timeoutMs);

        const onOpen = () => {
            clearTimeout(timer);
            this.stopOfferRetry();
            console.log(`[WebRtcRpcTransport:${this.role}] DataChannel OPEN in ${Date.now() - t0}ms`);
            this.notifyConnected();
            resolve();
        };

        if (this.role === 'offerer') {
            console.log(`[WebRtcRpcTransport:offerer] Creating DataChannel…`);
            this.dc = this.pc.createDataChannel('wod-wiki-rpc', { ordered: true });
            this.wireDataChannel(this.dc, onOpen);

            console.log(`[WebRtcRpcTransport:offerer] Creating offer…`);
            this.pc.createOffer()
                .then(offer => {
                    console.log(`[WebRtcRpcTransport:offerer] Offer created, SDP length=${offer.sdp?.length}`);
                    return this.pc.setLocalDescription(offer);
                })
                .then(() => {
                    console.log(`[WebRtcRpcTransport:offerer] Local description set — sending offer via signaling`);
                    this.retransmitOffer();
                    // The receiver app may still be booting; keep offering
                    // until the answer arrives or connect() times out.
                    this.startOfferRetry();
                    console.log(`[WebRtcRpcTransport:offerer] Offer sent — waiting for answer…`);
                })
                .catch(err => {
                    clearTimeout(timer);
                    console.error(`[WebRtcRpcTransport:offerer] Failed to create/set offer`, err);
                    reject(err);
                });
        } else {
            // Answerer waits for the remote DataChannel to arrive.
            console.log(`[WebRtcRpcTransport:answerer] Waiting for ondatachannel…`);
            this.pc.ondatachannel = (event) => {
                console.log(`[WebRtcRpcTransport:answerer] Remote DataChannel received: ${event.channel.label}`);
                this.dc = event.channel;
                this.wireDataChannel(this.dc, onOpen);
            };
        }
        return promise;
    }

    // ── Internals ───────────────────────────────────────────────────────────

    private wireDataChannel(dc: RTCDataChannel, onOpen: () => void): void {
        dc.onopen = () => onOpen();

        // Guard against double-notification: dispose() already notifies before
        // clearing handlers, so if we are disposed the handlers set is empty and
        // iterating it is a no-op — but guard explicitly for clarity.
        dc.onclose = () => {
            if (!this.disposed) this.notifyDisconnected();
        };

        dc.onerror = (event) => {
            console.error('[WebRtcRpcTransport] DataChannel error', event);
        };

        dc.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as RpcMessage;
                for (const handler of this.messageHandlers) {
                    handler(data);
                }
            } catch (err) {
                console.error('[WebRtcRpcTransport] Failed to parse RPC message', err);
            }
        };
    }

    private async handleSignal(signal: WebRTCSignalMessage): Promise<void> {
        try {
            switch (signal.type) {
                case 'webrtc-offer': {
                    if (this.role !== 'answerer') {
                        console.warn(`[WebRtcRpcTransport:${this.role}] Ignoring offer (not an answerer)`);
                        return;
                    }
                    // A duplicate offer (same SDP we already processed — e.g. the
                    // copy the sender keeps retransmitting while booting) must not
                    // trigger a second setRemoteDescription/createAnswer cycle.
                    if (this.pc.remoteDescription?.sdp === signal.sdp) {
                        console.log(`[WebRtcRpcTransport:answerer] Ignoring duplicate offer (already processed)`);
                        return;
                    }
                    console.log(`[WebRtcRpcTransport:answerer] Received offer, length=${signal.sdp.length}`);
                    await this.pc.setRemoteDescription({
                        type: 'offer',
                        sdp: signal.sdp,
                    });
                    console.log(`[WebRtcRpcTransport:answerer] Remote description set — creating answer`);
                    const answer = await this.pc.createAnswer();
                    console.log(`[WebRtcRpcTransport:answerer] Answer created, length=${answer.sdp?.length}`);
                    await this.pc.setLocalDescription(answer);
                    console.log(`[WebRtcRpcTransport:answerer] Local description set — sending answer via signaling`);
                    this.signaling.send({
                        type: 'webrtc-answer',
                        sdp: this.pc.localDescription!.sdp,
                    });
                    
                    // Process any ICE candidates that arrived before the offer
                    await this.processPendingIceCandidates();
                    break;
                }
                case 'webrtc-answer': {
                    if (this.role !== 'offerer') {
                        console.warn(`[WebRtcRpcTransport:${this.role}] Ignoring answer (not an offerer)`);
                        return;
                    }
                    // Once stable, the answer is already applied — further copies
                    // (retries crossing on the wire) are ignored.
                    if (this.pc.signalingState !== 'have-local-offer') {
                        console.log(`[WebRtcRpcTransport:offerer] Ignoring duplicate answer (already applied)`);
                        return;
                    }
                    console.log(`[WebRtcRpcTransport:offerer] Received answer, length=${signal.sdp.length}`);
                    await this.pc.setRemoteDescription({
                        type: 'answer',
                        sdp: signal.sdp,
                    });
                    console.log(`[WebRtcRpcTransport:offerer] Remote description set — processing pending candidates…`);
                    
                    // Process any ICE candidates that arrived before the answer
                    await this.processPendingIceCandidates();
                    break;
                }
                case 'webrtc-ice': {
                    const candidate = signal.candidate;
                    if (!this.pc.remoteDescription) {
                        console.log(`[WebRtcRpcTransport:${this.role}] Buffering candidate until remote description is set`);
                        this.pendingIceCandidates.push(candidate);
                    } else {
                        console.log(`[WebRtcRpcTransport:${this.role}] Adding remote ICE candidate`);
                        await this.pc.addIceCandidate(candidate);
                    }
                    break;
                }
                case 'cast-ready': {
                    // The receiver app finished booting. If we are still holding an
                    // unanswered offer, retransmit it now instead of waiting for the
                    // next retry tick.
                    if (this.role === 'offerer') this.retransmitOffer();
                    break;
                }
            }
        } catch (err) {
            console.error(`[WebRtcRpcTransport:${this.role}] Signal handling error`, err);
        }
    }

    private async processPendingIceCandidates(): Promise<void> {
        if (this.pendingIceCandidates.length === 0) return;
        console.log(`[WebRtcRpcTransport:${this.role}] Processing ${this.pendingIceCandidates.length} buffered ICE candidates`);
        const candidates = [...this.pendingIceCandidates];
        this.pendingIceCandidates = [];
        
        for (const candidate of candidates) {
            try {
                await this.pc.addIceCandidate(candidate);
                console.log(`[WebRtcRpcTransport:${this.role}] Buffered ICE candidate added OK`);
            } catch (err) {
                console.error(`[WebRtcRpcTransport:${this.role}] Failed to add buffered ICE candidate`, err);
            }
        }
    }

    private notifyConnected(): void {
        for (const handler of this.connectedHandlers) handler();
    }

    private notifyDisconnected(): void {
        for (const handler of this.disconnectedHandlers) handler();
    }
}
