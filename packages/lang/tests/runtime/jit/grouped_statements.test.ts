import { describe, it, expect } from 'vitest';
import { MdTimerRuntime } from '@bitcobblers/wod-wiki-engine';
import { JitCompiler } from '@bitcobblers/wod-wiki-engine';
import { EffortFallbackStrategy } from '@bitcobblers/wod-wiki-engine';
import { ChildrenStrategy } from '@bitcobblers/wod-wiki-engine';
import { GenericGroupStrategy } from '@bitcobblers/wod-wiki-engine';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { createMockClock } from '@bitcobblers/wod-wiki-engine';
import { ScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { RuntimeStack } from '@bitcobblers/wod-wiki-engine';
import { EventBus } from '@bitcobblers/wod-wiki-engine';

describe('Grouped Statements Compilation', () => {
    const parser = new MdTimerRuntime();
    const strategies = [
        new GenericGroupStrategy(),
        new EffortFallbackStrategy(),
        new ChildrenStrategy()
    ];
    const compiler = new JitCompiler(strategies);

    const createRuntime = (script: string) => {
        const wod = parser.read(script);
        return new ScriptRuntime(wod, compiler, {
            stack: new RuntimeStack(),
            clock: createMockClock(),
            eventBus: new EventBus()
        });
    };

    it('compiles grouped statements (+) into a single block with metrics from all statements', () => {
        const script = `
(3 rounds):
  - 10 Burpees
  + 10 Pushups
`.trim();
        const runtime = createRuntime(script);
        const result = runtime.script;
        
        // Find the parent block
        const parentStatement = result.statements.find(s => s.children.length > 0);
        expect(parentStatement).toBeDefined();
        
        // 3 Rounds should have one group of children if they are grouped by +
        expect(parentStatement!.children).toHaveLength(1);
        expect(parentStatement!.children[0]).toHaveLength(2);

        const childIds = parentStatement!.children[0];
        const childStatements = childIds.map(id => result.getId(id)!);

        // Compile the group
        const block = compiler.compile(childStatements as ICodeStatement[], runtime);
        expect(block).toBeDefined();

        // Check source IDs in block
        expect(block!.sourceIds).toHaveLength(2);
        expect(block!.sourceIds).toContain(childStatements[0].id);
        expect(block!.sourceIds).toContain(childStatements[1].id);

        // Check metrics in block memory
        const displayFragments = block!.getMemoryByTag('metric:display').flatMap(loc => loc.metrics.toArray());
        
        const reps = displayFragments.filter(f => f.type === MetricType.Rep);
        const efforts = displayFragments.filter(f => f.type === MetricType.Effort);

        // Should contain metrics from BOTH statements
        expect(reps).toHaveLength(2);
        expect(efforts).toHaveLength(2);
    });

    // TODO: Split proportional outputs for grouped statements.
    // Blocked: the current output statement model emits one combined segment
    // per block, not per-statement-within-a-group. Implementing split
    // proportional elapsed/total across grouped children requires a new
    // output splitting strategy in ReportOutputBehavior.
    // Track: https://github.com/user/wod-wiki/issues/TBD
    it.todo('emits split proportional outputs for grouped statements');
});
