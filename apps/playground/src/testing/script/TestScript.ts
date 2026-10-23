import { ScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { FakeRpcTransport } from '@/testing/transport/FakeRpcTransport';
import type { MockClock } from '@bitcobblers/wod-wiki-engine';
import type { StackSnapshot } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import type { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import type { RuntimeStackOptions } from '@bitcobblers/wod-wiki-engine';

import { RuntimeStack } from '@bitcobblers/wod-wiki-engine';
import { EventBus } from '@bitcobblers/wod-wiki-engine';
import { createMockClock } from '@bitcobblers/wod-wiki-engine';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import { StartSessionAction } from '@bitcobblers/wod-wiki-engine';
import { NextEvent } from '@bitcobblers/wod-wiki-engine';
import { ChromecastRuntimeSubscription } from '@/services/cast/rpc/ChromecastRuntimeSubscription';
import { connectPair } from '@/testing/transport/FakeRpcTransport';
import { createCompiler } from '@/testing/compiler'
import { ScriptState } from './ScriptState';

export interface TestScriptConfig {
    /** Inject a pre-built ScriptRuntime. If omitted, the script starts blank. */
    runtime?: ScriptRuntime;
    /** The mock clock to use. If omitted, defaults to createMockClock(now). */
    clock?: MockClock;
    /** The cast-side transport (paired with a browser-side fake). */
    castTransport?: FakeRpcTransport;
    /** Runtime options — e.g. the run's sound configuration. */
    options?: RuntimeStackOptions;
}

export class TestScript {
    readonly runtime: ScriptRuntime;
    readonly cast: FakeRpcTransport;
    private readonly _clock: MockClock;
    private readonly _stackHistory: Array<{ type: 'push' | 'pop' | 'clear' | 'initial'; block?: IRuntimeBlock; depth: number; at: Date }> = [];
    private readonly _outputs: IOutputStatement[] = [];
    private readonly _castSubscription: ChromecastRuntimeSubscription;
    private readonly _stackUnsub: () => void;
    private readonly _outputUnsub: () => void;

    private constructor(runtime: ScriptRuntime, clock: MockClock, cast: FakeRpcTransport) {
        this.runtime = runtime;
        this._clock = clock;
        this.cast = cast;
        this._castSubscription = new ChromecastRuntimeSubscription(cast);
        this._stackUnsub = runtime.subscribeToStack((snapshot) => {
            this._recordSnapshot(snapshot);
            this._castSubscription.onStackSnapshot(snapshot);
        });
        this._outputUnsub = runtime.subscribeToOutput((output) => {
            this._outputs.push(output);
        });
    }

    /** Compile a script (string of whiteboard text) into a TestScript. */
    static async compile(scriptText: string, config?: TestScriptConfig): Promise<TestScript> {
        const script = createParser().read(scriptText) as WhiteboardScript;
        return TestScript._create(script, config);
    }
    /** Build a TestScript from a pre-parsed WhiteboardScript (avoids double-parse). */
    static async fromScript(script: WhiteboardScript, config?: TestScriptConfig): Promise<TestScript> {
        return TestScript._create(script, config);
    }
    /** Shared factory body — both compile() and fromScript() funnel here. */
    private static async _create(script: WhiteboardScript, config?: TestScriptConfig): Promise<TestScript> {
        const compiler = createCompiler();
        const clock = config?.clock ?? createMockClock(new Date('2024-01-01T12:00:00Z'));
        const stack = new RuntimeStack();
        const eventBus = new EventBus();
        const runtime = config?.runtime ?? new ScriptRuntime(script, compiler, { stack, clock, eventBus }, config?.options);
        const castTransport = config?.castTransport ?? new FakeRpcTransport();
        if (!config?.castTransport) {
            const browserFake = new FakeRpcTransport();
            connectPair(browserFake, castTransport);
        }
        const ts = new TestScript(runtime, clock, castTransport);
        runtime.do(new StartSessionAction());
        await ts.flushObservers();
        return ts;
    }
    /** Construct from an existing runtime. */
    static from(runtime: ScriptRuntime, config?: TestScriptConfig): TestScript {
        const clock = config?.clock ?? createMockClock(new Date('2024-01-01T12:00:00Z'));
        const castTransport = config?.castTransport ?? new FakeRpcTransport();
        if (!config?.castTransport) {
            const browserFake = new FakeRpcTransport();
            connectPair(browserFake, castTransport);
        }
        return new TestScript(runtime, clock, castTransport);
    }


    /** Capture a frozen ScriptState snapshot of the current state. */
    async snapshot(): Promise<ScriptState> {
        await this.flushObservers();
        const blocks = [...this.runtime.stack.blocks];
        return Object.freeze({
            blocks,
            depth: this.runtime.stack.count,
            current: this.runtime.stack.current,
            clockTime: new Date(this._clock.currentDate.getTime()),
            castSent: [...this.cast.sent],
            stackHistory: [...this._stackHistory],
            outputs: [...this._outputs],
        }) as ScriptState;
    }

    /** Dispatch a 'next' NextEvent into the runtime. Awaits the deferred observer. */
    async next(): Promise<this> {
        this.runtime.handle(new NextEvent(undefined, this.runtime.nowProvider));
        await this.flushObservers();
        return this;
    }


    /** Advance the mock clock by ms. Does NOT auto-dispatch a tick event. */
    async advance(ms: number): Promise<this> {
        this._clock.advance(ms);
        await this.flushObservers();
        return this;
    }

    /** Composite shortcut: advance time, dispatch a tick event, wait for the stack observer. */
    async tick(ms: number): Promise<this> {
        this._clock.advance(ms);
        this.runtime.handle({
            name: 'tick',
            timestamp: this._clock.currentDate,
            data: { source: 'test-script' },
        });
        await this.flushObservers();
        return this;
    }

    /**
     * Dispatch a user event to the runtime (e.g. 'abort', 'pause').
     */
    async userEvent(name: string, data?: unknown): Promise<this> {
        this.runtime.handle({
            name,
            timestamp: this._clock.currentDate,
            data: data ?? { source: 'test-script' },
        });
        await this.flushObservers();
        return this;
    }

    /**
     * Coarse shortcut: advance by min(maxMs, 1000) and dispatch a tick,
     * repeating until the current block reports isComplete or 100 iterations.
     *
     * @remarks Story 4 will replace this with a true inspectNext-driven version.
     */
    async advanceToNextBlock(maxMs: number = 30 * 60 * 1000): Promise<this> {
        const step = Math.min(maxMs, 1000);
        for (let i = 0; i < 100; i++) {
            await this.tick(step);
            const s = await this.snapshot();
            if (s.current?.isComplete) {
                break;
            }
        }
        return this;
    }

    /** Dispose the runtime and paired transport. */
    async dispose(): Promise<void> {
        this._stackUnsub();
        this._outputUnsub();
        this._castSubscription.dispose();
        this.runtime.dispose();
        this.cast.dispose();
    }

    /** Await any deferred observer callbacks (setTimeout(0) flush). */
    private async flushObservers(): Promise<void> {
        return new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    private _recordSnapshot(snapshot: StackSnapshot): void {
        this._stackHistory.push({
            type: snapshot.type,
            block: snapshot.affectedBlock,
            depth: snapshot.depth,
            at: new Date(snapshot.clockTime.getTime()),
        });
    }
}
