import { describe, it, expect, beforeEach } from 'bun:test';
import type { IRpcTransport, RpcUnsubscribe } from '../IRpcTransport';
import { RpcMessage } from '../RpcMessages';
import {
    createReceiverSession,
    type ReceiverSessionDeps,
} from '../ReceiverSessionManager';
import type { ChromecastProxyRuntime } from '../ChromecastProxyRuntime';

class MockTransport implements IRpcTransport {
    connected = true;
    sent: RpcMessage[] = [];
    private messageHandlers = new Set<(m: RpcMessage) => void>();
    private disconnectedHandlers = new Set<() => void>();
    private connectedHandlers = new Set<() => void>();

    send(message: RpcMessage): void {
        this.sent.push(message);
    }

    onMessage(handler: (m: RpcMessage) => void): RpcUnsubscribe {
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

    get needsClockSync(): boolean { return false; }
    async connect(): Promise<void> {}
    dispose(): void {}

    /** Inject a message as if it came from the sender. */
    receive(msg: RpcMessage): void {
        for (const h of [...this.messageHandlers]) h(msg);
    }

    /** Trigger a transport disconnect. */
    disconnect(): void {
        for (const h of [...this.disconnectedHandlers]) h();
    }
}

type WorkbenchState = { mode: 'idle' | 'active' | 'review' | 'preview' };

class MockRuntime {
    disposeCalls = 0;
    private workbenchListeners = new Set<(state: WorkbenchState) => void>();

    /** Test hook — fire a workbench update to all listeners. */
    _emitWorkbench(state: WorkbenchState): void {
        for (const l of this.workbenchListeners) l(state);
    }

    subscribeToWorkbench(listener: (state: WorkbenchState) => void): () => void {
        this.workbenchListeners.add(listener);
        return () => this.workbenchListeners.delete(listener);
    }
    dispose(): void { this.disposeCalls++; }
}

function makeDeps(overrides: Partial<ReceiverSessionDeps> = {}): {
    deps: ReceiverSessionDeps;
    runtime: MockRuntime;
    playCalls: { name: string; volume: number }[];
    setEnabledCalls: boolean[];
} {
    const runtime = new MockRuntime();
    const playCalls: { name: string; volume: number }[] = [];
    const setEnabledCalls: boolean[] = [];
    return {
        deps: {
            createRuntime: () => runtime as unknown as ChromecastProxyRuntime,
            playAudio: (name, volume) => { playCalls.push({ name, volume }); },
            setAudioEnabled: (enabled) => { setEnabledCalls.push(enabled); },
            ...overrides,
        },
        runtime,
        playCalls,
        setEnabledCalls,
    };
}

describe('createReceiverSession', () => {
    let transport: MockTransport;
    let mgr: { deps: ReceiverSessionDeps; runtime: MockRuntime; playCalls: { name: string; volume: number }[]; setEnabledCalls: boolean[] };

    beforeEach(() => {
        transport = new MockTransport();
        mgr = makeDeps();
    });

    it('builds a runtime and exposes it on the handle', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        expect(handle.runtime).toBe(mgr.runtime as unknown as ChromecastProxyRuntime);
    });

    it('enables audio by default', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        expect(mgr.setEnabledCalls).toEqual([true]);
        handle.dispose();
    });

    it('skips enabling audio when options.audio = false', () => {
        const handle = createReceiverSession(transport, { audio: false }, mgr.deps);
        expect(mgr.setEnabledCalls).toEqual([]);
        handle.dispose();
    });

