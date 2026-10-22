import { RpcMessage } from './RpcMessages';

/**
 * Unsubscribe function returned by event registration methods.
 */
export type RpcUnsubscribe = () => void;

/**
 * Transport-agnostic bidirectional RPC channel.
 *
 * Implementations handle the physical transport (WebRTC DataChannel, WebSocket, etc.)
 * while this interface provides typed message sending/receiving.
 */
export interface IRpcTransport {
    /** Send a typed RPC message to the remote peer. */
    send(message: RpcMessage): void;

    /**
     * Whether the underlying transport is currently connected. Used by
     * the cast bridges and the inline `RuntimeTimerPanel` to gate
     * "is the cast alive?" checks. A `true` here means the transport
     * will accept a `send()` without throwing.
     */
    readonly connected: boolean;

    /**
     * Begin the connection lifecycle if not already connected. The WebRTC
     * implementation runs an SDP/ICE handshake; the local BroadcastChannel
     * implementation has no setup work to do (the ports are already paired
     * by the parent) and resolves immediately.
     *
     * Idempotent — if `connected` is already `true`, resolves without work.
     */
    connect(): Promise<void>;
    onMessage(handler: (message: RpcMessage) => void): RpcUnsubscribe;

    /** Register a handler called when the transport connects. */
    onConnected(handler: () => void): RpcUnsubscribe;

    /** Register a handler called when the transport disconnects. */
    onDisconnected(handler: () => void): RpcUnsubscribe;

    /** Tear down the transport, closing channels and releasing resources. */
    dispose(): void;

    /**
     * Whether clock synchronization between sender and receiver is beneficial
     * for this transport.
     *
     * - `false` for transports that share a clock (same-machine IPC): the
     *   offset is ~0ms and running a
     *   sync handshake would just add startup latency.
     * - `true` for transports that traverse a real network and may have
     *   measurable clock skew (e.g. `WebRtcRpcTransport` over Chromecast):
     *   the receiver needs the offset to align elapsed-time display.
     *
     * Session managers consult this flag to decide whether to instantiate
     * `ClockSyncService` against the transport.
     */
    readonly needsClockSync: boolean;
}
