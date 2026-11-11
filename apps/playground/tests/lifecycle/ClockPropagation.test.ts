import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SnapshotClock, createMockClock } from '@bitcobblers/wod-wiki-engine';
import { BehaviorTestHarness, MockBlock } from '@/testing/harness';
import { IRuntimeBehavior } from '@bitcobblers/wod-wiki-engine';
import { IBehaviorContext } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeAction } from '@bitcobblers/wod-wiki-engine';

/**
 * Test behavior that captures the clock.now value on each lifecycle method.
 * Used to verify clock propagation through the lifecycle chain.
 */
class ClockCaptureBehavior implements IRuntimeBehavior {
    public mountClock: Date | null = null;
    public nextClocks: Date[] = [];
    public unmountClock: Date | null = null;

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        this.mountClock = ctx.clock.currentDate;
        return [];
    }

    onNext(ctx: IBehaviorContext): IRuntimeAction[] {
        this.nextClocks.push(ctx.clock.currentDate);
        return [];
    }

    onUnmount(ctx: IBehaviorContext): IRuntimeAction[] {
        this.unmountClock = ctx.clock.currentDate;
        return [];
    }

    onDispose(): void {
        // No cleanup needed for test behavior
    }
}

describe('Clock Propagation Integration', () => {
    let harness: BehaviorTestHarness;
    const initialTime = new Date('2024-01-01T12:00:00.000Z');

    beforeEach(() => {
        harness = new BehaviorTestHarness().withClock(initialTime);
    });

    afterEach(() => {
        harness?.dispose();
    });

    describe('SnapshotClock in lifecycle options', () => {
        it('should use snapshot clock time for mount when provided', () => {
            const behavior = new ClockCaptureBehavior();
            const block = new MockBlock('test-block', [behavior]);

            const snapshotTime = new Date('2024-01-01T12:05:00.000Z');
            const snapshot = SnapshotClock.at(harness.clock, snapshotTime);

            harness.push(block);
            harness.mount({ clock: snapshot });

            expect(behavior.mountClock).toEqual(snapshotTime);
        });

        it('should use snapshot clock time for next when provided', () => {
            const behavior = new ClockCaptureBehavior();
            const block = new MockBlock('test-block', [behavior]);

            harness.push(block);
            harness.mount();

            // Advance real clock
            harness.advanceClock(5000);

            const snapshotTime = new Date('2024-01-01T12:03:00.000Z');
            const snapshot = SnapshotClock.at(harness.clock, snapshotTime);

            harness.next({ clock: snapshot });

            expect(behavior.nextClocks[0]).toEqual(snapshotTime);
        });

        it('should use snapshot clock time for unmount when provided', () => {
            const behavior = new ClockCaptureBehavior();
            const block = new MockBlock('test-block', [behavior]);

            harness.push(block);
            harness.mount();

            const snapshotTime = new Date('2024-01-01T12:10:00.000Z');
            const snapshot = SnapshotClock.at(harness.clock, snapshotTime);

            harness.unmount({ clock: snapshot });

            expect(behavior.unmountClock).toEqual(snapshotTime);
        });
    });

    describe('frozen time consistency', () => {
        it('should maintain consistent time across multiple next calls with same snapshot', () => {
            const behavior = new ClockCaptureBehavior();
            const block = new MockBlock('test-block', [behavior]);

            harness.push(block);
            harness.mount();

            const snapshotTime = new Date('2024-01-01T12:05:00.000Z');
            const snapshot = SnapshotClock.at(harness.clock, snapshotTime);

            // Multiple next calls with same snapshot
            harness.next({ clock: snapshot });
            harness.advanceClock(1000); // Advance underlying clock
            harness.next({ clock: snapshot });
            harness.advanceClock(2000); // Advance more
            harness.next({ clock: snapshot });

            // All should have the same frozen time
            expect(behavior.nextClocks).toHaveLength(3);
            expect(behavior.nextClocks[0]).toEqual(snapshotTime);
            expect(behavior.nextClocks[1]).toEqual(snapshotTime);
            expect(behavior.nextClocks[2]).toEqual(snapshotTime);
        });

        it('should use real clock when no snapshot provided', () => {
            const behavior = new ClockCaptureBehavior();
            const block = new MockBlock('test-block', [behavior]);

            harness.push(block);
            harness.mount();

            expect(behavior.mountClock).toEqual(initialTime);

            harness.advanceClock(5000);
            harness.next();

            // next() should use advanced time since no snapshot was provided
            expect(behavior.nextClocks[0].getTime()).toBe(initialTime.getTime() + 5000);
        });
    });

    describe('lifecycle chain timing', () => {
        it('should propagate same frozen time through mount-next-unmount chain', () => {
            const behavior = new ClockCaptureBehavior();
            const block = new MockBlock('test-block', [behavior]);

            const chainTime = new Date('2024-01-01T15:30:00.000Z');
            const snapshot = SnapshotClock.at(harness.clock, chainTime);

            harness.push(block);
            harness.mount({ clock: snapshot });
            harness.advanceClock(1000); // Advance between operations
            harness.next({ clock: snapshot });
            harness.advanceClock(2000); // Advance more
            harness.unmount({ clock: snapshot });

            // All lifecycle methods should see the same frozen time
            expect(behavior.mountClock).toEqual(chainTime);
            expect(behavior.nextClocks[0]).toEqual(chainTime);
            expect(behavior.unmountClock).toEqual(chainTime);
        });
    });
});
