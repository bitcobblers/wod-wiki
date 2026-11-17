/**
 * PromotionResolver tests — Phase D of plan-candidates-2-3-4-5.
 *
 * The resolver is the seam that lifts parent-block promotion logic
 * out of `JitCompiler.compile()`.  These tests pin its observable
 * contract:
 *
 * 1. No parent → empty promotion, `hasPromotions: false`.
 * 2. Parent with `metric:promote` memory → those metrics surface.
 * 3. Parent with `IMetricPromoter` behavior → its `getPromotedFragments()`
 *    output is included (deduped by type, dynamic precedence).
 * 4. The resolver is a pure function of the parent block — no compiler
 *    or `JitCompiler` instance is required to test it.
 */
import { describe, it, expect } from 'vitest';
import { PromotionResolver } from '../../src/runtime/compiler/PromotionResolver';
import { MetricType, IMetric, MetricOrigin } from '@bitcobblers/wod-wiki-core';
import { MemoryLocation } from '../../src/runtime/memory/MemoryLocation';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { IMetricPromoter } from '../../src/runtime/contracts/behaviors/IMetricPromoter';
import type { IRuntimeBlock } from '../../src/runtime/contracts/IRuntimeBlock';
import type { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import type { IRuntimeBehavior } from '../../src/runtime/contracts/IRuntimeBehavior';

class StaticPromoterBlock {
    readonly key = { toString: () => 'static-promoter' } as any;
    readonly sourceIds: number[] = [];
    readonly label = 'static';
    readonly context: any = {};
    readonly behaviors: readonly any[] = [];
    readonly isComplete = false;
    private readonly _memory: MemoryLocation[] = [];

    constructor(memory: MemoryLocation[]) {
        this._memory = memory;
    }

    getAllMemory(): MemoryLocation[] { return this._memory; }
    getMemoryByTag(tag: string): MemoryLocation[] {
        return this._memory.filter(l => l.tag === tag);
    }
    getMetricMemoryByVisibility(visibility: string): MemoryLocation[] {
        // Map 'promote' visibility to the test's metric:promote locations.
        if (visibility === 'promote') {
            return this._memory.filter(l => l.tag === 'metric:promote' || l.tag === 'metric:rep-target');
        }
        return [];
    }
    pushMemory(loc: MemoryLocation): void { this._memory.push(loc); }
    markComplete(_reason?: string): void {}
}

class DynamicPromoterBehavior implements IRuntimeBehavior, IMetricPromoter {
    onMount() { return []; }
    onNext() { return []; }
    onUnmount() { return []; }
    onDispose() {}
    getPromotedFragments(_runtime: IScriptRuntime, _block: IRuntimeBlock): MetricContainer {
        return MetricContainer.from([{
            type: MetricType.Resistance,
            value: 100 as any,
            origin: 'execution' as MetricOrigin,
            image: '100kg',
        } as IMetric]);
    }
}

class DynamicPromoterBlock {
    readonly key = { toString: () => 'dynamic-promoter' } as any;
    readonly sourceIds: number[] = [];
    readonly label = 'dynamic';
    readonly context: any = {};
    readonly isComplete = false;
    readonly behaviors: readonly any[];
    private readonly _memory: MemoryLocation[] = [];

    constructor() {
        this.behaviors = [new DynamicPromoterBehavior()];
    }

    getAllMemory(): MemoryLocation[] { return this._memory; }
    getMemoryByTag(_tag: string): MemoryLocation[] { return []; }
    getMetricMemoryByVisibility(_v: string): MemoryLocation[] { return []; }
    pushMemory(loc: MemoryLocation): void { this._memory.push(loc); }
    markComplete(_reason?: string): void {}
}

const noopRuntime = {} as IScriptRuntime;

describe('PromotionResolver', () => {
    it('returns empty when no parent block is provided', () => {
        const resolver = new PromotionResolver();
        const result = resolver.resolvePromotions(undefined, noopRuntime);
        expect(result.promotedFragments).toEqual([]);
        expect(result.hasPromotions).toBe(false);
    });

    it('surfaces static `metric:promote` memory from the parent', () => {
        const resistanceFragment: IMetric = {
            type: MetricType.Resistance,
            value: 75 as any,
            origin: 'parser' as MetricOrigin,
            image: '75kg',
        } as IMetric;
        const block = new StaticPromoterBlock([
            new MemoryLocation('metric:promote', [resistanceFragment]),
        ]);

        const resolver = new PromotionResolver();
        const result = resolver.resolvePromotions(block as unknown as IRuntimeBlock, noopRuntime);

        expect(result.hasPromotions).toBe(true);
        expect(result.promotedFragments).toHaveLength(1);
        expect(result.promotedFragments[0].type).toBe(MetricType.Resistance);
        expect(result.promotedFragments[0].value).toBe(75);
    });

    it('merges dynamic promotions from `IMetricPromoter` behaviors', () => {
        const block = new DynamicPromoterBlock();
        const resolver = new PromotionResolver();
        const result = resolver.resolvePromotions(block as unknown as IRuntimeBlock, noopRuntime);

        expect(result.hasPromotions).toBe(true);
        expect(result.promotedFragments).toHaveLength(1);
        // The dynamic promotion supplies the value 100kg.
        expect(result.promotedFragments[0].value).toBe(100);
        expect(result.promotedFragments[0].origin).toBe('execution');
    });

    it('dynamic promotion overrides static promotion of the same type', () => {
        const staticFragment: IMetric = {
            type: MetricType.Resistance,
            value: 50 as any,
            origin: 'parser' as MetricOrigin,
            image: '50kg',
        } as IMetric;
        const block = new DynamicPromoterBlock();
        (block as any)._memory = [
            new MemoryLocation('metric:promote', [staticFragment]),
        ];
        (block as any).getMetricMemoryByVisibility = (v: string) => {
            if (v === 'promote') return (block as any)._memory;
            return [];
        };
        const resolver = new PromotionResolver();
        const result = resolver.resolvePromotions(block as unknown as IRuntimeBlock, noopRuntime);

        expect(result.hasPromotions).toBe(true);
        // Only one Resistance fragment survives — the dynamic one wins.
        const resistanceEntries = result.promotedFragments.filter(f => f.type === MetricType.Resistance);
        expect(resistanceEntries).toHaveLength(1);
        expect(resistanceEntries[0].value).toBe(100);
    });
});
