import { describe, it, expect, beforeEach } from 'bun:test';
import { ChromecastBackend, type ChromecastBackendDeps } from '../ChromecastBackend';
import type { CastSdkState } from '../../ChromecastSdk';
import type { ISignaling } from '../../rpc/WebRtcRpcTransport';
import type { IRpcTransport } from '../../rpc/IRpcTransport';

// ── Controllable ChromecastSdk fake (injected via `deps`) ───────────────────
type Listener = (...args: unknown[]) => void;

interface SessionStub {
    addMessageListener: (namespace: string, listener: (ns: string, msg: string) => void) => void;
    removeMessageListener: (namespace: string, listener: (ns: string, msg: string) => void) => void;
    sendMessage: (namespace: string, message: unknown) => Promise<unknown>;
}

const sdk = {
    state: 'not-loaded' as CastSdkState,
    loadImpl: null as null | (() => Promise<void>),
    requestSessionImpl: null as null | (() => Promise<void>),
    session: {
        addMessageListener: () => {},
        removeMessageListener: () => {},
        sendMessage: async () => {},
    } as SessionStub | null,
    listeners: new Map<string, Set<Listener>>(),
    reset() {
        this.state = 'not-loaded';
        this.loadImpl = null;
        this.requestSessionImpl = null;
        this.session = {
            addMessageListener: () => {},
            removeMessageListener: () => {},
            sendMessage: async () => {},
        };
        this.listeners.clear();
    },
    emit(event: string, ...args: unknown[]) {
        this.listeners.get(event)?.forEach((l) => l(...args));
    },
    // ── ChromecastSdkLike surface ──
    getState(): CastSdkState {
        return this.state;
    },
    load(): Promise<void> {
        return this.loadImpl ? this.loadImpl() : Promise.reject(new Error('load not stubbed'));
    },
    requestSession(): Promise<void> {
        return this.requestSessionImpl
            ? this.requestSessionImpl()
            : Promise.reject(new Error('requestSession not stubbed'));
    },
    endSession() {},
    getSession(): SessionStub | null {
        return this.session;
    },
    on(event: string, listener: Listener) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(listener);
        return () => {
            this.listeners.get(event)?.delete(listener);
        };
    },
};

// ── Transport fake handed to the backend via `createTransport` ──────────────
class TransportStub {
    connectImpl: () => Promise<void> = async () => {};
    disposed = 0;
    connect() {
        return this.connectImpl();
    }
    dispose() {
        this.disposed += 1;
    }
    onDisconnected() {
        return () => {};
    }
}
let transport = new TransportStub();

// The signaling object is only ever handed to `createTransport`, which the
// stub replaces — no behavior needed from it in these tests.
const stubSignaling = {} as ISignaling;

function makeBackend(): ChromecastBackend {
    const deps: ChromecastBackendDeps = {
        sdk,
        createSignaling: () => stubSignaling,
        createTransport: () => transport as unknown as IRpcTransport,
        appId: 'TESTAPP01',
        hasCustomAppId: true,
    };
    return new ChromecastBackend(deps);
}

describe('ChromecastBackend failure recovery', () => {
    beforeEach(() => {
        sdk.reset();
        transport = new TransportStub();
    });

    it('returns to ready and allows retry when requestSession fails (session_error)', async () => {
        sdk.state = 'ready';
        sdk.loadImpl = async () => {
            sdk.state = 'ready';
        };
        sdk.requestSessionImpl = () => Promise.reject(new Error('Cast session request failed: session_error'));

        const backend = makeBackend();
        await expect(backend.startSession()).rejects.toThrow('session_error');
        expect(backend.state).toBe('ready');

        // The button must be usable again: a retry goes through the whole flow.
        sdk.requestSessionImpl = async () => {
            sdk.state = 'session-active';
        };
        await expect(backend.startSession()).resolves.toBeDefined();
        expect(backend.state).toBe('session-active');
        backend.dispose();
    });

    it('disposes the half-built transport and resets when the handshake fails', async () => {
        sdk.state = 'ready';
        sdk.loadImpl = async () => {
            sdk.state = 'ready';
        };
        sdk.requestSessionImpl = async () => {
            sdk.state = 'session-active';
        };
        transport.connectImpl = () => Promise.reject(new Error('TIMEOUT after 15000ms'));

        const backend = makeBackend();
        await expect(backend.startSession()).rejects.toThrow('TIMEOUT');
        expect(transport.disposed).toBe(1);
        expect(backend.state).toBe('ready');
        backend.dispose();
    });

    it('lets a CAF no-session recovery event reset the connecting state', async () => {
        sdk.state = 'ready';
        sdk.loadImpl = async () => {
            sdk.state = 'ready';
        };
        // Picker opened, launch never completes — startSession stays pending.
        sdk.requestSessionImpl = () => new Promise<void>(() => {});

        const backend = makeBackend();
        // startSession is intentionally left pending: the launch never
        // completes, which is the stuck-'connecting' scenario under test.
        const pending = backend.startSession();
        void pending.catch(() => {}); // may never settle; silence rejection noise
        expect(backend.state).toBe('connecting');

        // CAF emits NO_SESSION (SDK maps it to 'ready') when the launch fails.
        sdk.emit('state-changed', 'ready');
        expect(backend.state).toBe('ready');
        backend.dispose();
    });
});

describe('ChromecastBackend resumeSession (adopt surviving platform session)', () => {
    beforeEach(() => {
        sdk.reset();
        transport = new TransportStub();
    });

    it('adopts the live session without opening the picker', async () => {
        // Post-reload / post-navigation state: SDK already has a session and
        // requestSession is intentionally NOT stubbed — if resumeSession
        // touched the picker this would reject with 'requestSession not stubbed'.
        sdk.state = 'session-active';
        sdk.loadImpl = async () => {};
        const backend = makeBackend();

        await expect(backend.resumeSession()).resolves.toBeDefined();
        expect(backend.state).toBe('session-active');
        backend.dispose();
    });

    it('returns the existing transport on repeat adoption', async () => {
        sdk.state = 'session-active';
        sdk.loadImpl = async () => {};
        const backend = makeBackend();

        const first = await backend.resumeSession();
        const second = await backend.resumeSession();
        expect(second).toBe(first);
        backend.dispose();
    });

    it('throws when there is no platform session to resume', async () => {
        sdk.state = 'session-active';
        sdk.loadImpl = async () => {};
        sdk.session = null;
        const backend = makeBackend();

        await expect(backend.resumeSession()).rejects.toThrow('no Cast session to resume');
        backend.dispose();
    });

    it('disposes the half-built transport when the handshake fails', async () => {
        sdk.state = 'session-active';
        sdk.loadImpl = async () => {};
        transport.connectImpl = () => Promise.reject(new Error('TIMEOUT after 15000ms'));
        const backend = makeBackend();

        await expect(backend.resumeSession()).rejects.toThrow('TIMEOUT');
        expect(transport.disposed).toBe(1);
        backend.dispose();
    });
});
