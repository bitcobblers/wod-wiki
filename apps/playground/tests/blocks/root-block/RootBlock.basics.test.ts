import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ExecutionContextTestHarness } from '@/testing/harness';
import { SessionRootStrategy } from '@bitcobblers/wod-wiki-engine';
import {
    CountupTimerBehavior,
    ChildSelectionBehavior,
    LabelingBehavior,
    ButtonBehavior,
    ReportOutputBehavior
} from '@bitcobblers/wod-wiki-engine';

describe('RootBlock Behavior Composition', () => {
    let harness: ExecutionContextTestHarness;

    beforeEach(() => {
        harness = new ExecutionContextTestHarness();
    });

    afterEach(() => {
        harness.dispose();
    });

    it('should include all required behaviors for single-round workout', () => {
        // Scenario: Create root block with single round
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1], [2], [3]],
            totalRounds: 1
        });

        // Expectations: All core behaviors present
        expect(rootBlock.getBehavior(CountupTimerBehavior)).toBeDefined();
        expect(rootBlock.getBehavior(ChildSelectionBehavior)).toBeDefined();
        expect(rootBlock.getBehavior(LabelingBehavior)).toBeDefined();
        expect(rootBlock.getBehavior(ButtonBehavior)).toBeDefined();
        expect(rootBlock.getBehavior(ReportOutputBehavior)).toBeDefined();
    });

    it('should use default totalRounds=1 when not specified', () => {
        // Scenario: No totalRounds specified
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]]
        });

        // Expectations: Single round configuration
        expect(rootBlock).toBeDefined();
        expect(rootBlock.blockType).toBe('SessionRoot');
    });

    it('should configure ChildSelectionBehavior with correct childGroups', () => {
        // Scenario: Multiple child groups
        const childGroups = [[1, 2], [3], [4, 5]];
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups
        });

        const childSelection = rootBlock.getBehavior(ChildSelectionBehavior);
        expect(childSelection).toBeDefined();

        // Verify sourceIds include all statements
        expect(rootBlock.sourceIds).toEqual([1, 2, 3, 4, 5]);
    });

    it('should use custom execution buttons when provided', () => {
        // Scenario: Custom control buttons
        const customButtons = [
            { id: 'custom-pause', label: 'Hold', action: 'timer:pause' },
            { id: 'skip', label: 'Skip', action: 'block:skip' }
        ];

        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]],
            executionButtons: customButtons
        });

        const controls = rootBlock.getBehavior(ButtonBehavior);
        expect(controls).toBeDefined();
    });

    it('should handle empty childGroups', () => {
        // Scenario: Root block with no children
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: []
        });

        expect(rootBlock).toBeDefined();
        expect(rootBlock.sourceIds).toEqual([]);
        expect(rootBlock.getBehavior(ChildSelectionBehavior)).toBeDefined();
    });

    it('should set correct block type and label', () => {
        // Scenario: Verify root block metadata
        const rootBlock = new SessionRootStrategy().build(harness.runtime, {
            childGroups: [[1]],
            label: 'Workout'
        });

        expect(rootBlock.blockType).toBe('SessionRoot');
        expect(rootBlock.label).toBe('Workout');
    });
});
