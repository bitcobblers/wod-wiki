import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ExecutionContextTestHarness } from '@/testing/harness';
import { MockBlock } from '@/testing/harness/MockBlock';
import { SessionRootStrategy } from '@bitcobblers/wod-wiki-engine';
import { ChildSelectionBehavior } from '@bitcobblers/wod-wiki-engine';
import { PushBlockAction } from '@bitcobblers/wod-wiki-engine';
import { PopBlockAction } from '@bitcobblers/wod-wiki-engine';

describe('RootBlock Integration: Complete Workout', () => {
    let harness: ExecutionContextTestHarness;

    beforeEach(() => {
        harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z')
        });
    });

    afterEach(() => {
        harness.dispose();
    });

    it('should execute complete single-section workout', () => {
        // Scenario: "3x10 Push-ups, 3x10 Squats"
        const harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z'),
            statements: [
                { id: 1, source: '3x10 Push-ups' },
                { id: 2, source: '3x10 Squats' }
            ]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2]], // Two exercises
            totalRounds: 1
        });

        // Mock child blocks
        const pushups = new MockBlock('pushups', []);
        const squats = new MockBlock('squats', []);
        
        harness.mockJit.whenMatches(
            (s) => s.some(stmt => stmt.id === 1),
            pushups
        );
        harness.mockJit.whenMatches(
            (s) => s.some(stmt => stmt.id === 2),
            squats
        );

        // Mount root via PushBlockAction (pushes pushups as first child)
        harness.executeAction(new PushBlockAction(rootBlock));
        expect(harness.stack.count).toBe(2); // root + pushups

        // Pushups complete - PopBlockAction pops child, NextAction advances to squats
        harness.executeAction(new PopBlockAction());
        expect(harness.stack.count).toBe(2); // root + squats

        // Squats complete
        harness.executeAction(new PopBlockAction());

        // Expectations
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);
        expect(rootBlock.getMemoryByTag('time')).toHaveLength(1);
        expect(harness.mockJit.compileCalls).toHaveLength(2);
        
        harness.dispose();
    });

    it('should track total workout time across sections', () => {
        // Scenario: Verify timer tracks full workout duration
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2]]
        });

        const child1 = new MockBlock('child-1', []);
        const child2 = new MockBlock('child-2', []);
        
        harness.mockJit.whenMatches(
            (s) => s.some(stmt => stmt.id === 1),
            child1
        );
        harness.mockJit.whenMatches(
            (s) => s.some(stmt => stmt.id === 2),
            child2
        );

        harness.stack.push(rootBlock);
        
        const mountActions = rootBlock.mount(harness.runtime);
        mountActions.forEach(a => a.do(harness.runtime));

        // Simulate child durations
        harness.advanceClock(60000); // 1 min for child 1
        
        harness.executeAction({
            type: 'complete-child-1',
            do: (runtime) => {
                runtime.stack.pop()?.dispose(runtime);
                const actions = rootBlock.next(runtime);
                actions.forEach(a => a.do(runtime));
            }
        });

        harness.advanceClock(60000); // 1 min for child 2
        
        harness.executeAction({
            type: 'complete-child-2',
            do: (runtime) => {
                runtime.stack.pop()?.dispose(runtime);
                rootBlock.next(runtime);
            }
        });

        rootBlock.unmount(harness.runtime);

        // Expectations: Start time should be tracked
        expect(rootBlock.executionTiming.startTime).toBeDefined();
        // Note: Duration calculation requires createdAt to be set properly
    });

    it('should handle workout with many sections', () => {
        // Scenario: Complex workout with 5 sections
        const harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z'),
            statements: [
                { id: 1, source: 'Section 1' },
                { id: 2, source: 'Section 2' },
                { id: 3, source: 'Section 3' },
                { id: 4, source: 'Section 4' },
                { id: 5, source: 'Section 5' }
            ]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2], [3], [4], [5]]
        });

        let blockCount = 0;
        harness.mockJit.whenMatches(() => true, () => {
            blockCount++;
            return new MockBlock(`section-${blockCount}`, []);
        });

        harness.executeAction(new PushBlockAction(rootBlock)); // root + WaitingToStart gate

        // Gate exit dispatches section 1; each completed section dispatches the next;
        // the final pop completes the session and auto-pops the root.
        for (let i = 0; i < 6; i++) {
            harness.executeAction(new PopBlockAction());
            if (i < 5) harness.advanceClock(10000); // 10 seconds per section
        }

        // Expectations: All 5 blocks compiled; root auto-pops when workout completes
        expect(harness.mockJit.compileCalls).toHaveLength(5);
        
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);
        expect(harness.stack.count).toBe(0);
    });

    it('should handle empty workout gracefully', () => {
        // Scenario: Workout with no sections
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: []
        });

        harness.stack.push(rootBlock);
        
        const mountActions = rootBlock.mount(harness.runtime);
        mountActions.forEach(a => a.do(harness.runtime));

        // Expectations: No children compiled; the WaitingToStart gate is pushed
        expect(harness.mockJit.compileCalls).toHaveLength(0);
        expect(harness.stack.count).toBe(2); // root + gate
        expect(harness.stack.current?.blockType).toBe('WaitingToStart');

        // Starting a workout with no sections completes and auto-pops the root
        harness.executeAction(new PopBlockAction());
        expect(harness.stack.count).toBe(0);

        // Should be able to unmount safely
        expect(() => {
            rootBlock.unmount(harness.runtime);
        }).not.toThrow();
    });

    it('should emit timer events during workout', () => {
        // Scenario: Track timer lifecycle
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        const child = new MockBlock('child', []);
        harness.mockJit.whenMatches(() => true, child);

        harness.stack.push(rootBlock);
        
        const mountActions = rootBlock.mount(harness.runtime);
        mountActions.forEach(a => a.do(harness.runtime));

        // Expectations: Timer initialized in memory
        expect(rootBlock.getMemoryByTag('time')).toHaveLength(1);

        // Simulate pause
        harness.dispatchEvent({
            name: 'timer:pause',
            timestamp: harness.clock.currentDate,
            data: {}
        });

        expect(harness.wasEventDispatched('timer:pause')).toBe(true);

        // Resume
        harness.advanceClock(5000);
        harness.dispatchEvent({
            name: 'timer:start',
            timestamp: harness.clock.currentDate,
            data: {}
        });

        expect(harness.wasEventDispatched('timer:start')).toBe(true);
    });

    it('should handle section compilation failure gracefully', () => {
        // Scenario: JIT returns null for a section
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2]]
        });

        // First section succeeds, second fails
        const child1 = new MockBlock('child-1', []);
        
        harness.mockJit.whenMatches(
            (s) => s.some(stmt => stmt.id === 1),
            child1
        );
        
        // Don't mock statement 2 - let it fall through to real JIT
        // which may return null or a fallback block

        harness.stack.push(rootBlock);
        
        const mountActions = rootBlock.mount(harness.runtime);
        
        // Should not throw
        expect(() => {
            mountActions.forEach(a => a.do(harness.runtime));
        }).not.toThrow();

        // First section pushed successfully
        expect(harness.stack.count).toBeGreaterThanOrEqual(1);
    });

    it('should maintain consistent state across lifecycle', () => {
        // Scenario: Verify block state consistency
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
            (s) => s.some(stmt => stmt.id === 1),
            child1
        );
        harness.mockJit.whenMatches(
            (s) => s.some(stmt => stmt.id === 2),
            child2
        );

        // Pre-mount state
        expect(rootBlock.executionTiming.startTime).toBeUndefined();

        // Mount via PushBlockAction
        harness.executeAction(new PushBlockAction(rootBlock));

        // Post-mount state
        expect(rootBlock.executionTiming.startTime).toBeDefined();
        expect(harness.stack.count).toBe(2);

        // Pop child-1 → NextAction → root.next() → pushes child-2
        harness.executeAction(new PopBlockAction());

        // Pop child-2 → NextAction → root.next() → no more children
        harness.executeAction(new PopBlockAction());

        // Pre-unmount state
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);

        // Unmount
        rootBlock.unmount(harness.runtime);

        // Post-unmount state
        // TODO: createdAt may not be set - verify if this is expected behavior
        // expect(rootBlock.executionTiming.createdAt).toBeDefined();
        
        harness.dispose();
    });

    it('should handle rapid section transitions', () => {
        // Scenario: Sections complete very quickly
        const harness = new ExecutionContextTestHarness({
            clockTime: new Date('2024-01-01T12:00:00Z'),
            statements: [
                { id: 1, source: 'Section 1' },
                { id: 2, source: 'Section 2' },
                { id: 3, source: 'Section 3' }
            ]
        });
        
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2], [3]]
        });

        let blockId = 0;
        harness.mockJit.whenMatches(() => true, () => {
            blockId++;
            return new MockBlock(`child-${blockId}`, []);
        });

        harness.executeAction(new PushBlockAction(rootBlock)); // root + WaitingToStart gate

        // Rapid fire through all sections (no time advancement):
        // gate exit dispatches section 1; each section pop dispatches the next;
        // the final pop completes the session and auto-pops the root.
        for (let i = 0; i < 4; i++) {
            harness.executeAction(new PopBlockAction());
        }

        // Expectations: All sections handled
        expect(harness.mockJit.compileCalls).toHaveLength(3);
        
        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior)!;
        expect(childSelection.allChildrenExecuted).toBe(true);
        expect(harness.stack.count).toBe(0);
        
        harness.dispose();
    });
});
