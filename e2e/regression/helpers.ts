import { expect, type PlaygroundTestActor } from '../fixtures/playgroundActor';
import type { Locator, Page } from '@playwright/test';

/** Load the bundled sample corpus via the explorer prompt (populated-corpus path). */
export async function loadSampleData(app: PlaygroundTestActor): Promise<void> {
  const { page } = app;
  await app.wql.openExplorer('sum:totalVolume{} by {week}');
  const sampleBtn = page.getByRole('button', { name: /Preview with sample data/i });
  const purgeBtn = page.getByRole('button', { name: /Purge sample data/i });
  await expect(sampleBtn.or(purgeBtn)).toBeVisible({ timeout: 20_000 });
  if (await sampleBtn.isVisible()) {
    await sampleBtn.click();
    await expect(purgeBtn).toBeVisible({ timeout: 30_000 });
  }
}

/** Collect trimmed non-empty Y-axis tick labels from a Recharts chart scope. */
export async function yAxisTickTexts(scope: Page | Locator): Promise<string[]> {
  const ticks = scope.locator(
    '.recharts-yAxis-tick-labels text, .recharts-yAxis .recharts-cartesian-axis-tick text',
  );
  const texts: string[] = [];
  for (const tick of await ticks.all()) {
    texts.push(((await tick.textContent()) ?? '').trim());
  }
  return texts.filter(Boolean);
}
