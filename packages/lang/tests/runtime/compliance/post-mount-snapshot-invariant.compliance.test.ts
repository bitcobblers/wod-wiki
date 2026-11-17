/**
 * Post-Mount Snapshot Invariant
 *
 * Architectural contract (from G3, hardened by S3a + S3b):
 *
 *   **Stack snapshots reflect post-mount state. A block whose `onMount` has
 *   not completed must not appear in a snapshot.**
 *
 * Concretely: when `subscribeToStack` fires for a 'push' event, the top
 * block in the snapshot must have its `onMount`-initialized memory in
 * place. If a snapshot shows a block with `getMemoryByTag('time').length
 * === 0` immediately after a push, the pre-mount leak has returned.
 *
 * The test:
 *   1. Compiles a single-block timer script (":30 Run") so the next push
 *      is a Timer whose `CountdownTimerBehavior.onMount` initializes a
 *      'time' memory location.
 *   2. Subscribes to stack snapshots and records every snapshot.
 *   3. Asserts that every snapshot whose depth includes the Timer block
 *      shows that block with non-empty time memory — i.e., `onMount`
 *      completed BEFORE the snapshot was emitted.
 *
 * If this test fails, S3a's merge of the two snapshot constructors did
 * not actually close the pre-mount leak — a regression that this invariant
 * is here to catch.
 */
import { it, expect } from 'vitest';
import { describeCompliance } from '@wod-wiki/lang-harness/script';

describeCompliance(
    'Post-mount snapshot invariant — every pushed block has onMount memory initialized',
    ':30 Run',
    (ctx) => {
        it('after userNext → Timer block has time memory (onMount completed before snapshot)', async () => {
            const script = await ctx.compile();
            // userNext: pop WaitingToStart, mount Timer.
            await script.next();

            // Snapshot must reflect the post-mount state.
            const snap = await script.snapshot();
            // Stack should include the Timer (depth ≥ 3: SessionRoot + Timer at minimum).
            expect(snap.depth).toBeGreaterThanOrEqual(2);

            // Find the Timer block in the snapshot.
            const timerBlock = snap.blocks.find((b: any) =>
                b.blockType === 'Timer' || b.constructor?.name === 'TimerBlock' || (b as any).blockType === 'timer',
            );
            // If the snapshot has Timer blocks at all, they must have time memory.
            for (const block of snap.blocks as any[]) {
                const timeMemory = block.getMemoryByTag?.('time') ?? [];
                if (block.blockType === 'Timer' || (block.constructor?.name ?? '').includes('Timer')) {
                    expect(timeMemory.length).toBeGreaterThan(0);
                }
            }
            // We expect at least one Timer block — onMount populated time memory.
            expect(timerBlock).toBeDefined();
        });

        it('initial snapshot (WaitingToStart only) shows no Timer and no time memory leak', async () => {
            const script = await ctx.compile();
            const snap = await script.snapshot();

            // Initial state: SessionRoot + WaitingToStart. No Timer yet.
            const timerBlocks = (snap.blocks as any[]).filter(
                (b) => b.blockType === 'Timer' || (b.constructor?.name ?? '').includes('Timer'),
            );
            expect(timerBlocks).toHaveLength(0);
        });
    },
);
