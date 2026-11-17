import { describe, it, expect } from 'vitest';
import { SnapshotClock, RuntimeClock, createMockClock } from '@bitcobblers/wod-wiki-engine';

describe('SnapshotClock', () => {
    describe('constructor and factory methods', () => {
        it('should create snapshot with SnapshotClock.at()', () => {
            const realClock = new RuntimeClock();
            const frozenTime = new Date('2024-01-01T12:00:00Z');
            const snapshot = SnapshotClock.at(realClock, frozenTime);

            expect(snapshot.now()).toEqual(frozenTime);
        });

        it('should create snapshot with SnapshotClock.now()', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const snapshot = SnapshotClock.now(mockClock);

            expect(snapshot.now()).toEqual(mockClock.now());
        });

        it('should create snapshot via constructor', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const frozenTime = new Date('2024-06-15T10:30:00Z');
            const snapshot = new SnapshotClock(mockClock, frozenTime);

            expect(snapshot.now()).toEqual(frozenTime);
        });
    });

    describe('frozen time behavior', () => {
        it('should return frozen time from now property', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const frozenTime = new Date('2024-01-01T12:00:00Z');
            const snapshot = SnapshotClock.at(mockClock, frozenTime);

            expect(snapshot.now()).toEqual(frozenTime);
            expect(snapshot.now().getTime()).toBe(frozenTime.getTime());
        });

        it('should not change now even after underlying clock advances', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const frozenTime = new Date('2024-01-01T12:00:00Z');
            const snapshot = SnapshotClock.at(mockClock, frozenTime);

            // Advance the underlying mock clock
            mockClock.advance(5000);

            // Snapshot should still return frozen time
            expect(snapshot.now().getTime()).toBe(frozenTime.getTime());

            // But underlying clock has advanced
            expect(mockClock.now().getTime()).toBe(new Date('2024-01-01T12:00:05Z').getTime());
        });

        it('should return same frozen time on multiple accesses', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const frozenTime = new Date('2024-01-01T12:00:00Z');
            const snapshot = SnapshotClock.at(mockClock, frozenTime);

            const first = snapshot.now();
            const second = snapshot.now();
            const third = snapshot.now();

            expect(first).toEqual(second);
            expect(second).toEqual(third);
        });
    });

    describe('delegation to underlying clock', () => {
        it('should delegate elapsed to underlying clock', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            mockClock.start();
            mockClock.advance(5000);

            const snapshot = SnapshotClock.now(mockClock);

            // Elapsed should reflect underlying clock's simulated elapsed time while running
            expect(snapshot.elapsed).toBe(5000);
            expect(snapshot.elapsed).toBe(mockClock.elapsed);

            // Advance further while running to verify dynamic delegation
            mockClock.advance(3000);
            expect(snapshot.elapsed).toBe(8000);
            expect(snapshot.elapsed).toBe(mockClock.elapsed);

            // Stop the clock and advance to verify delegation on closed spans
            mockClock.stop();
            mockClock.advance(2000); // Does not increase elapsed after stop
            expect(snapshot.elapsed).toBe(8000);
            expect(snapshot.elapsed).toBe(mockClock.elapsed);
        });

        it('should delegate isRunning to underlying clock', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));

            // Not running initially
            const snapshotStopped = SnapshotClock.now(mockClock);
            expect(snapshotStopped.isRunning).toBe(false);

            // Start the clock
            mockClock.start();
            const snapshotRunning = SnapshotClock.now(mockClock);
            expect(snapshotRunning.isRunning).toBe(true);
        });

        it('should delegate spans to underlying clock', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            mockClock.start();
            mockClock.advance(1000);
            mockClock.stop();
            mockClock.advance(500);
            mockClock.start();

            const snapshot = SnapshotClock.now(mockClock);

            expect(snapshot.spans).toBe(mockClock.spans);
            expect(snapshot.spans.length).toBe(2);
        });

        it('should delegate start() to underlying clock', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const snapshot = SnapshotClock.at(mockClock, new Date('2024-06-15T10:30:00Z'));

            // Initially not running
            expect(mockClock.isRunning).toBe(false);

            // Start via snapshot
            const startTime = snapshot.start();

            // Underlying clock should now be running
            expect(mockClock.isRunning).toBe(true);
            expect(startTime).toEqual(mockClock.now());
        });

        it('should delegate stop() to underlying clock', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            mockClock.start();
            mockClock.advance(1000);

            const snapshot = SnapshotClock.at(mockClock, new Date('2024-06-15T10:30:00Z'));

            // Stop via snapshot
            const stopTime = snapshot.stop();

            // Underlying clock should now be stopped
            expect(mockClock.isRunning).toBe(false);
            expect(stopTime).toEqual(mockClock.now());
        });
    });

    describe('use case: execution chain timing', () => {
        it('should provide consistent time for pop → next → push chain', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            mockClock.start();

            // Timer "expires" at this moment
            mockClock.advance(180000); // 3 minutes
            const createdAt = mockClock.now();

            // Create snapshot at completion time
            const snapshot = SnapshotClock.at(mockClock, createdAt);

            // Simulate time passing during pop/next/push processing
            mockClock.advance(5); // 5ms of processing time

            // All operations in the chain should see the same time
            expect(snapshot.now()).toEqual(createdAt);
            expect(snapshot.now().getTime()).toBe(createdAt.getTime());

            // Even after more processing time
            mockClock.advance(10);
            expect(snapshot.now()).toEqual(createdAt);
        });

        it('should allow multiple snapshots at different times', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            mockClock.start();

            // First timer expires
            mockClock.advance(60000);
            const firstComplete = mockClock.now();
            const firstSnapshot = SnapshotClock.at(mockClock, firstComplete);

            // Second timer expires
            mockClock.advance(30000);
            const secondComplete = mockClock.now();
            const secondSnapshot = SnapshotClock.at(mockClock, secondComplete);

            // Each snapshot maintains its own frozen time
            expect(firstSnapshot.now().getTime()).toBe(60000 + new Date('2024-01-01T12:00:00Z').getTime());
            expect(secondSnapshot.now().getTime()).toBe(90000 + new Date('2024-01-01T12:00:00Z').getTime());
        });
    });

    describe('edge cases', () => {
        it('should handle frozen time in the past', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const pastTime = new Date('2023-01-01T00:00:00Z');
            const snapshot = SnapshotClock.at(mockClock, pastTime);

            expect(snapshot.now()).toEqual(pastTime);
        });

        it('should handle frozen time in the future', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const futureTime = new Date('2025-12-31T23:59:59Z');
            const snapshot = SnapshotClock.at(mockClock, futureTime);

            expect(snapshot.now()).toEqual(futureTime);
        });

        it('should work with RuntimeClock (not just mock)', () => {
            const realClock = new RuntimeClock();
            const frozenTime = new Date('2024-01-01T12:00:00Z');
            const snapshot = SnapshotClock.at(realClock, frozenTime);

            expect(snapshot.now()).toEqual(frozenTime);
            expect(snapshot.isRunning).toBe(realClock.isRunning);
            expect(snapshot.spans).toBe(realClock.spans);
        });

        it('should be nestable (snapshot of snapshot)', () => {
            const mockClock = createMockClock(new Date('2024-01-01T12:00:00Z'));
            const firstFreeze = new Date('2024-01-01T12:00:00Z');
            const firstSnapshot = SnapshotClock.at(mockClock, firstFreeze);

            // Create a snapshot of the snapshot (unusual but should work)
            const secondFreeze = new Date('2024-06-15T10:30:00Z');
            const nestedSnapshot = SnapshotClock.at(firstSnapshot, secondFreeze);

            expect(nestedSnapshot.now()).toEqual(secondFreeze);
            // Delegation should still work through the chain
            expect(nestedSnapshot.isRunning).toBe(mockClock.isRunning);
        });
    });
});
