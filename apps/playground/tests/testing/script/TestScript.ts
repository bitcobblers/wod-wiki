import { TestScript as CanonicalTestScript, type TestScriptConfig as CanonicalTestScriptConfig } from '@wod-wiki/lang-harness/script/TestScript';
import type { ScriptState } from '@wod-wiki/lang-harness/script/ScriptState';
import type { FakeRpcTransport } from '../transport/FakeRpcTransport';
import type { ScriptRuntime, WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import type { IRpcTransport } from '@/services/cast/rpc/IRpcTransport';
import { ChromecastRuntimeSubscription } from '@/services/cast/rpc/ChromecastRuntimeSubscription';

export type { TestScriptConfig } from '@wod-wiki/lang-harness/script/TestScript';

interface WiredCast {
    config: CanonicalTestScriptConfig;
    subscription(): ChromecastRuntimeSubscription | undefined;
}

/**
 * Wire the canonical `onStackSnapshot` hook to the app's
 * ChromecastRuntimeSubscription. The subscription is created lazily on the
 * first snapshot so it receives the exact transport the canonical factory
 * resolved (caller-supplied or auto-paired), mirroring the pre-unification
 * fork where TestScript constructed it directly.
 */
function wireCast(config?: CanonicalTestScriptConfig): WiredCast {
    let subscription: ChromecastRuntimeSubscription | undefined;
    return {
        config: {
            ...config,
            onStackSnapshot(snapshot, castTransport) {
                if (!subscription) subscription = new ChromecastRuntimeSubscription(castTransport as unknown as IRpcTransport);
                subscription.onStackSnapshot(snapshot);
                config?.onStackSnapshot?.(snapshot, castTransport);
            },
        },
        subscription: () => subscription,
    };
}

/**
 * Playground facade over the canonical lang TestScript. Forwards the full
 * API 1:1 while keeping the app-level cast subscription wiring local to the
 * playground.
 */
export class TestScript {
    private constructor(
        private readonly _inner: CanonicalTestScript,
        private readonly _subscription: ChromecastRuntimeSubscription | undefined,
    ) {}

    /** The underlying runtime. */
    get runtime(): ScriptRuntime {
        return this._inner.runtime;
    }

    /** The paired cast-side transport. */
    get cast(): FakeRpcTransport {
        return this._inner.cast as unknown as FakeRpcTransport;
    }

    /** Compile a script (string of whiteboard text) into a TestScript. */
    static async compile(scriptText: string, config?: CanonicalTestScriptConfig): Promise<TestScript> {
        const wired = wireCast(config);
        return new TestScript(await CanonicalTestScript.compile(scriptText, wired.config), wired.subscription());
    }

    /** Build a TestScript from a pre-parsed WhiteboardScript (avoids double-parse). */
    static async fromScript(script: WhiteboardScript, config?: CanonicalTestScriptConfig): Promise<TestScript> {
        const wired = wireCast(config);
        return new TestScript(await CanonicalTestScript.fromScript(script, wired.config), wired.subscription());
    }

    /** Construct from an existing runtime. */
    static from(runtime: ScriptRuntime, config?: CanonicalTestScriptConfig): TestScript {
        const wired = wireCast(config);
        return new TestScript(CanonicalTestScript.from(runtime, wired.config), wired.subscription());
    }

    /** Capture a frozen ScriptState snapshot of the current state. */
    async snapshot(): Promise<ScriptState> {
        return this._inner.snapshot();
    }

    /** Dispatch a 'next' NextEvent into the runtime. Awaits the deferred observer. */
    async next(): Promise<this> {
        await this._inner.next();
        return this;
    }

    /** Advance the mock clock by ms. Does NOT auto-dispatch a tick event. */
    async advance(ms: number): Promise<this> {
        await this._inner.advance(ms);
        return this;
    }

    /** Composite shortcut: advance time, dispatch a tick event, wait for the stack observer. */
    async tick(ms: number): Promise<this> {
        await this._inner.tick(ms);
        return this;
    }

    /** Dispatch a user event to the runtime (e.g. 'abort', 'pause'). */
    async userEvent(name: string, data?: unknown): Promise<this> {
        await this._inner.userEvent(name, data);
        return this;
    }

    /** Coarse shortcut: tick in ≤1s steps until the current block completes. */
    async advanceToNextBlock(maxMs: number = 30 * 60 * 1000): Promise<this> {
        await this._inner.advanceToNextBlock(maxMs);
        return this;
    }

    /** Dispose the runtime, paired transport, and cast subscription. */
    async dispose(): Promise<void> {
        await this._inner.dispose();
        this._subscription?.dispose();
    }
}