    it('routes rpc-audio messages to the audio service', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        transport.receive({ type: 'rpc-audio', name: 'beep', volume: 0.75 });
        expect(mgr.playCalls).toEqual([{ name: 'beep', volume: 0.75 }]);
        handle.dispose();
    });

    it('ignores non-audio messages', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        transport.receive({ type: 'rpc-stack-update', blocks: [] });
        expect(mgr.playCalls).toEqual([]);
        handle.dispose();
    });

    it('forwards transport disconnect to onDisconnected handlers', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        const calls: number[] = [];
        const unsub = handle.onDisconnected(() => { calls.push(1); });
        transport.disconnect();
        expect(calls).toEqual([1]);
        unsub();
    });

    it('supports multiple onDisconnected handlers', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        const a: number[] = [];
        const b: number[] = [];
        handle.onDisconnected(() => { a.push(1); });
        handle.onDisconnected(() => { b.push(1); });
        transport.disconnect();
        expect(a).toEqual([1]);
        expect(b).toEqual([1]);
        handle.dispose();
    });

    it('onDisconnected unsubscribe stops further callbacks', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        const calls: number[] = [];
        const unsub = handle.onDisconnected(() => { calls.push(1); });
        unsub();
        transport.disconnect();
        expect(calls).toEqual([]);
        handle.dispose();
    });

    it('onDisconnected on a disposed handle is a no-op', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        handle.dispose();
        let called = false;
        const unsub = handle.onDisconnected(() => { called = true; });
        expect(typeof unsub).toBe('function');
        // handler was never registered, so a disconnect doesn't fire it
        transport.disconnect();
        expect(called).toBe(false);
    });

    it('dispose() releases the runtime and stops processing messages', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        handle.dispose();
        expect(mgr.runtime.disposeCalls).toBe(1);

        // Audio routing should be torn down — no further calls.
        transport.receive({ type: 'rpc-audio', name: 'beep', volume: 0.5 });
        expect(mgr.playCalls).toEqual([]);
    });

    it('dispose() is idempotent', () => {
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        handle.dispose();
        expect(() => handle.dispose()).not.toThrow();
        expect(mgr.runtime.disposeCalls).toBe(1);
    });

    it('does not dispose the transport — caller owns it', () => {
        const _disposeSpy = transport.dispose = () => {};
        let called = false;
        transport.dispose = () => { called = true; };
        const handle = createReceiverSession(transport, undefined, mgr.deps);
        handle.dispose();
        expect(called).toBe(false);
    });

    describe('onWorkbenchUpdate', () => {
        it('forwards workbench updates to subscribers', () => {
            const handle = createReceiverSession(transport, undefined, mgr.deps);
            const received: WorkbenchState[] = [];
            handle.onWorkbenchUpdate((state) => { received.push(state); });
            mgr.runtime._emitWorkbench({ mode: 'active' });
            mgr.runtime._emitWorkbench({ mode: 'review' });
            expect(received).toEqual([{ mode: 'active' }, { mode: 'review' }]);
            handle.dispose();
        });

        it('supports multiple workbench subscribers', () => {
            const handle = createReceiverSession(transport, undefined, mgr.deps);
            const a: WorkbenchState[] = [];
            const b: WorkbenchState[] = [];
            handle.onWorkbenchUpdate((s) => a.push(s));
            handle.onWorkbenchUpdate((s) => b.push(s));
            mgr.runtime._emitWorkbench({ mode: 'preview' });
            expect(a).toEqual([{ mode: 'preview' }]);
            expect(b).toEqual([{ mode: 'preview' }]);
            handle.dispose();
        });

        it('workbench unsubscribe stops further callbacks', () => {
            const handle = createReceiverSession(transport, undefined, mgr.deps);
            const received: WorkbenchState[] = [];
            const unsub = handle.onWorkbenchUpdate((s) => received.push(s));
            unsub();
            mgr.runtime._emitWorkbench({ mode: 'active' });
            expect(received).toEqual([]);
            handle.dispose();
        });

        it('onWorkbenchUpdate on a disposed handle is a no-op', () => {
            const handle = createReceiverSession(transport, undefined, mgr.deps);
            handle.dispose();
            const unsub = handle.onWorkbenchUpdate(() => {});
            expect(typeof unsub).toBe('function');
            mgr.runtime._emitWorkbench({ mode: 'active' });
        });
    });
});
