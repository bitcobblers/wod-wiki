import { expect, type PlaygroundTestActor } from '../fixtures/playgroundActor';
import type { Locator, Page } from '@playwright/test';

/** Load the bundled sample corpus via the explorer prompt (populated-corpus path). */
export async function loadSampleData(app: PlaygroundTestActor): Promise<void> {
  const { page } = app;
  await app.wql.openExplorer('sum:totalVolume{} by {week}');
  const sampleBtn = page.getByRole('button', { name: /Preview with sample data/i });
  if (await sampleBtn.isVisible().catch(() => false)) {
    await sampleBtn.click();
    await expect(page.getByRole('button', { name: /Purge sample data/i })).toBeVisible({
      timeout: 30_000,
    });
  }
}

/** Collect trimmed non-empty Y-axis tick labels from a Recharts chart scope. */
export async function yAxisTickTexts(scope: Page | Locator): Promise<string[]> {
  const ticks = scope.locator('.recharts-yAxis .recharts-cartesian-axis-tick text');
  const texts: string[] = [];
  for (const tick of await ticks.all()) {
    texts.push(((await tick.textContent()) ?? '').trim());
  }
  return texts.filter(Boolean);
}
