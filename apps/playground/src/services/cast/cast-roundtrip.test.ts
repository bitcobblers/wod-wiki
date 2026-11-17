import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { ScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { JitCompiler } from '@bitcobblers/wod-wiki-engine';
import { RuntimeStack } from '@bitcobblers/wod-wiki-engine';
import { EventBus } from '@bitcobblers/wod-wiki-engine';
import { createMockClock } from '@bitcobblers/wod-wiki-engine';

import { ChromecastRuntimeSubscription } from '@/services/cast/rpc/ChromecastRuntimeSubscription';
import { routeRuntimeEventByName, type RuntimeEventHandles } from '@/services/cast/rpc/eventRouter';
import type { RpcEvent, RpcStackUpdate } from '@/services/cast/rpc/RpcMessages';
import type { IEvent } from '@bitcobblers/wod-wiki-engine';

import { FakeRpcTransport, connectPair } from '@/testing/transport';

import { GenericTimerStrategy } from '@bitcobblers/wod-wiki-engine';
import { GenericLoopStrategy } from '@bitcobblers/wod-wiki-engine';
import { ChildrenStrategy } from '@bitcobblers/wod-wiki-engine';
import { ReportOutputStrategy } from '@bitcobblers/wod-wiki-engine';
import { SoundStrategy } from '@bitcobblers/wod-wiki-engine';
import { EffortFallbackStrategy } from '@bitcobblers/wod-wiki-engine';

import { StartSessionAction } from '@bitcobblers/wod-wiki-engine';
import { NextEvent } from '@bitcobblers/wod-wiki-engine';
import { createParser } from '@bitcobblers/wod-wiki-engine';

// ── BrowserEventProxy — maps RpcEvent names to runtime.handle() calls ────────
// Headless analog of CastButtonRpc's switch statement. The decision logic
// (event name → handle) lives in the shared `routeRuntimeEvent` module; this
// class only adapts the test's `ScriptRuntime` to the `RuntimeEventHandles`
// shape — same pattern CastButtonRpc uses with the zustand store's handles.

class BrowserEventProxy {
    private readonly unsubMessage: () => void;
    private readonly handles: RuntimeEventHandles;

    constructor(
        private readonly transport: FakeRpcTransport,
        private readonly runtime: ScriptRuntime,
    ) {
        this.handles = {
            onNext: () => {
                this.runtime.handle(new NextEvent(undefined, this.runtime.nowProvider));
            },
            onStart: () => this.runtime.handle({ name: 'start', timestamp: new Date() } satisfies IEvent),
            onPause: () => this.runtime.handle({ name: 'pause', timestamp: new Date() } satisfies IEvent),
            onStop: () => this.runtime.handle({ name: 'stop', timestamp: new Date() } satisfies IEvent),
        };
        this.unsubMessage = transport.onMessage((msg) => {
            if (msg.type !== 'rpc-event') return;
            routeRuntimeEventByName(msg.name, this.handles);
        });
    }

    dispose(): void {
        this.unsubMessage();
    }
}

const SCRIPT = `
# Cast Roundtrip Test

## Timer
*:30 Run
`;

describe('cast roundtrip integration', () => {
    let runtime: ScriptRuntime;
    let subscription: ChromecastRuntimeSubscription;
    let browserFake: FakeRpcTransport;
    let receiverFake: FakeRpcTransport;
    let browserProxy: BrowserEventProxy;

    beforeEach(async () => {
        browserFake = new FakeRpcTransport();
        receiverFake = new FakeRpcTransport();
        connectPair(browserFake, receiverFake);

        const script = createParser().read(SCRIPT);

        const compiler = new JitCompiler();
        compiler.registerStrategy(new GenericTimerStrategy());
        compiler.registerStrategy(new GenericLoopStrategy());
        compiler.registerStrategy(new ChildrenStrategy());
        compiler.registerStrategy(new ReportOutputStrategy());
        compiler.registerStrategy(new SoundStrategy());
        compiler.registerStrategy(new EffortFallbackStrategy());

        const stack = new RuntimeStack();
        const clock = createMockClock(new Date('2024-01-01T12:00:00Z'));
        const eventBus = new EventBus();

        runtime = new ScriptRuntime(script, compiler, { stack, clock, eventBus });
        // Boot the session — pushes SessionRootBlock + WaitingToStart gate.
        runtime.do(new StartSessionAction());

        subscription = new ChromecastRuntimeSubscription(browserFake);
        runtime.subscribeToStack((snapshot) => subscription.onStackSnapshot(snapshot));
        // The proxy listens on the BROWSER-side transport — that's where
        // cast-bound RpcEvents arrive (paired send from receiverFake routes
        // to browserFake.messageHandlers). CastButtonRpc does the same in
        // production, but inside a Zustand store.
        browserProxy = new BrowserEventProxy(browserFake, runtime);

        // Flush the deferred initial snapshot that subscribeToStack schedules
        // via setTimeout(0) to dodge React render warnings in production.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    afterEach(() => {
        browserProxy.dispose();
        subscription.dispose();
        runtime.dispose();
        browserFake.dispose();
        receiverFake.dispose();
    });

    it('runtime stack event → cast receives an RpcStackUpdate', () => {
        const stackUpdates = browserFake.filter('rpc-stack-update');
        expect(stackUpdates.length).toBeGreaterThan(0);

        const first = stackUpdates[0] as RpcStackUpdate;
        expect(first.snapshotType).toBe('initial');
        expect(first.depth).toBeGreaterThan(0);
        expect(Array.isArray(first.blocks)).toBe(true);
    });
    it('cast injects "next" → runtime advances AND cast receives a follow-up RpcStackUpdate', async () => {
        const updatesBefore = browserFake
            .filter('rpc-stack-update')
            .filter((m) => m.snapshotType !== 'initial').length;

        const nextEvent: RpcEvent = {
            type: 'rpc-event',
            name: 'next',
            timestamp: 0,
        };
        receiverFake.send(nextEvent);

        // Flush any deferred work the runtime schedules in response to the
        // next event (the stack observer path uses setTimeout(0) too).
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const updatesAfter = browserFake
            .filter('rpc-stack-update')
            .filter((m) => m.snapshotType !== 'initial');
        expect(updatesAfter.length).toBeGreaterThan(updatesBefore);

        const hasStructuralChange = updatesAfter.some(
            (m) => m.snapshotType === 'push' || m.snapshotType === 'pop',
        );
        expect(hasStructuralChange).toBe(true);
    });

    it('RpcEvent.data flows through unknown → runtime.handle without crashing', () => {
        const eventWithData: RpcEvent = {
            type: 'rpc-event',
            name: 'noop',
            data: { arbitrary: 'payload', count: 42 },
            timestamp: 0,
        };
        expect(() => receiverFake.send(eventWithData)).not.toThrow();
    });
});
