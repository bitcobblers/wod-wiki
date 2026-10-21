import { IRpcTransport, RpcUnsubscribe } from '@/services/cast/rpc/IRpcTransport';
import { RpcMessage } from '@/services/cast/rpc/RpcMessages';

/**
 * FakeRpcTransport — in-memory IRpcTransport for tests.
 * Two adapters on IRpcTransport make the seam real (WebRtcRpcTransport + this).
 */
export class FakeRpcTransport implements IRpcTransport {
    public readonly sent: RpcMessage[] = [];
    private readonly messageHandlers = new Set<(m: RpcMessage) => void>();
    private readonly connectedHandlers = new Set<() => void>();
    private readonly disconnectedHandlers = new Set<() => void>();
    private _connected = false;
    private _disposed = false;
    public peer: FakeRpcTransport | null = null;

    get connected(): boolean {
        return this._connected;
    }

    /**
     * In-memory test transport — no real network, no clock skew. Tests that
     * want to exercise clock-sync wiring set this on the specific instance;
     * the default mirrors a shared-clock transport, where sync would be a
     * no-op handshake.
     */
    get needsClockSync(): boolean {
        return false;
    }

    /** All sent messages (append-only). */
    get messages(): readonly RpcMessage[] {
        return this.sent;
    }

    /** Sent messages filtered by RpcMessage discriminator. */
    filter<T extends RpcMessage['type']>(type: T): Extract<RpcMessage, { type: T }>[] {
        return this.sent.filter((m): m is Extract<RpcMessage, { type: T }> => m.type === type);
    }

    send(message: RpcMessage): void {
        if (this._disposed) {
            throw new Error('FakeRpcTransport: send after dispose');
        }
        this.sent.push(message);
        // Deliver to peer if paired (synchronous)
        if (this.peer && this.peer._connected) {
            for (const h of [...this.peer.messageHandlers]) {
                h(message);
            }
        }
    }

    /** Inject a message as if it arrived from the remote peer. */
    receive(message: RpcMessage): void {
        if (this._disposed) {
            throw new Error('FakeRpcTransport: receive after dispose');
        }
        for (const h of [...this.messageHandlers]) {
            h(message);
        }
    }

    onMessage(handler: (m: RpcMessage) => void): RpcUnsubscribe {
        this.messageHandlers.add(handler);
        return () => {
            this.messageHandlers.delete(handler);
        };
    }

    onConnected(handler: () => void): RpcUnsubscribe {
        this.connectedHandlers.add(handler);
        return () => {
            this.connectedHandlers.delete(handler);
        };
    }

    onDisconnected(handler: () => void): RpcUnsubscribe {
        this.disconnectedHandlers.add(handler);
        return () => {
            this.disconnectedHandlers.delete(handler);
        };
    }

    /** Mark this transport as connected. Fires onConnected handlers. */
    async connect(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._connected = true;
        for (const h of [...this.connectedHandlers]) {
            h();
        }
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;

        const wasConnected = this._connected;
        const disconnectedSnapshot = [...this.disconnectedHandlers];

        this._connected = false;
        this.messageHandlers.clear();
        this.connectedHandlers.clear();
        this.disconnectedHandlers.clear();

        if (this.peer) {
            this.peer.peer = null;
        }
        this.peer = null;

        // Match WebRtcRpcTransport behavior: notify after clearing so that
        // re-entrant calls inside the notification find an already-empty set.
        if (wasConnected) {
            for (const h of disconnectedSnapshot) {
                h();
            }
        }
    }
}

/**
 * Connect two FakeRpcTransports so that send() on one delivers to the
 * other's onMessage() handlers, simulating a bidirectional RPC session.
 */
export function connectPair(a: FakeRpcTransport, b: FakeRpcTransport): void {
    a.peer = b;
    b.peer = a;
    a.connect();
    b.connect();
}
