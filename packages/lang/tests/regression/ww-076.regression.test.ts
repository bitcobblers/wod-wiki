import { it, expect } from 'vitest';
import { describeCompliance } from '@wod-wiki/lang-harness/script';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describeCompliance(
  'WW-076 — For Time 21-15-9 ladder rep target resolves to current rung',
  '21-15-9\n  Thrusters 42.5 kg',
  (ctx) => {
    it('first rung of 21-15-9 targets 21 reps, not 9', async () => {
      const script = await ctx.compile();
      await script.next(); // start -> WaitingToStart pops, 21-rep Thrusters pushed

      const snap = await script.snapshot();
      const displayMetrics = snap.blocks.flatMap((b) =>
        b.getMemoryByTag('metric:display').flatMap((loc) => loc.metrics.toArray()),
      );
      const repMetrics = displayMetrics.filter(
        (m) => m.type === MetricType.Rep && m.origin !== 'user' && typeof m.value === 'number',
      );
      expect(repMetrics.length).toBeGreaterThan(0);
      // On the first rung of 21-15-9, the last non-user rep metric on the block
      // resolves to the current rung's target (21), not the final rung (9).
      const lastRep = repMetrics[repMetrics.length - 1]!;
      expect(lastRep.value).toBe(21);
    });
  },
);
