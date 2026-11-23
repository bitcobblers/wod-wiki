import { it, expect } from 'vitest';
import { describeCompliance } from '@wod-wiki/lang-harness/script';
import { blockDisplayMetrics } from '@wod-wiki/lang-harness/compliance-helpers';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describeCompliance(
  'WW-077 — AMRAP live run advances from gate through movement 1 into movement 2',
  '20:00 AMRAP\n  10 Burpees\n  15 Kettlebell Swings 24kg\n  20 Air Squats',
  (ctx) => {
    it('advances from gate to Burpees (10) and then to Kettlebell Swings (15) without errors', async () => {
      const script = await ctx.compile();

      // Gate -> movement 1 (10 Burpees)
      await script.next();
      // Movement 1 -> movement 2 (15 Kettlebell Swings 24kg)
      await script.next();

      const snap = await script.snapshot();
      const displayMetrics = blockDisplayMetrics(snap);
      const effort = displayMetrics.find((m) => m.type === MetricType.Effort);
      expect(String(effort?.value ?? '')).toMatch(/Kettlebell Swings/i);

      const rep = displayMetrics.find((m) => m.type === MetricType.Rep && typeof m.value === 'number');
      expect(rep?.value).toBe(15);
    });
  },
);

describeCompliance(
  'WW-077 — childless header-only AMRAP exits cleanly on Next without deadlocking',
  '20:00 AMRAP',
  (ctx) => {
    it('advances from gate into the childless AMRAP block and exits cleanly on Next', async () => {
      const script = await ctx.compile();

      // Gate -> AMRAP block
      await script.next();
      let snap = await script.snapshot();
      expect(snap.stackDepth).toBeGreaterThanOrEqual(1);

      // Next exits immediately without error
      await script.next();
      snap = await script.snapshot();
      expect(snap.stackDepth).toBe(0);
    });
  },
);
