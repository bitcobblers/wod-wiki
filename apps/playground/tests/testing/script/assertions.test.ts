import { describe, it, expect } from 'bun:test';
import { assertions, expectAll } from './assertions';
import type { ScriptState } from './ScriptState';
import { MockBlock } from '@/testing/harness/MockBlock';
import { MemoryLocation } from '@bitcobblers/wod-wiki-engine';
import { MetricType, type IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import type { RpcStackUpdate, RpcEvent } from '@/services/cast/rpc/RpcMessages';

function makeState(partial: Partial<ScriptState> = {}): ScriptState {
    return {
        blocks: [],
        depth: 0,
        current: undefined,
        clockTime: new Date(),
        castSent: [],
        stackHistory: [],
        ...partial,
    } as ScriptState;
}

describe('assertions DSL', () => {
    it('currentBlock returns the top block descriptor', () => {
        const block = new MockBlock({ id: 'b1', label: 'Run' });
        const state = makeState({
            blocks: [block],
            depth: 1,
            current: block,
        });
        expect(assertions(state).currentBlock()?.label()).toBe('Run');
    });

    it('blocks returns one descriptor per block', () => {
        const b1 = new MockBlock({ id: 'b1', label: 'Run' });
        const b2 = new MockBlock({ id: 'b2', label: 'Rest' });
        const state = makeState({
            blocks: [b1, b2],
            depth: 2,
            current: b2,
        });
        const descs = assertions(state).blocks();
        expect(descs.length).toBe(2);
        expect(descs[0].label()).toBe('Run');
        expect(descs[1].label()).toBe('Rest');
    });

    it('cast filter returns typed list', () => {
        const update: RpcStackUpdate = {
            type: 'rpc-stack-update',
            snapshotType: 'push',
            blocks: [],
            depth: 1,
            clockTime: Date.now(),
        };
        const state = makeState({
            castSent: [update],
            depth: 1,
        });
        const filtered = assertions(state).cast().filter('rpc-stack-update');
        expect(filtered.length).toBe(1);
        expect(filtered[0].depth).toBe(1);
    });

    it('cast stackUpdateCount counts only stack updates', () => {
        const update: RpcStackUpdate = {
            type: 'rpc-stack-update',
            snapshotType: 'push',
            blocks: [],
            depth: 1,
            clockTime: Date.now(),
        };
        const event: RpcEvent = {
            type: 'rpc-event',
            name: 'tick',
            timestamp: Date.now(),
        };
        const state = makeState({
            castSent: [update, event],
        });
        expect(assertions(state).cast().stackUpdateCount()).toBe(1);
    });

    it('stack isEmpty returns true for depth 0', () => {
        const state = makeState({ depth: 0 });
        expect(assertions(state).stack().isEmpty()).toBe(true);
    });

    it('stack changed returns true when depth differs', () => {
        const before = makeState({ depth: 1 });
        const after = makeState({ depth: 2 });
        expect(assertions(after).stack().changed(before)).toBe(true);
    });

    it('expectAll throws an aggregated Error when a check fails', () => {
        const block = new MockBlock({ id: 'b1', label: 'Run' });
        const state = makeState({ depth: 1, current: block, blocks: [block] });
        expect(() => {
            expectAll(state, [
                a => {
                    if (a.stack().isEmpty()) throw new Error('is empty');
                },
                a => {
                    if (a.currentBlock()) throw new Error('has block');
                },
            ]);
        }).toThrow(Error);
    });

    it('expectAll is silent when all checks pass', () => {
        const state = makeState({ depth: 0 });
        expect(() => {
            expectAll(state, [
                a => {
                    if (!a.stack().isEmpty()) throw new Error('not empty');
                },
            ]);
        }).not.toThrow();
    });

    it('blockByLabel finds block by label', () => {
        const b1 = new MockBlock({ id: 'b1', label: 'Run' });
        const state = makeState({
            blocks: [b1],
            depth: 1,
            current: b1,
        });
        expect(assertions(state).blockByLabel('Run')?.label()).toBe('Run');
        expect(assertions(state).blockByLabel('Missing')).toBeUndefined();
    });

    it('blockByKey finds block by key', () => {
        const b1 = new MockBlock({ id: 'b1', label: 'Run' });
        const state = makeState({
            blocks: [b1],
            depth: 1,
            current: b1,
        });
        expect(assertions(state).blockByKey('b1')?.label()).toBe('Run');
        expect(assertions(state).blockByKey('missing')).toBeUndefined();
    });

    it('memoryByTag returns flattened metrics', () => {
        const block = new MockBlock({ id: 'b1', label: 'Run' });
        block.pushMemory(
            new MemoryLocation('metric:display', [
                { type: MetricType.Time, origin: 'runtime', value: 300 },
            ]),
        );
        const state = makeState({
            blocks: [block],
            depth: 1,
            current: block,
        });
        const metrics = assertions(state).currentBlock()!.memoryByTag('metric:display');
        expect(metrics.length).toBe(1);
        expect(metrics[0].type).toBe(MetricType.Time);
        expect(metrics[0].value).toBe(300);
    });

    it('metric finds first matching metric by type', () => {
        const block = new MockBlock({ id: 'b1', label: 'Run' });
        block.pushMemory(
            new MemoryLocation('metric:display', [
                { type: MetricType.Time, origin: 'runtime', value: 300 },
                { type: MetricType.Rep, origin: 'parser', value: 10 },
            ]),
        );
        const state = makeState({
            blocks: [block],
            depth: 1,
            current: block,
        });
        const m = assertions(state).currentBlock()!.metric(MetricType.Rep);
        expect(m).toBeDefined();
        expect(m!.value).toBe(10);
        expect(assertions(state).currentBlock()!.metric('missing')).toBeUndefined();
    });

    it('receivedEvent checks cast messages for RpcEvent by name', () => {
        const block = new MockBlock({ id: 'b1', label: 'Run' });
        const event: RpcEvent = {
            type: 'rpc-event',
            name: 'finish',
            timestamp: Date.now(),
        };
        const state = makeState({
            blocks: [block],
            depth: 1,
            current: block,
            castSent: [event],
        });
        expect(assertions(state).currentBlock()!.receivedEvent('finish')).toBe(true);
        expect(assertions(state).currentBlock()!.receivedEvent('start')).toBe(false);
    });

    it('cast sawEvent checks for RpcEvent by name', () => {
        const event: RpcEvent = {
            type: 'rpc-event',
            name: 'beep',
            timestamp: Date.now(),
        };
        const state = makeState({
            castSent: [event],
        });
        expect(assertions(state).cast().sawEvent('beep')).toBe(true);
        expect(assertions(state).cast().sawEvent('boop')).toBe(false);
    });

    it('lastStackUpdate returns most recent stack update', () => {
        const u1: RpcStackUpdate = {
            type: 'rpc-stack-update',
            snapshotType: 'push',
            blocks: [],
            depth: 1,
            clockTime: Date.now(),
        };
        const u2: RpcStackUpdate = {
            type: 'rpc-stack-update',
            snapshotType: 'pop',
            blocks: [],
            depth: 0,
            clockTime: Date.now(),
        };
        const state = makeState({
            castSent: [u1, u2],
        });
        const last = assertions(state).cast().lastStackUpdate();
        expect(last).toBeDefined();
        expect(last!.snapshotType).toBe('pop');
    });

    it('stack changed returns false when nothing changed', () => {
        const block = new MockBlock({ id: 'b1', label: 'Run' });
        const baseline = makeState({
            blocks: [block],
            depth: 1,
            current: block,
        });
        const same = makeState({
            blocks: [block],
            depth: 1,
            current: block,
        });
        expect(assertions(same).stack().changed(baseline)).toBe(false);
    });

    it('stack changed returns true when current block key differs', () => {
        const b1 = new MockBlock({ id: 'b1', label: 'Run' });
        const b2 = new MockBlock({ id: 'b2', label: 'Rest' });
        const baseline = makeState({
            blocks: [b1],
            depth: 1,
            current: b1,
        });
        const changed = makeState({
            blocks: [b2],
            depth: 1,
            current: b2,
        });
        expect(assertions(changed).stack().changed(baseline)).toBe(true);
    });

    // ── Domain-specific queries ──────────────────────────────
    it('isA matches blockType case-insensitively', () => {
        const effort = new MockBlock({ id: 'b1', label: 'Effort 1', blockType: 'Effort' });
        const amrap = new MockBlock({ id: 'b2', label: 'AMRAP', blockType: 'AMRAP' });
        const state = makeState({
            blocks: [effort, amrap],
            depth: 2,
            current: effort,
        });
        const a = assertions(state);
        expect(a.currentBlock()!.isA('effort')).toBe(true);
        expect(a.currentBlock()!.isA('EFFORT')).toBe(true);
        expect(a.currentBlock()!.isA('amrap')).toBe(false);
        expect(a.blocksByType('AMRAP')[0]!.isA('amrap')).toBe(true);
    });

    it('hasMetric returns true when a metric type is present in the given tag', () => {
        const block = new MockBlock({ id: 'b1', label: 'Effort' });
        block.pushMemory(
            new MemoryLocation('metric:display', [
                { type: MetricType.Resistance, origin: 'parser', value: 135 },
            ]),
        );
        const state = makeState({ blocks: [block], depth: 1, current: block });
        const a = assertions(state).currentBlock()!;
        expect(a.hasMetric('metric:display', MetricType.Resistance)).toBe(true);
        expect(a.hasMetric('metric:display', MetricType.Rep)).toBe(false);
        expect(a.hasMetric('round', MetricType.Rep)).toBe(false);
    });

    it('displayMetrics / displayMetric read from metric:display memory', () => {
        const block = new MockBlock({ id: 'b1', label: 'Effort' });
        block.pushMemory(
            new MemoryLocation('metric:display', [
                { type: MetricType.Rep, origin: 'parser', value: 21 },
                { type: MetricType.Resistance, origin: 'parser', value: 95 },
            ]),
        );
        const state = makeState({ blocks: [block], depth: 1, current: block });
        const a = assertions(state).currentBlock()!;
        expect(a.displayMetrics().length).toBe(2);
        expect(a.displayMetric(MetricType.Resistance)!.value).toBe(95);
        expect(a.displayMetric(MetricType.Distance)).toBeUndefined();
    });

    it('roundState returns the first round-tagged metric as RoundState', () => {
        const block = new MockBlock({ id: 'b1', label: 'Rounds 21-15-9' });
        block.pushMemory(
            new MemoryLocation('round', [
                { type: MetricType.Rep, origin: 'runtime', value: { current: 2, total: 3 } },
            ]),
        );
        const state = makeState({ blocks: [block], depth: 1, current: block });
        const rs = assertions(state).currentBlock()!.roundState();
        expect(rs).toBeDefined();
        expect(rs!.current).toBe(2);
        expect(rs!.total).toBe(3);
    });

    it('roundState returns undefined when no round memory exists', () => {
        const block = new MockBlock({ id: 'b1', label: 'Rounds' });
        const state = makeState({ blocks: [block], depth: 1, current: block });
        expect(assertions(state).currentBlock()!.roundState()).toBeUndefined();
    });

    it('timerState returns the first time-tagged metric as TimerState', () => {
        const block = new MockBlock({ id: 'b1', label: 'AMRAP 5min' });
        block.pushMemory(
            new MemoryLocation('time', [
                {
                    type: MetricType.Elapsed,
                    origin: 'runtime',
                    value: { spans: [], durationMs: 300_000, direction: 'down', label: 'AMRAP' },
                },
            ]),
        );
        const state = makeState({ blocks: [block], depth: 1, current: block });
        const ts = assertions(state).currentBlock()!.timerState();
        expect(ts).toBeDefined();
        expect(ts!.durationMs).toBe(300_000);
        expect(ts!.direction).toBe('down');
    });

    it('timerState returns undefined when no time memory exists', () => {
        const block = new MockBlock({ id: 'b1', label: 'Rounds' });
        const state = makeState({ blocks: [block], depth: 1, current: block });
        expect(assertions(state).currentBlock()!.timerState()).toBeUndefined();
    });

    // ── Output assertions ──────────────────────────────

    it('outputs().all returns the captured output statements', () => {
        const state = makeState({
            outputs: [
                { id: 1, outputType: 'segment', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
                { id: 2, outputType: 'completion', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
            ],
        });
        const out = assertions(state).outputs();
        expect(out.count()).toBe(2);
        expect(out.all().length).toBe(2);
    });

    it('outputs().byType filters by OutputStatementType', () => {
        const state = makeState({
            outputs: [
                { id: 1, outputType: 'segment', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
                { id: 2, outputType: 'completion', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
                { id: 3, outputType: 'segment', sourceBlockKey: 'b2' } as unknown as IOutputStatement,
            ],
        });
        const out = assertions(state).outputs();
        expect(out.byType('segment').length).toBe(2);
        expect(out.byType('completion').length).toBe(1);
    });

    it('outputs().forBlock filters by source block key', () => {
        const state = makeState({
            outputs: [
                { id: 1, outputType: 'segment', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
                { id: 2, outputType: 'completion', sourceBlockKey: 'b2' } as unknown as IOutputStatement,
            ],
        });
        const out = assertions(state).outputs();
        expect(out.forBlock('b1').length).toBe(1);
        expect(out.forBlock('missing').length).toBe(0);
    });

    it('outputs().allPaired passes — completion is folded into segment outputs', () => {
        const state = makeState({
            outputs: [
                { id: 1, outputType: 'segment', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
                { id: 2, outputType: 'completion', sourceBlockKey: 'b1' } as unknown as IOutputStatement,
            ],
        });
        expect(() => assertions(state).outputs().allPaired()).not.toThrow();
    });

    it('outputs() default to empty array when state.outputs is undefined', () => {
        const state = makeState();
        const out = assertions(state).outputs();
        expect(out.count()).toBe(0);
        expect(out.all()).toEqual([]);
    });
});