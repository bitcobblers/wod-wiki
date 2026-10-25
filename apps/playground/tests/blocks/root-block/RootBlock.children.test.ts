import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ExecutionContextTestHarness } from '@/testing/harness';
import { MockBlock } from '@/testing/harness/MockBlock';
import { SessionRootStrategy } from '@bitcobblers/wod-wiki-engine';
import { ChildSelectionBehavior } from '@bitcobblers/wod-wiki-engine';
import { PushBlockAction } from '@bitcobblers/wod-wiki-engine';
import { PopBlockAction } from '@bitcobblers/wod-wiki-engine';

describe('RootBlock Child Execution', () => {
    let harness: ExecutionContextTestHarness;

    beforeEach(() => {
        harness = new ExecutionContextTestHarness();
    });

    afterEach(() => {
        harness.dispose();
    });

    it('should gate on mount and push first child on first next', () => {
        // Scenario: Root block with 3 children
        const childGroups = [[1], [2], [3]];
        
        // Create harness with statements that match the IDs
        const harness = new ExecutionContextTestHarness({
            statements: [
                { id: 1, source: '10 Push-ups' },
                { id: 2, source: '15 Squats' },
                { id: 3, source: '20 Sit-ups' }
            ]
        });
        
        // Mock JIT to return child blocks
        const child1 = new MockBlock('child-1', []);
        const child2 = new MockBlock('child-2', []);
        const child3 = new MockBlock('child-3', []);
        
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 1),
            child1
        );
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 2),
            child2
        );
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 3),
            child3
        );

        // Create root block and push via PushBlockAction
        // ExecutionContext processes the full chain:
        // PushBlockAction → mount → WaitingToStart gate pushed (children deferred to first next)
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups
        });

        harness.executeAction(new PushBlockAction(rootBlock));

        // Expectations: Mount pushes only the WaitingToStart idle gate —
        // no child is compiled until the user starts the session
        expect(harness.mockJit.compileCalls).toHaveLength(0);
        expect(harness.stack.count).toBe(2); // root + gate
        expect(harness.stack.current?.blockType).toBe('WaitingToStart');

        // Gate exits (user starts) → root.next() dispatches the first child
        harness.executeAction(new PopBlockAction());

        expect(harness.mockJit.compileCalls).toHaveLength(1);
        expect(harness.mockJit.lastCompileCall?.statements[0].id).toBe(1);
        
        // Stack should have root + first child
        expect(harness.stack.count).toBe(2);
        expect(harness.stack.current).toBe(child1);
        
        harness.dispose();
    });

    it('should push next child when current completes', () => {
        // Scenario: Child completes (pops), root.next() called automatically
        const harness = new ExecutionContextTestHarness({
            statements: [
                { id: 1, source: 'Exercise 1' },
                { id: 2, source: 'Exercise 2' },
                { id: 3, source: 'Exercise 3' }
            ]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2], [3]]
        });

        const child1 = new MockBlock('child-1', []);
        const child2 = new MockBlock('child-2', []);
        
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 1),
            child1
        );
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 2),
            child2
        );

        // Mount root via PushBlockAction (pushes WaitingToStart gate)
        harness.executeAction(new PushBlockAction(rootBlock));
        expect(harness.stack.count).toBe(2); // root + gate

        // Gate exits (user starts) → root.next() dispatches child-1
        harness.executeAction(new PopBlockAction());
        expect(harness.stack.current).toBe(child1);

        // Clear recordings to isolate next behavior
        harness.clearRecordings();

        // Simulate child-1 completing by popping it
        // PopBlockAction pops child-1 → returns [NextAction] for parent root
        // NextAction calls root.next() → ChildSelectionBehavior pushes child-2
        harness.executeAction(new PopBlockAction());

        // Expectations: Second child compiled and pushed
        expect(harness.mockJit.compileCalls).toHaveLength(1);
        expect(harness.mockJit.lastCompileCall?.statements[0].id).toBe(2);
        expect(harness.stack.count).toBe(2); // root + child-2 (child-1 was popped)
        expect(harness.stack.current).toBe(child2);
        
        harness.dispose();
    });

    it('should handle empty childGroups gracefully', () => {
        // Scenario: No children to execute
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: []
        });

        harness.executeAction(new PushBlockAction(rootBlock));

        // Expectations: No compilation; the WaitingToStart gate is still pushed
        expect(harness.mockJit.compileCalls).toHaveLength(0);
        expect(harness.stack.count).toBe(2); // root + gate
        expect(harness.stack.current?.blockType).toBe('WaitingToStart');

        // Starting the session with no children completes and auto-pops the root
        harness.executeAction(new PopBlockAction());
        expect(harness.stack.count).toBe(0);
    });

    it('should mark completion when all children executed', () => {
        // Scenario: Last child completes
        const harness = new ExecutionContextTestHarness({
            statements: [
                { id: 1, source: 'Exercise 1' },
                { id: 2, source: 'Exercise 2' }
            ]
        });

        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2]]
        });

        const child1 = new MockBlock('child-1', []);
        const child2 = new MockBlock('child-2', []);
        
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 1),
            child1
        );
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 2),
            child2
        );

        // Mount root: pushes child-1
        harness.executeAction(new PushBlockAction(rootBlock));
        expect(harness.stack.count).toBe(2); // root + child-1

        // Pop child-1 → root.next() → pushes child-2
        harness.executeAction(new PopBlockAction());
        expect(harness.stack.count).toBe(2); // root + child-2

        // Pop child-2 → root.next() → no more children → no pop (root stays)
        harness.executeAction(new PopBlockAction());

        // Expectations: All children executed
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);
        
        harness.dispose();
    });

    it('should handle single child group', () => {
        // Scenario: Only one child
        const harness = new ExecutionContextTestHarness({
            statements: [{ id: 1, source: 'Single exercise' }]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child1 = new MockBlock('child-1', []);
        harness.mockJit.whenMatches(() => true, child1);

        // Mount root: pushes child-1
        harness.executeAction(new PushBlockAction(rootBlock));
        expect(harness.stack.count).toBe(2);

        // Pop child-1 → root.next() → no more children
        harness.executeAction(new PopBlockAction());
        
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);
        
        harness.dispose();
    });

    it('should handle multi-statement child groups', () => {
        // Scenario: Child group with multiple statements
        const childGroups = [[1, 2], [3, 4]];
        const harness = new ExecutionContextTestHarness({
            statements: [
                { id: 1, source: 'Statement 1' },
                { id: 2, source: 'Statement 2' },
                { id: 3, source: 'Statement 3' },
                { id: 4, source: 'Statement 4' }
            ]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups
        });

        const group1Block = new MockBlock('group-1', []);
        const group2Block = new MockBlock('group-2', []);
        
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 1 || s.id === 2),
            group1Block
        );
        harness.mockJit.whenMatches(
            (stmts) => stmts.some(s => s.id === 3 || s.id === 4),
            group2Block
        );

        // Mount root via PushBlockAction - gate pushed; starting dispatches first group
        harness.executeAction(new PushBlockAction(rootBlock));
        harness.executeAction(new PopBlockAction());

        // First group should be compiled with statements 1 and 2
        expect(harness.mockJit.compileCalls).toHaveLength(1);
        const firstCall = harness.mockJit.compileCalls[0];
        expect(firstCall.statements).toHaveLength(2);
        expect(firstCall.statements.map(s => s.id)).toContain(1);
        expect(firstCall.statements.map(s => s.id)).toContain(2);
        
        harness.dispose();
    });

    it('should handle missing statement IDs gracefully', () => {
        // Scenario: Statement IDs that don't exist
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[999]]
        });

        // Don't mock anything - let it fall through
        
        // Should not throw error when child IDs don't resolve
        expect(() => {
            harness.executeAction(new PushBlockAction(rootBlock));
        }).not.toThrow();

        // May still compile (with empty statements or fallback)
        // Stack count might be 1 (only root) or 2 (root + empty block)
        expect(harness.stack.count).toBeGreaterThanOrEqual(1);
    });
});
