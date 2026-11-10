import { IRuntimeBlockStrategy } from '@bitcobblers/wod-wiki-engine';
import { BlockBuilder } from '@bitcobblers/wod-wiki-engine';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { ParsedCodeStatement } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBehavior } from '@bitcobblers/wod-wiki-engine';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeMemory } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeClock } from '@bitcobblers/wod-wiki-engine';
import { IEventBus } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeStack } from '@bitcobblers/wod-wiki-engine';
import { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';

/**
 * Frozen view of a strategy application result.
 * Tests assert against this view instead of mutating the builder.
 */
export class AppliedStrategy {
    constructor(
        public readonly matched: boolean,
        private readonly builder: BlockBuilder,
    ) {}

    get blockType(): string {
        return this.builder.getBlockType();
    }

    get label(): string {
        return this.builder.getLabel();
    }

    get fragments(): MetricContainer[] | undefined {
        return this.builder.getFragments();
    }

    get sourceIds(): number[] {
        return this.builder.getSourceIds();
    }

    hasBehavior<T extends IRuntimeBehavior>(type: new (...args: unknown[]) => T): boolean {
        return this.builder.hasBehavior(type);
    }

    getBehavior<T extends IRuntimeBehavior>(type: new (...args: unknown[]) => T): T | undefined {
        return this.builder.getBehavior(type);
    }
    get exitMode(): 'immediate' | 'deferred' | undefined {
        return this.builder.exitMode;
    }
}

/**
 * Adapter that wraps a real BlockBuilder for focused per-strategy tests.
 *
 * Usage:
 * ```ts
 * const result = new StrategyTestHarness()
 *   .withStrategy(new AmrapLogicStrategy())
 *   .withStatements(stmts)
 *   .apply();
 *
 * expect(result.blockType).toBe('AMRAP');
 * expect(result.hasBehavior(CountdownTimerBehavior)).toBe(true);
 * ```
 */
export class StrategyTestHarness {
    private strategy?: IRuntimeBlockStrategy;
    private statements: ICodeStatement[] = [];
    private runtime: IScriptRuntime;

    constructor(runtime?: IScriptRuntime) {
        this.runtime = runtime ?? stubRuntime();
    }

    withStrategy(strategy: IRuntimeBlockStrategy): this {
        this.strategy = strategy;
        return this;
    }

    withStatements(statements: ICodeStatement[]): this {
        this.statements = statements;
        return this;
    }

    apply(): AppliedStrategy {
        if (!this.strategy) {
            throw new Error('Strategy not set. Call withStrategy() first.');
        }

        const builder = new BlockBuilder(this.runtime);
        const matched = this.strategy.match(this.statements, this.runtime);

        if (matched) {
            this.strategy.apply(builder, this.statements, this.runtime);
        }

        return new AppliedStrategy(matched, builder);
    }
}

/**
 * Convenience function — one-liner for the common case.
 */
export function apply(
    strategy: IRuntimeBlockStrategy,
    statements: ICodeStatement[],
    runtime?: IScriptRuntime,
): AppliedStrategy {
    return new StrategyTestHarness(runtime)
        .withStrategy(strategy)
        .withStatements(statements)
        .apply();
}

// ---------------------------------------------------------------------------
// Statement helpers
// ---------------------------------------------------------------------------

/**
 * Create a ParsedCodeStatement with a single metric.
 */
export function stmtWith(
    type: MetricType,
    value: unknown,
    options?: Omit<Partial<IMetric>, 'type' | 'value'>,
): ICodeStatement {
    return makeStatement([{ type, value, origin: 'parser', ...options }]);
}

/**
 * Create a ParsedCodeStatement from a list of metrics.
 */
export function makeStatement(
    metrics: IMetric[],
    overrides?: Partial<ParsedCodeStatement>,
): ICodeStatement {
    const stmt = new ParsedCodeStatement({
        id: overrides?.id ?? nextId(),
        ...overrides,
    });
    stmt.metrics = metrics;
    return stmt;
}

let _id = 1;
function nextId(): number {
    return _id++;
}

// ---------------------------------------------------------------------------
// Runtime stub
// ---------------------------------------------------------------------------

function stubMemory(): IRuntimeMemory {
    const store = new Map<string, unknown>();

    return {
        allocate: <T>(_type: string, _ownerId: string, value: T) => {
            const id = `ref-${Math.random()}`;
            const ref = {
                id,
                type: _type,
                ownerId: _ownerId,
                get: (): T => (store.get(id) as T) ?? value,
                set: (v: T) => store.set(id, v),
                value: (): T => (store.get(id) as T) ?? value,
            };
            store.set(id, value);
            return ref;
        },
        get: <T>(ref: unknown): T | undefined => {
            if (ref && typeof ref === 'object' && 'get' in ref && typeof (ref as Record<string, unknown>).get === 'function') {
                return (ref as { get: () => T }).get();
            }
            if (ref && typeof ref === 'object' && 'value' in ref) {
                return (ref as { value: T }).value;
            }
            return undefined;
        },
        set: <T>(ref: unknown, value: T) => {
            if (ref && typeof ref === 'object' && 'set' in ref && typeof (ref as Record<string, unknown>).set === 'function') {
                (ref as { set: (v: T) => void }).set(value);
            }
        },
        release: () => {},
        search: () => [],
        subscribe: () => () => {},
        dispose: () => {},
    } as unknown as IRuntimeMemory;
}

function stubClock(): IRuntimeClock {
    const now = new Date();
    return {
        now,
        currentDate: now,
        elapsed: 0,
        isRunning: false,
        spans: [],
        start: () => now,
        stop: () => now,
    } as unknown as IRuntimeClock;
}

function stubEventBus(): IEventBus {
    return {
        dispatch: () => {},
        register: () => () => {},
    } as unknown as IEventBus;
}

function stubStack(): IRuntimeStack {
    return {
        push: () => {},
        pop: () => null,
        peek: () => null,
        isEmpty: () => true,
        graph: () => [],
        dispose: () => {},
    } as unknown as IRuntimeStack;
}

function stubScript(): WhiteboardScript {
    return new WhiteboardScript('stub', [], []);
}

/**
 * Minimal IScriptRuntime stub for strategy unit tests.
 * Provides enough surface for BlockBuilder and BlockContext construction.
 */
export function stubRuntime(): IScriptRuntime {
    return {
        options: {},
        script: stubScript(),
        eventBus: stubEventBus(),
        stack: stubStack(),
        jit: { compile: () => undefined },
        clock: stubClock(),
        nowProvider: { now: () => new Date() },
        memory: stubMemory(),
        do: () => {},
        doAll: () => {},
        handle: () => {},
        pushBlock: () => {},
        popBlock: () => {},
        subscribeToOutput: () => () => {},
        getOutputStatements: () => [],
        addOutput: () => {},
        subscribeToStack: () => () => {},
        setAnalyticsEngine: () => {},
        finalizeAnalytics: () => [],
        dispose: () => {},
    } as unknown as IScriptRuntime;
}
