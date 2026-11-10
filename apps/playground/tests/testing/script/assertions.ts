import type { ScriptState } from './ScriptState';
import type { IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import type { RpcMessage, RpcStackUpdate, RpcEvent } from '@/services/cast/rpc/RpcMessages';
import type { RoundState, TimerState } from '@bitcobblers/wod-wiki-engine';
import type { IOutputStatement, OutputStatementType } from '@bitcobblers/wod-wiki-engine';

/** Snapshot read API rooted at a ScriptState. */
export interface Assertions {
    /** Reference the current (top-of-stack) block, or undefined if stack is empty. */
    currentBlock(): BlockAssertions | undefined;
    /** Find a block by its label, top-to-bottom. */
    blockByLabel(label: string): BlockAssertions | undefined;
    /** Find a block by its key. */
    blockByKey(key: string): BlockAssertions | undefined;
    /** All blocks on the stack, top-to-bottom. */
    blocks(): BlockAssertions[];
    /**
     * Find blocks whose `blockType` matches the given type tag, top-to-bottom.
     * Supports the `block(type).memory(tag).value` access pattern that
     * compliance tests use.
     */
    blocksByType(type: string): BlockAssertions[];
    /** All cast-bound messages. */
    cast(): CastAssertions;
    stack(): StackAssertions;
    /**
     * Output statement assertions. Captures every IOutputStatement the
     * runtime has emitted up to this snapshot — the same data
     * `OutputTracingHarness` records, but in DSL form.
     */
    outputs(): OutputAssertions;
}

export interface BlockAssertions {
    readonly block: IRuntimeBlock;
    label(): string;
    blockType(): string;
    isComplete(): boolean;
    /** Read metrics by memory tag (display, promote, result, private:*). Flattened across all locations. */
    memoryByTag(tag: string): readonly IMetric[];
    /** Return the first metric with the given type across all memory locations. */
    metric(type: string): IMetric | undefined;
    /** Did this block see a particular event by name? Reads from cast messages. */
    receivedEvent(name: string): boolean;

    // ── Domain-specific queries ──────────────────────────────

    /**
     * Does this block's `blockType` match the given tag (case-insensitive)?
     * Supports the common `/effort/i`, `/timer/i`, `/rest/i` patterns compliance
     * tests use to identify a block by category.
     */
    isA(typeTag: string): boolean;

    /**
     * Does this block have a metric of the given type in the given memory tag?
     * Convenience over `memoryByTag(tag).some(m => m.type === metricType)`.
     */
    hasMetric(tag: string, metricType: string): boolean;

    /** All display metrics (shortcut for `memoryByTag('metric:display')`). */
    displayMetrics(): readonly IMetric[];

    /** First display metric with the given type, or undefined. */
    displayMetric(type: string): IMetric | undefined;

    /**
     * Read the structured round state from this block's `'round'` memory.
     * Returns undefined if no round memory exists.
     *
     * The cast inside is intentional: the memory system stores structured
     * data as `IMetric` with a `value` field whose runtime shape is `RoundState`.
     * This method is the single place that owns that cast; tests should
     * prefer this over the raw `as unknown as RoundState` pattern.
     */
    roundState(): RoundState | undefined;

    /**
     * Read the structured timer state from this block's `'timer'` memory.
     * Returns undefined if no timer memory exists. Same cast rationale as
     * `roundState()`.
     */
    timerState(): TimerState | undefined;
}


export interface CastAssertions {
    /** All sent messages. */
    messages(): readonly RpcMessage[];
    /** Sent messages filtered to a specific RpcMessage discriminator. */
    filter<T extends RpcMessage['type']>(type: T): Extract<RpcMessage, { type: T }>[];
    /** Count of RpcStackUpdate messages. */
    stackUpdateCount(): number;
    /** Most recent RpcStackUpdate, or undefined. */
    lastStackUpdate(): RpcStackUpdate | undefined;
    /** Did the cast side ever receive an RpcEvent for the given name? */
    sawEvent(name: string): boolean;
}

export interface StackAssertions {
    depth(): number;
    isEmpty(): boolean;
    /** Convenience: did a push or pop happen on this snapshot vs a baseline? */
    changed(baseline: ScriptState): boolean;
}

/**
 * Read API for runtime-emitted output statements. Mirrors the shape of
 * `OutputTracingHarness` so tests can verify output sequences without
 * attaching a harness.
 */
export interface OutputAssertions {
    /** All output statements captured since script start, in order. */
    all(): readonly IOutputStatement[];
    /** Count of captured output statements. */
    count(): number;
    /**
     * Output statements scoped to a particular block key.
     * Block key is the `IRuntimeBlock.key.toString()` of the emitting block.
     */
    forBlock(key: string): readonly IOutputStatement[];
    /** Output statements of a particular type (`'segment'`, `'load'`, `'system'`, etc.). */
    byType(type: OutputStatementType): readonly IOutputStatement[];
    /**
     * Segment outputs that carry a `completionReason` — i.e. the segment that
     * closed out a block pop. There is no separate `'completion'` output type;
     * completion data is a field on the segment itself.
     */
    completions(): readonly IOutputStatement[];
    /** All segment outputs. Shortcut for `byType('segment')`. */
    segments(): readonly IOutputStatement[];
    /**
     * Historically asserted that every `'segment'` output had a matching
     * `'completion'` output from the same block. Since completion data now
     * lives on the segment itself (`completionReason`), every segment is
     * structurally self-paired — this always returns `[]`. Kept for API
     * compatibility with existing test call sites.
     */
    assertPairedOutputs(): string[];
    /**
     * Throws if `assertPairedOutputs()` returns any entries. Since pairing is
     * now structural (see `assertPairedOutputs`), this is effectively a no-op
     * assertion kept for existing test call sites.
     */
    allPaired(): void;
    /** Assert at least `min` outputs were emitted. Throws otherwise. */
    assertMinCount(min: number): void;
}

class BlockAssertionsImpl implements BlockAssertions {
    readonly block: IRuntimeBlock;
    private readonly state: ScriptState;

    constructor(block: IRuntimeBlock, state: ScriptState) {
        this.block = block;
        this.state = state;
    }

    label(): string {
        return this.block.label;
    }

    blockType(): string {
        return this.block.blockType ?? '';
    }

    isComplete(): boolean {
        return this.block.isComplete;
    }

    memoryByTag(tag: string): readonly IMetric[] {
        const locations = this.block.getAllMemory().filter(loc => loc.tag === tag);
        return locations.flatMap(loc => loc.metrics.toArray());
    }

    metric(type: string): IMetric | undefined {
        return this.block
            .getAllMemory()
            .flatMap(loc => loc.metrics.toArray())
            .find(m => m.type === type);
    }

    receivedEvent(name: string): boolean {
        return this.state.castSent.some(
            (m): m is RpcEvent => m.type === 'rpc-event' && m.name === name,
        );
    }

    isA(typeTag: string): boolean {
        return new RegExp(typeTag, 'i').test(this.block.blockType ?? '');
    }

    hasMetric(tag: string, metricType: string): boolean {
        return this.memoryByTag(tag).some(m => m.type === metricType);
    }

    displayMetrics(): readonly IMetric[] {
        return this.memoryByTag('metric:display');
    }

    displayMetric(type: string): IMetric | undefined {
        return this.displayMetrics().find(m => m.type === type);
    }

    roundState(): RoundState | undefined {
        const loc = this.block.getMemoryByTag('round')[0];
        if (!loc) return undefined;
        const first = loc.metrics.toArray()[0];
        return first ? (first.value as RoundState) : undefined;
    }

    timerState(): TimerState | undefined {
        const loc = this.block.getMemoryByTag('time')[0];
        if (!loc) return undefined;
        const first = loc.metrics.toArray()[0];
        return first ? (first.value as TimerState) : undefined;
    }
}

class CastAssertionsImpl implements CastAssertions {
    private readonly state: ScriptState;

    constructor(state: ScriptState) {
        this.state = state;
    }

    messages(): readonly RpcMessage[] {
        return this.state.castSent;
    }

    filter<T extends RpcMessage['type']>(type: T): Extract<RpcMessage, { type: T }>[] {
        return this.state.castSent.filter(
            (m): m is Extract<RpcMessage, { type: T }> => m.type === type,
        );
    }

    stackUpdateCount(): number {
        return this.filter('rpc-stack-update').length;
    }

    lastStackUpdate(): RpcStackUpdate | undefined {
        const updates = this.filter('rpc-stack-update');
        return updates[updates.length - 1];
    }

    sawEvent(name: string): boolean {
        return this.state.castSent.some(
            (m): m is RpcEvent => m.type === 'rpc-event' && m.name === name,
        );
    }
}

class StackAssertionsImpl implements StackAssertions {
    private readonly state: ScriptState;

    constructor(state: ScriptState) {
        this.state = state;
    }

    depth(): number {
        return this.state.depth;
    }

    isEmpty(): boolean {
        return this.state.depth === 0;
    }

    changed(baseline: ScriptState): boolean {
        if (this.state.depth !== baseline.depth) {
            return true;
        }
        const currentKey = this.state.current?.key.toString();
        const baselineKey = baseline.current?.key.toString();
        return currentKey !== baselineKey;
    }
}

class OutputAssertionsImpl implements OutputAssertions {
    private readonly state: ScriptState;

    constructor(state: ScriptState) {
        this.state = state;
    }
    private get _outputs(): readonly IOutputStatement[] {
        return this.state.outputs ?? [];
    }

    all(): readonly IOutputStatement[] {
        return this._outputs;
    }

    count(): number {
        return this._outputs.length;
    }

    forBlock(key: string): readonly IOutputStatement[] {
        return this._outputs.filter(o => o.sourceBlockKey === key);
    }

    byType(type: OutputStatementType): readonly IOutputStatement[] {
        return this._outputs.filter(o => o.outputType === type);
    }

    completions(): readonly IOutputStatement[] {
        // 'completion' is folded into segment outputs (completionReason field).
        return this.byType('segment').filter(s => s.completionReason !== undefined);
    }

    segments(): readonly IOutputStatement[] {
        return this.byType('segment');
    }

    assertPairedOutputs(): string[] {
        // Post-consolidation, completion data is folded into each segment's
        // `completionReason` field — there is no separate 'completion' output to
        // pair against, so every segment is structurally self-paired.
        return [];
    }

    allPaired(): void {
        const unpaired = this.assertPairedOutputs();
        if (unpaired.length > 0) {
            throw new Error(
                `Unpaired segment outputs (${unpaired.length}):\n${unpaired.join('\n')}`,
            );
        }
    }

    assertMinCount(min: number): void {
        if (this._outputs.length < min) {
            throw new Error(
                `Expected at least ${min} outputs but got ${this._outputs.length}`,
            );
        }
    }
}

class AssertionsImpl implements Assertions {
    private readonly state: ScriptState;

    constructor(state: ScriptState) {
        this.state = state;
    }

    currentBlock(): BlockAssertions | undefined {
        return this.state.current
            ? new BlockAssertionsImpl(this.state.current, this.state)
            : undefined;
    }

    blockByLabel(label: string): BlockAssertions | undefined {
        const block = this.state.blocks.find(b => b.label === label);
        return block ? new BlockAssertionsImpl(block, this.state) : undefined;
    }

    blockByKey(key: string): BlockAssertions | undefined {
        const block = this.state.blocks.find(b => b.key.toString() === key);
        return block ? new BlockAssertionsImpl(block, this.state) : undefined;
    }

    blocks(): BlockAssertions[] {
        return this.state.blocks.map(b => new BlockAssertionsImpl(b, this.state));
    }

    blocksByType(type: string): BlockAssertions[] {
        return this.state.blocks
            .filter(b => b.blockType === type)
            .map(b => new BlockAssertionsImpl(b, this.state));
    }

    cast(): CastAssertions {
        return new CastAssertionsImpl(this.state);
    }

    stack(): StackAssertions {
        return new StackAssertionsImpl(this.state);
    }

    outputs(): OutputAssertions {
        return new OutputAssertionsImpl(this.state);
    }
}
/** Build the assertion tree from a snapshot. Pure read; no mutation. */
export function assertions(state: ScriptState): Assertions {
    return new AssertionsImpl(state);
}

/** Run a set of assertions, throwing a composite error on any mismatch. */
export function expectAll(state: ScriptState, checks: Array<(a: Assertions) => void>): void {
    const errors: Error[] = [];
    const a = assertions(state);
    for (const check of checks) {
        try {
            check(a);
        } catch (e) {
            errors.push(e instanceof Error ? e : new Error(String(e)));
        }
    }
    if (errors.length > 0) {
        const summary = errors.map((e, i) => `  ${i + 1}. ${e.message}`).join('\n');
        const err = new Error(`${errors.length} assertion(s) failed:\n${summary}`);
        (err as unknown as Record<string, Error[]>).errors = errors;
        throw err;
    }
}
