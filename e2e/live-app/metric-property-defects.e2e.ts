import { expect, test, type Page } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';
import { getNoteContentByRouteId, seedNote, WOD_DB } from '../helpers/wodwikiDb';
import { TEST_IDS } from '../contracts/TestIdContract';
import { currentDocument, replaceDocument } from '../utils/noteEditor';

function documentWith(frontmatter: readonly string[], statement: string): string {
  return [
    '---',
    ...frontmatter,
    '---',
    '',
    '```time',
    statement,
    '```',
    '',
  ].join('\n');
}

async function openAndRun(page: Page, id: string, document: string): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
  await seedNote(page, `playground/${id}`, document, { type: 'playground', title: id });
  await page.goto(`/playground/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.cm-content[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });
  const play = page.getByRole('button', { name: 'Play', exact: true }).first();
  await expect(play).toBeVisible({ timeout: 15_000 });
  await play.evaluate((element) => (element as HTMLElement).click());
  await page.waitForURL(/\/(tracker|run)\//, { timeout: 15_000 });
  await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first()).toBeVisible({ timeout: 15_000 });
  return pageErrors;
}

async function completeWorkout(page: Page): Promise<void> {
  const complete = page.getByText('Workout Complete', { exact: true });
  for (let step = 0; step < 4; step += 1) {
    if (await complete.isVisible().catch(() => false)) return;
    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
    await complete.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  }
  await expect(complete).toBeVisible({ timeout: 10_000 });
}

function resultRow(page: Page, metric: string) {
  return page.getByRole('row').filter({ hasText: metric });
}

test.describe('Property Note metric and summary acceptance', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
  });

  test('note metrics emit a valued totalWork summary and WQL returns the saved fact', async ({ page }) => {
    const errors = await openAndRun(page, 'metric-note-summary', documentWith([
      'title: Metric Note Summary',
      'metrics.work: reps * resistance',
      'summaries.totalWork: sum(work)',
    ], '10 Kettlebell Swings 24kg'));
    await completeWorkout(page);

    const summaryValues = await page.evaluate(async ({ dbName, noteId }) => {
      const open = Promise.withResolvers<IDBDatabase>();
      const request = indexedDB.open(dbName);
      request.onsuccess = () => open.resolve(request.result);
      request.onerror = () => open.reject(request.error);
      const db = await open.promise;
      const read = Promise.withResolvers<Array<{ grain?: string; noteId?: string; metrics?: Array<Record<string, unknown>> }>>();
      const tx = db.transaction('events', 'readonly');
      const query = tx.objectStore('events').getAll();
      query.onsuccess = () => read.resolve(query.result);
      query.onerror = () => read.reject(query.error);
      const events = await read.promise;
      db.close();
      return events
        .filter((event) => event.grain === 'summary' && event.noteId === noteId)
        .flatMap((event) => event.metrics ?? [])
        .filter((metric) => (metric.metadata as { canonicalKey?: string } | undefined)?.canonicalKey === 'totalWork')
        .map((metric) => metric.value);
    }, { dbName: WOD_DB, noteId: 'playground/metric-note-summary' });
    expect(summaryValues).toEqual([240]);

    await expect(resultRow(page, 'totalWork')).toContainText('240');
    expect(errors).toEqual([]);

    await page.goto(`/notes?q=${encodeURIComponent('sum:totalWork{} by {session}')}`, { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    expect(errors).toEqual([]);
    await expect(page.getByText(/240(?:\s*kg)?/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('a note summary overrides the tonnage tag without crashing Run', async ({ page }) => {
    const errors = await openAndRun(page, 'metric-summary-override', documentWith([
      'title: Metric Summary Override',
      'tags: [tonnage]',
      'summaries.totalWork: sum(work) * 2',
    ], '10 Kettlebell Swings'));
    await completeWorkout(page);

    await expect(resultRow(page, 'totalWork')).toContainText('480 kg');
    expect(errors).toEqual([]);

    await page.goto(`/notes?q=${encodeURIComponent('sum:totalWork{} by {session}')}`, { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await expect(page.getByText(/480 kg/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('inline tonnage supplies resistance, work, and the default summary', async ({ page }) => {
    const errors = await openAndRun(page, 'metric-inline-tonnage', documentWith([
      'title: Metric Inline Tonnage',
    ], '10 Kettlebell Swings #tonnage'));
    await completeWorkout(page);

    await expect(resultRow(page, 'Kettlebell Swings')).toContainText('24 kg');
    await expect(resultRow(page, 'Kettlebell Swings')).toContainText('240 kg');
    await expect(resultRow(page, 'totalWork')).toContainText('240');
    expect(errors).toEqual([]);
  });

  test('Tag Category metrics reach child-tagged statements', async ({ page }) => {
    await page.goto('/t/domain', { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await page.getByRole('button', { name: 'Edit YAML' }).click();
    const source = await currentDocument(page);
    const edited = source.replace('\n---\n', '\nmetrics.resistance: 12 kg\n---\n');
    await replaceDocument(page, edited);
    await page.getByRole('button', { name: 'Save Category Note' }).click();
    await expect.poll(() => getNoteContentByRouteId(page, 't/domain'), { timeout: 15_000 })
      .toContain('metrics.resistance: 12 kg');

    const errors = await openAndRun(page, 'metric-category-contribution', documentWith([
      'title: Metric Category Contribution',
      'tags: [crossfit]',
      'metrics.work: reps * resistance',
    ], '10 Kettlebell Swings'));
    await completeWorkout(page);

    const row = resultRow(page, 'Kettlebell Swings');
    await expect(row).toContainText('12 kg');
    await expect(row).toContainText('120 kg');
    expect(errors).toEqual([]);
  });

  test('a timed statement resolves chained work and power metrics', async ({ page }) => {
    const errors = await openAndRun(page, 'metric-chained-power', documentWith([
      'title: Metric Chained Power',
      'metrics.work: reps * resistance',
      'metrics.power: work / convert(elapsed, s)',
    ], '0:01 5 Deadlifts 100kg'));
    await completeWorkout(page);

    await expect(resultRow(page, 'Deadlifts')).toContainText('500');
    const powerIndex = await page.locator('thead tr').first().getByRole('columnheader').evaluateAll(
      (headers) => headers.findIndex((header) => header.textContent?.trim() === 'Power'),
    );
    expect(powerIndex).toBeGreaterThanOrEqual(0);
    const powerCell = resultRow(page, 'Deadlifts').getByRole('cell').nth(powerIndex);
    const powerValue = Number.parseFloat(await powerCell.innerText());
    expect(powerValue).toBeGreaterThan(450);
    expect(powerValue).toBeLessThan(550);
    expect(errors).toEqual([]);
  });

  test('a missing dependency saves with a visible diagnostic naming the input', async ({ page }) => {
    const errors = await openAndRun(page, 'metric-missing-dependency', documentWith([
      'title: Metric Missing Dependency',
      'metrics.work: reps * resistance',
    ], '12 Thrusters'));
    await completeWorkout(page);

    await expect(page.getByText(/Skipped work/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/missing resistance/i)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
