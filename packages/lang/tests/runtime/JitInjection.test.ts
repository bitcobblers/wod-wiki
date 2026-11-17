import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JitCompiler } from '../../src/runtime/compiler/JitCompiler';
import { IScriptRuntime } from '../../src/runtime/contracts/IScriptRuntime';
import { IRuntimeBlock } from '../../src/runtime/contracts/IRuntimeBlock';
import { ParsedCodeStatement, ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { IRuntimeBlockStrategy } from '../../src/runtime/contracts/IRuntimeBlockStrategy';
import { BlockBuilder } from '../../src/runtime/compiler/BlockBuilder';
import { DurationMetric } from '../../src/runtime/compiler/metrics/DurationMetric';
import { MemoryLocation } from '../../src/runtime/memory/MemoryLocation';

class MockStrategy implements IRuntimeBlockStrategy {
    priority = 100;
    capturedNodes: ICodeStatement[] = [];

    match(_nodes: ICodeStatement[], _runtime: IScriptRuntime): boolean {
        return true;
    }
    apply(builder: BlockBuilder, nodes: ICodeStatement[], _runtime: IScriptRuntime): void {
        this.capturedNodes = nodes;
        builder.setBlockType("MockBlock");
        // Must provide context and key to build successfully
        builder.setContext({} as any).setKey({} as any);
    }
}

describe("JIT Compiler Injection", () => {
    let runtime: IScriptRuntime;
    let compiler: JitCompiler;
    let parentBlock: IRuntimeBlock;

    beforeEach(() => {
        parentBlock = {
            getMetricMemoryByVisibility: vi.fn((visibility) => {
                if (visibility === 'promote') {
                    // Return a memory location with a promoted timer metrics
                    const timerFragment = new DurationMetric("60", { line: 0 } as any);
                    const loc = new MemoryLocation('metric:promote', [timerFragment]);
                    return [loc];
                }
                return [];
            }),
            behaviors: [],
            // Mock other required props slightly to satisfy TS if needed (though 'as any' covers it)
        } as any;

        runtime = {
            stack: {
                current: null
            },
            memory: { search: () => undefined },
        } as any;
        compiler = new JitCompiler();
    });

    it("should inject promoted metrics from parent block into child statements", () => {
        // Setup parent on stack
        (runtime.stack as any).current = parentBlock;

        // Register a mock strategy to capture the nodes passed to apply
        const strategy = new MockStrategy();
        compiler.registerStrategy(strategy);

        // Child node
        const childNode = new ParsedCodeStatement();
        childNode.metrics = [];

        // Compile
        compiler.compile([childNode], runtime);

        // Verify injection
        expect(strategy.capturedNodes.length).toBe(1);
        const injectedFragments = strategy.capturedNodes[0].metrics;
        expect(injectedFragments.length).toBeGreaterThan(0);

        const metrics = injectedFragments[0]; // Injected should be first (appended to empty)
        expect(metrics).toBeDefined();
        expect(metrics.type).toBe(MetricType.Duration);
        expect((metrics as DurationMetric).image).toBe("60");
    });

    it("should append promoted metrics to existing metrics", () => {
        // Setup parent on stack
        (runtime.stack as any).current = parentBlock;

        const strategy = new MockStrategy();
        compiler.registerStrategy(strategy);

        // Child node with existing metrics
        const childNode = new ParsedCodeStatement();
        const existingFragment = new DurationMetric("30", { line: 0 } as any);
        childNode.metrics = [existingFragment];

        compiler.compile([childNode], runtime);

        expect(strategy.capturedNodes.length).toBe(1);
        const metrics = strategy.capturedNodes[0].metrics;
        expect(metrics.length).toBe(2);

        // According to our logic: [...node.metrics, ...promotedFragments]
        // So existing first, promoted second
        expect(metrics[0]).toBe(existingFragment);
        expect((metrics[1] as DurationMetric).image).toBe("60");
    });

    it("should respect origin precedence when sorting metrics", () => {
        // Setup parent with higher precedence metric (compiler)
        parentBlock = {
            getMetricMemoryByVisibility: vi.fn((visibility) => {
                if (visibility === 'promote') {
                    const timerFragment = new DurationMetric("60", { line: 0 } as any);
                    (timerFragment as any).origin = 'compiler'; // Higher precedence (rank 2)
                    const loc = new MemoryLocation('metric:promote', [timerFragment]);
                    return [loc];
                }
                return [];
            }),
            behaviors: [],
        } as any;
        (runtime.stack as any).current = parentBlock;

        const strategy = new MockStrategy();
        compiler.registerStrategy(strategy);

        // Child node with lower precedence metrics (parser, rank 3)
        const childNode = new ParsedCodeStatement();
        const existingFragment = new DurationMetric("30", { line: 0 } as any);
        (existingFragment as any).origin = 'parser';
        childNode.metrics = [existingFragment];

        compiler.compile([childNode], runtime);

        expect(strategy.capturedNodes.length).toBe(1);
        const compiledNode = strategy.capturedNodes[0] as ParsedCodeStatement;

        // Check getFragment behavior directly on the node (simulating behavior consumption)
        // Since clone preserves prototype, getMetric() should work
        // However, ParsedCodeStatement inherits CodeStatement methods.
        // Let's manually trigger the sort logic or just inspect order.

        // Default sort logic:
        // Rank(Compiler) = 2
        // Rank(Parser) = 3
        // Sort Ascending (smallest rank first) -> Compiler first.

        // BUT wait, CodeStatement.getAllMetricsByType sorts by rank.
        // If clone is created via Object.create(Object.getPrototypeOf(node)),
        // it should have getFragment method.

        // Let's verify getFragment works.
        const effectiveFragment = compiledNode.getMetric(MetricType.Duration);
        expect(effectiveFragment).toBeDefined();
        // Should be the one with higher precedence (compiler i.e. "60")
        expect((effectiveFragment as DurationMetric).image).toBe("60");
    });
});
