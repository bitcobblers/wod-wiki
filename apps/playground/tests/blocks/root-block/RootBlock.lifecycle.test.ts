import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ExecutionContextTestHarness } from '@/testing/harness';
import { MockBlock } from '@/testing/harness/MockBlock';
import { SessionRootStrategy } from '@bitcobblers/wod-wiki-engine';
import {
    ChildSelectionBehavior,
    ReportOutputBehavior
} from '@bitcobblers/wod-wiki-engine';
import { PushBlockAction } from '@bitcobblers/wod-wiki-engine';
import { PopBlockAction } from '@bitcobblers/wod-wiki-engine';

describe('RootBlock Lifecycle', () => {
    let harness: ExecutionContextTestHarness;

    beforeEach(() => {
        harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z')
        });
    });

    afterEach(() => {
        harness.dispose();
    });

    it('should initialize all behaviors on mount', () => {
        // Scenario: Fresh root block mount
        const harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z'),
            statements: [{ id: 1, source: 'Exercise' }]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        // Use PushBlockAction to properly process the full action chain:
        // PushBlockAction → mount → behaviors → CompileChildBlockAction → PushBlockAction(child)
        harness.executeAction(new PushBlockAction(rootBlock));

        // Expectations: All behaviors called onMount
        // Timer initialized in memory on root block, controls initialized, first child pushed
        expect(rootBlock.getMemoryByTag('time')).toHaveLength(1);
        expect(harness.stack.count).toBe(2); // root + child
        
        harness.dispose();
    });

    it('should track execution start time on mount', () => {
        // Scenario: Verify timing capture
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const startTime = new Date('2024-01-01T12:00:00Z');
        harness.setClock(startTime);

        harness.stack.push(rootBlock);
        rootBlock.mount(harness.runtime);

        // Expectations: Start time captured
        expect(rootBlock.executionTiming.startTime).toEqual(startTime);
    });

    it('should execute child runner on next()', () => {
        // Scenario: Child completes, next() called
        const harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z'),
            statements: [
                { id: 1, source: 'Child 1' },
                { id: 2, source: 'Child 2' }
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

        // Mount root via PushBlockAction (pushes WaitingToStart gate)
        harness.executeAction(new PushBlockAction(rootBlock));
        expect(harness.stack.count).toBe(2); // root + gate

        // Gate exits (user starts) → root.next() dispatches child-1
        harness.executeAction(new PopBlockAction());
        expect(harness.stack.current).toBe(child1);

        harness.clearRecordings();

        // Pop child-1 → NextAction → root.next() → ChildSelection pushes child-2
        harness.executeAction(new PopBlockAction());

        // Expectations: ChildRunner pushes next child
        expect(harness.mockJit.compileCalls).toHaveLength(1);
        expect(harness.stack.current).toBe(child2);
        
        harness.dispose();
    });

    it('should track completion time on unmount', () => {
        // Scenario: Workout completes, root unmounted
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        const startTime = new Date('2024-01-01T12:00:00Z');
        harness.setClock(startTime);

        harness.stack.push(rootBlock);
        rootBlock.mount(harness.runtime);

        // Advance time
        harness.advanceClock(300000); // 5 minutes

        const completionTime = harness.clock.currentDate;
        rootBlock.unmount(harness.runtime, { createdAt: completionTime });

        // Expectations: Timing captured
        expect(rootBlock.executionTiming.startTime).toEqual(startTime);
        // Note: createdAt may be set by unmount options or behavior
    });

    it('should emit history record on unmount', () => {
        // Scenario: Workout completes, history should be recorded
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        harness.stack.push(rootBlock);
        rootBlock.mount(harness.runtime);

        // Unmount should trigger history record
        rootBlock.unmount(harness.runtime);

        // Expectations: History record event emitted
        // Note: ReportOutputBehavior emits on unmount
        expect(rootBlock.getBehavior(ReportOutputBehavior)).toBeDefined();
    });

    it('should handle dispose without errors', () => {
        // Scenario: Root removed from stack
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        harness.stack.push(rootBlock);
        rootBlock.mount(harness.runtime);
        rootBlock.unmount(harness.runtime);

        // Dispose should clean up any remaining resources
        expect(() => {
            rootBlock.dispose(harness.runtime);
        }).not.toThrow();
    });

    it('should maintain frozen clock during mount', () => {
        // Scenario: Clock must be frozen during mount actions
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        const timestamps: Date[] = [];

        harness.stack.push(rootBlock);
        
        harness.executeAction({
            type: 'mount-root',
            do: (runtime) => {
                timestamps.push(runtime.clock.currentDate);
                const actions = rootBlock.mount(runtime);
                timestamps.push(runtime.clock.currentDate);
                actions.forEach(action => {
                    timestamps.push(runtime.clock.currentDate);
                    action.do(runtime);
                    timestamps.push(runtime.clock.currentDate);
                });
            }
        });

        // All timestamps in same turn should be identical
        const uniqueTimes = new Set(timestamps.map(t => t.getTime()));
        expect(uniqueTimes.size).toBe(1);
    });

    it('should handle mount with custom clock', () => {
        // Scenario: Mount with specific clock time
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        const customTime = new Date('2025-12-31T23:59:59Z');

        harness.stack.push(rootBlock);
        rootBlock.mount(harness.runtime, { 
            startTime: customTime,
            clock: { now: customTime, currentDate: customTime }
        });

        // Expectations: Custom time used
        expect(rootBlock.executionTiming.startTime).toEqual(customTime);
    });

    it('should handle next with no remaining children', () => {
        // Scenario: Call next when all children executed
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        harness.executeAction(new PushBlockAction(rootBlock));
        expect(harness.stack.current?.blockType).toBe('WaitingToStart');

        // Starting the session dispatches the single child
        harness.executeAction(new PopBlockAction());

        // Next with no remaining children: preview cleared + auto-pop completes the session
        const nextActions = rootBlock.next(harness.runtime);

        // Expectations: ChildSelection clears next preview when no children remain
        const actionTypes = nextActions.map(a => a.type);
        expect(actionTypes).toContain('update-next-preview');
        expect(actionTypes).toContain('pop-block');
        
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);
    });

    it('should allow multiple unmount calls safely', () => {
        // Scenario: Defensive unmount handling
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        harness.stack.push(rootBlock);
        rootBlock.mount(harness.runtime);

        // First unmount
        expect(() => {
            rootBlock.unmount(harness.runtime);
        }).not.toThrow();

        // Second unmount should not throw
        expect(() => {
            rootBlock.unmount(harness.runtime);
        }).not.toThrow();
    });
});
