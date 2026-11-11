import type { RpcMessage } from './RpcMessages';

/** Unsubscribe function returned by transport event registration. */
export type RpcUnsubscribe = () => void;

/**
 * FakeRpcTransport — in-memory RPC transport for tests. Generic in TMsg so
 * app-level wrappers can bind their exact wire union without structural drift.
 */
export class FakeRpcTransport<TMsg extends { type: string } = RpcMessage> {
    public readonly sent: TMsg[] = [];
    private readonly messageHandlers = new Set<(m: TMsg) => void>();
    private readonly connectedHandlers = new Set<() => void>();
    private readonly disconnectedHandlers = new Set<() => void>();
    private _connected = false;
    private _disposed = false;
    public peer: FakeRpcTransport<TMsg> | null = null;

    get connected(): boolean {
        return this._connected;
    }

    get needsClockSync(): boolean {
        return false;
    }

    /** All sent messages (append-only). */
    get messages(): readonly TMsg[] {
        return this.sent;
    }

    /** Sent messages filtered by RpcMessage discriminator. */
    filter<T extends TMsg['type']>(type: T): Extract<TMsg, { type: T }>[] {
        return this.sent.filter((m): m is Extract<TMsg, { type: T }> => m.type === type);
    }

    send(message: TMsg): void {
        if (this._disposed) {
            throw new Error('FakeRpcTransport: send after dispose');
        }
        this.sent.push(message);
        if (this.peer && this.peer._connected) {
            for (const h of [...this.peer.messageHandlers]) {
                h(message);
            }
        }
    }

    /** Inject a message as if it arrived from the remote peer. */
    receive(message: TMsg): void {
        if (this._disposed) {
            throw new Error('FakeRpcTransport: receive after dispose');
        }
        for (const h of [...this.messageHandlers]) {
            h(message);
        }
    }

    onMessage(handler: (m: TMsg) => void): RpcUnsubscribe {
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

        if (wasConnected) {
            for (const h of disconnectedSnapshot) {
                h();
            }
        }
    }
}

export function connectPair<TMsg extends { type: string } = RpcMessage>(
    a: FakeRpcTransport<TMsg>,
    b: FakeRpcTransport<TMsg>,
): void {
    a.peer = b;
    b.peer = a;
    void a.connect();
    void b.connect();
}
