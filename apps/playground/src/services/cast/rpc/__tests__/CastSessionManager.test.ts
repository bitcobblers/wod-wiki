import { describe, it, expect, beforeEach } from 'bun:test';
import type { IEvent } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeEventProvider } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeSubscription } from '@bitcobblers/wod-wiki-engine';
import type { IRpcTransport, RpcUnsubscribe } from '../IRpcTransport';
import { RpcMessage } from '../RpcMessages';
import type { ClockSyncService } from '../ClockSync';
import {
    CastSessionManager,
    type CastSessionHandle,
    type CastSessionManagerDeps,
    type SubscriptionRegistry,
} from '../CastSessionManager';

class MockTransport implements IRpcTransport {
    connected = false;
    _needsClockSync = false;
    sent: RpcMessage[] = [];
    connectCalls = 0;
    disposeCalls = 0;

    private readonly connectedHandlers = new Set<() => void>();
    private readonly disconnectedHandlers = new Set<() => void>();
    private readonly messageHandlers = new Set<(message: RpcMessage) => void>();

    constructor(needsClockSync: boolean = false) {
        this._needsClockSync = needsClockSync;
    }

    get needsClockSync(): boolean {
        return this._needsClockSync;
    }

    send(message: RpcMessage): void {
        this.sent.push(message);
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

    async connect(): Promise<void> {
        this.connectCalls++;
        this.connected = true;
        this.connectedHandlers.forEach(h => h());
    }

    dispose(): void {
        this.disposeCalls++;
        this.connected = false;
    }

    disconnect(): void {
        this.connected = false;
        this.disconnectedHandlers.forEach(h => h());
    }
}

class MockEventProvider implements IRuntimeEventProvider {
    disposeCalls = 0;
    dispatch(_event: IEvent): void {}
    onEvent(): RpcUnsubscribe { return () => {}; }
    dispose(): void {
        this.disposeCalls++;
    }
}

class MockSubscription implements IRuntimeSubscription {
    id: string;
    disposeCalls = 0;
    constructor(id: string = 'chromecast') {
        this.id = id;
    }
    onStackSnapshot(): void {}
    onOutput(): void {}
    dispose(): void {
        this.disposeCalls++;
    }
}

class MockClockSync {
    syncCalls = 0;
    disposeCalls = 0;
    async sync(): Promise<void> { this.syncCalls++; }
    dispose(): void { this.disposeCalls++; }
}

class CountingRegistry implements SubscriptionRegistry {
    added: IRuntimeSubscription[] = [];
    removed: string[] = [];
    add(s: IRuntimeSubscription): void { this.added.push(s); }
    remove(id: string): void { this.removed.push(id); }
}

function makeDeps(overrides: Partial<CastSessionManagerDeps> = {}): {
    deps: CastSessionManagerDeps;
    eventProvider: MockEventProvider;
    clockSync: MockClockSync;
    createSubscription: (transport: MockTransport, id: string) => MockSubscription;
} {
    const eventProvider = new MockEventProvider();
    const clockSync = new MockClockSync();
    let createSubscription: (transport: MockTransport, id: string) => MockSubscription =
        (_t, id) => new MockSubscription(id);
    return {
        deps: {
            createSubscription: ((transport, id) => createSubscription(transport, id)) as unknown as CastSessionManagerDeps['createSubscription'],
            createEventProvider: ((_t) => eventProvider) as unknown as CastSessionManagerDeps['createEventProvider'],
            createClockSync: ((_t) => clockSync as unknown as ClockSyncService),
            ...overrides,
        },
        eventProvider,
        clockSync,
        get createSubscription() { return createSubscription; },
    } as unknown as { deps: CastSessionManagerDeps; eventProvider: MockEventProvider; clockSync: MockClockSync; get createSubscription(): (t: MockTransport, id: string) => MockSubscription };
}

describe('CastSessionManager', () => {
    let transport: MockTransport;
    let registry: CountingRegistry;
    let mgr: CastSessionManager;
    let deps: CastSessionManagerDeps;
    let eventProvider: MockEventProvider;
    let clockSync: MockClockSync;

    beforeEach(() => {
        transport = new MockTransport();
        registry = new CountingRegistry();
        const built = makeDeps();
        deps = built.deps;
        eventProvider = built.eventProvider;
        clockSync = built.clockSync;
        mgr = new CastSessionManager(deps);
    });

    it('connects a session: builds subscription, event provider, and registers with the registry', () => {
        expect(mgr.isConnected).toBe(false);

        const handle: CastSessionHandle = mgr.connect(transport, registry);

        expect(mgr.isConnected).toBe(true);
        expect(handle.transport).toBe(transport);
        expect(handle.eventProvider).toBe(eventProvider);
        expect(handle.subscription.id).toBe('chromecast');
        expect(registry.added.length).toBe(1);
        // Local transport — no clock sync.
        expect(clockSync.syncCalls).toBe(0);
    });

    it('does NOT run clock sync when transport.needsClockSync is false', () => {
        transport = new MockTransport(false);
        mgr.connect(transport, registry);
        expect(clockSync.syncCalls).toBe(0);
        expect(clockSync.disposeCalls).toBe(0);
    });

    it('runs clock sync when transport.needsClockSync is true', async () => {
        transport = new MockTransport(true);
        mgr.connect(transport, registry);
        // Allow the .sync() promise to resolve.
        await new Promise<void>(r => setTimeout(r, 0));
        expect(clockSync.syncCalls).toBe(1);
    });

    it('dispose() removes the subscription, disposes provider + clock sync, and tears down the disconnect listener', async () => {
        transport = new MockTransport(true);
        mgr.connect(transport, registry);
        await new Promise<void>(r => setTimeout(r, 0));

        mgr.dispose();

        expect(registry.removed).toEqual(['chromecast']);
        expect(eventProvider.disposeCalls).toBe(1);
        expect(clockSync.disposeCalls).toBe(1);
        expect(mgr.isConnected).toBe(false);

        // The transport's disconnect listener was unsubscribed. Triggering
        // a disconnect now must not throw or re-dispose.
        transport.disconnect();
        expect(eventProvider.disposeCalls).toBe(1);
        expect(clockSync.disposeCalls).toBe(1);
    });

    it('dispose() is idempotent', () => {
        mgr.connect(transport, registry);
        mgr.dispose();
        expect(() => mgr.dispose()).not.toThrow();
        expect(eventProvider.disposeCalls).toBe(1);
    });

    it('transport disconnect cascades session teardown', () => {
        mgr.connect(transport, registry);
        expect(mgr.isConnected).toBe(true);

        transport.disconnect();

        expect(mgr.isConnected).toBe(false);
        expect(registry.removed).toEqual(['chromecast']);
        expect(eventProvider.disposeCalls).toBe(1);
    });

    it('connect() disposes any previous session first', async () => {
        transport = new MockTransport(true);
        mgr.connect(transport, registry);
        await new Promise<void>(r => setTimeout(r, 0));
        expect(eventProvider.disposeCalls).toBe(0);

        const second = new MockTransport(false);
        mgr.connect(second, registry);

        // First session's resources were released.
        expect(eventProvider.disposeCalls).toBe(1);
        expect(clockSync.disposeCalls).toBe(1);
        expect(registry.removed).toEqual(['chromecast']);
        // Second session is active and registered.
        expect(mgr.isConnected).toBe(true);
        expect(registry.added.length).toBe(2);
    });

    it('handle.dispose() is an alias for the manager dispose()', () => {
        const handle = mgr.connect(transport, registry);
        handle.dispose();
        expect(mgr.isConnected).toBe(false);
        expect(registry.removed).toEqual(['chromecast']);
    });

    it('works without a subscription registry (test-only configuration)', () => {
        const handle = mgr.connect(transport, null);
        expect(handle.subscription.id).toBe('chromecast');
        expect(mgr.isConnected).toBe(true);
        mgr.dispose();
        expect(mgr.isConnected).toBe(false);
    });

    it('uses the custom subscription id when provided', () => {
        const handle = mgr.connect(transport, registry, { subscriptionId: 'test-cast' });
        expect(handle.subscription.id).toBe('test-cast');
        expect(registry.added[0].id).toBe('test-cast');

        mgr.dispose();
        expect(registry.removed).toEqual(['test-cast']);
    });

    it('does not block connect() on the clock sync handshake completing', () => {
        // Use a transport that needs clock sync. The connect() call must
        // return synchronously even though sync() is a promise.
        transport = new MockTransport(true);
        const t0 = Date.now();
        mgr.connect(transport, registry);
        const elapsed = Date.now() - t0;
        // Generous bound — the test passes on any platform that resolves
        // the microtask in <50ms.
        expect(elapsed).toBeLessThan(50);
    });

    it('sendDisposeSignal() sends rpc-dispose when connected', () => {
        mgr.connect(transport, registry);
        transport.connected = true;
        mgr.sendDisposeSignal();
        expect(transport.sent.some(m => m.type === 'rpc-dispose')).toBe(true);
    });

    it('sendDisposeSignal() is a no-op when not connected', () => {
        mgr.connect(transport, registry);
        transport.connected = false;
        mgr.sendDisposeSignal();
        expect(transport.sent).toHaveLength(0);
    });

    it('dispose(true) sends rpc-dispose when transport is connected', () => {
        mgr.connect(transport, registry);
        transport.connected = true;
        mgr.dispose(true);
        expect(transport.sent.some(m => m.type === 'rpc-dispose')).toBe(true);
    });

    it('getActiveHandle() returns the active handle while connected and null when disposed', () => {
        expect(mgr.getActiveHandle()).toBeNull();
        const handle = mgr.connect(transport, registry);
        expect(mgr.getActiveHandle()).toBe(handle);
        mgr.dispose();
        expect(mgr.getActiveHandle()).toBeNull();
    });

    it('setSubscriptionRegistry() moves active subscription to new registry', () => {
        mgr.connect(transport, registry);
        expect(registry.added).toHaveLength(1);

        const nextRegistry = new CountingRegistry();
        mgr.setSubscriptionRegistry(nextRegistry);

        expect(registry.removed).toEqual(['chromecast']);
        expect(nextRegistry.added).toHaveLength(1);
    });
});
