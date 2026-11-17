// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { BlockBuilder } from '../../src/runtime/compiler/BlockBuilder';
import { BlockKey } from '@bitcobblers/wod-wiki-core';
import { BlockContext } from '../../src/runtime/BlockContext';
import { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';

/**
 * Phase 4 Tests: Fragment Source Access from Blocks (List-Based Memory)
 *
 * These tests verify that:
 * 1. Blocks built via BlockBuilder store metric as MemoryLocation entries
 * 2. The metric:display memory locations are accessible and reactive
 * 3. Stack display items can access metric data from memory locations
 */
describe("Phase 4: Fragment Source Access from Blocks", () => {
    const runtime = {
        memory: { search: () => undefined }
    } as any as IScriptRuntime;

    function createFragment(type: string, fragType: MetricType, value: unknown, origin: string = 'parser'): IMetric {
        return { type: fragType, value, origin } as IMetric;
    }

    function buildBlock(metricGroups: IMetric[][]) {
        const blockKey = new BlockKey();
        const context = new BlockContext(runtime, blockKey.toString());

        return new BlockBuilder(runtime)
            .setContext(context)
            .setKey(blockKey)
            .setBlockType("Test")
            .setLabel("Test Block")
            .setFragments(metricGroups)
            .build();
    }

    // ========================================================================
    // Fragment access via list-based memory locations
    // ========================================================================

    describe("Fragment memory locations from block", () => {
        it("should return metric:display memory locations from built block", () => {
            const timerFrag = createFragment('duration', MetricType.Duration, 60000);
            const block = buildBlock([[timerFrag]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations).toHaveLength(1);
            expect(locations[0].metrics).toHaveLength(1);
            expect(locations[0].metrics[0].type).toBe(MetricType.Duration);
        });

        it("should return correct metric values", () => {
            const timerFrag = createFragment('duration', MetricType.Duration, 60000);
            const block = buildBlock([[timerFrag]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations[0].metrics[0].value).toBe(60000);
        });

        it("should return multiple metric in a single location", () => {
            const timerFrag = createFragment('duration', MetricType.Duration, 60000);
            const actionFrag = createFragment('action', MetricType.Action, 'Run');
            const repFrag = createFragment('rep', MetricType.Rep, 21);

            const block = buildBlock([[timerFrag, actionFrag, repFrag]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations).toHaveLength(1);
            expect(locations[0].metrics).toHaveLength(3);
        });

        it("should filter metric by type", () => {
            const timerFrag = createFragment('duration', MetricType.Duration, 60000);
            const actionFrag = createFragment('action', MetricType.Action, 'Run');
            const repFrag = createFragment('rep', MetricType.Rep, 21);

            const block = buildBlock([[timerFrag, actionFrag, repFrag]]);

            const locations = block.getMemoryByTag('metric:display');
            const timersOnly = locations[0].metrics.filter(f => f.type === MetricType.Duration);
            expect(timersOnly).toHaveLength(1);
            expect(timersOnly[0].value).toBe(60000);
        });

        it("should return undefined when block has no metric:display memory", () => {
            const blockKey = new BlockKey();
            const context = new BlockContext(runtime, blockKey.toString());

            const block = new BlockBuilder(runtime)
                .setContext(context)
                .setKey(blockKey)
                .setBlockType("Test")
                .setLabel("Test Block")
                .build();

            const locations = block.getMemoryByTag('metric:display');
            expect(locations).toHaveLength(0);
        });
    });

    // ========================================================================
    // Multi-metric scenarios (21-15-9 rep scheme, multi-action)
    // ========================================================================

    describe("Multi-metric per type scenarios", () => {
        it("should handle multiple rep metric (21-15-9 scheme)", () => {
            const rep21 = createFragment('rep', MetricType.Rep, 21);
            const rep15 = createFragment('rep', MetricType.Rep, 15);
            const rep9 = createFragment('rep', MetricType.Rep, 9);
            const action = createFragment('action', MetricType.Action, 'Thrusters');

            const block = buildBlock([[rep21, rep15, rep9, action]]);

            const locations = block.getMemoryByTag('metric:display');
            const reps = locations[0].metrics.filter(f => f.type === MetricType.Rep);
            expect(reps).toHaveLength(3);

            const actions = locations[0].metrics.filter(f => f.type === MetricType.Action);
            expect(actions).toHaveLength(1);
        });

        it("should preserve both parser and runtime metric", () => {
            const parserTimer = createFragment('duration', MetricType.Duration, 600000, 'parser');
            const runtimeTimer = createFragment('duration', MetricType.Duration, 432000, 'runtime');
            const actionFrag = createFragment('action', MetricType.Action, 'Run', 'parser');

            const block = buildBlock([[parserTimer, runtimeTimer, actionFrag]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations[0].metrics).toHaveLength(3);

            const parserFrags = locations[0].metrics.filter(f => f.origin === 'parser');
            expect(parserFrags).toHaveLength(2); // parserTimer + actionFrag are both parser origin
            // Actually both parserTimer and actionFrag are 'parser' origin
        });

        it("should handle user override metric", () => {
            const runtimeRep = createFragment('rep', MetricType.Rep, 19, 'runtime');
            const userRep = createFragment('rep', MetricType.Rep, 18, 'user');

            const block = buildBlock([[runtimeRep, userRep]]);

            const locations = block.getMemoryByTag('metric:display');
            const reps = locations[0].metrics.filter(f => f.type === MetricType.Rep);
            expect(reps).toHaveLength(2);

            const userFrags = reps.filter(f => f.origin === 'user');
            expect(userFrags).toHaveLength(1);
            expect(userFrags[0].value).toBe(18);
        });
    });

    // ========================================================================
    // Reactive updates through MemoryLocation
    // ========================================================================

    describe("Reactive metric updates", () => {
        it("should notify subscribers when metric are updated", () => {
            const timerFrag = createFragment('duration', MetricType.Duration, 60000);
            const block = buildBlock([[timerFrag]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations).toHaveLength(1);

            let notifyCount = 0;
            const unsub = locations[0].subscribe(() => {
                notifyCount++;
            });

            // Update the location with additional metric
            const actionFrag = createFragment('action', MetricType.Action, 'Run');
            locations[0].update([timerFrag, actionFrag]);

            expect(notifyCount).toBe(1);
            expect(locations[0].metrics).toHaveLength(2);
            unsub();
        });

        it("should provide updated metric after update", () => {
            const parserTimer = createFragment('duration', MetricType.Duration, 600000, 'parser');
            const block = buildBlock([[parserTimer]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations[0].metrics[0].origin).toBe('parser');

            // Simulate runtime updating the timer
            const runtimeTimer = createFragment('duration', MetricType.Duration, 432000, 'runtime');
            locations[0].update([runtimeTimer]);

            expect(locations[0].metrics).toHaveLength(1);
            expect(locations[0].metrics[0].origin).toBe('runtime');
            expect(locations[0].metrics[0].value).toBe(432000);
        });
    });

    // ========================================================================
    // Multi-group structure
    // ========================================================================

    describe("Multi-group metric locations", () => {
        it("should preserve multi-group structure as separate locations", () => {
            const frag1 = createFragment('duration', MetricType.Duration, 60000);
            const frag2 = createFragment('action', MetricType.Action, 'Run');

            const block = buildBlock([[frag1], [frag2]]);

            const locations = block.getMemoryByTag('metric:display');
            expect(locations).toHaveLength(2);
            expect(locations[0].metrics[0].type).toBe(MetricType.Duration);
            expect(locations[1].metrics[0].type).toBe(MetricType.Action);
        });

        it("should support building stack display entries from memory locations", () => {
            const frag1 = createFragment('duration', MetricType.Duration, 60000);
            const frag2 = createFragment('action', MetricType.Action, 'Run');

            const block1 = buildBlock([[frag1]]);
            const block2 = buildBlock([[frag2]]);

            const locs1 = block1.getMemoryByTag('metric:display');
            const locs2 = block2.getMemoryByTag('metric:display');

            // Simulate stack display entries
            const entries = [
                { block: block1, metrics: locs1[0].metrics, depth: 0, isLeaf: false, label: 'Parent' },
                { block: block2, metrics: locs2[0].metrics, depth: 1, isLeaf: true, label: 'Child' }
            ];

            expect(entries[0].isLeaf).toBe(false);
            expect(entries[1].isLeaf).toBe(true);
            expect(entries[0].depth).toBe(0);
            expect(entries[1].depth).toBe(1);
            expect(entries[0].metrics[0].type).toBe(MetricType.Duration);
            expect(entries[1].metrics[0].type).toBe(MetricType.Action);
        });
    });
});
