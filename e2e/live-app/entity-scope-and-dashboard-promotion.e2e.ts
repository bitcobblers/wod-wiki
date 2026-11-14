// spec: e2e/specs/analytics/entity-scope-and-dashboard-promotion.md
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';

const RESULTS_NOTE_ID = '01950000-0000-7000-8000-000000000777';
const RESULTS_CONTENT =
  '# Session Results Table\n\n```time\n5:00 AMRAP\n  5 Kettlebell Swings\n  5 Burpees\n```\n';

const SUMMARY_ROUTE_ID = 'playground/anl-04-total-work';
const SUMMARY_CONTENT = [
  '---',
  'title: Metric Note Summary',
  'metrics.work: reps * resistance',
  'summaries.totalWork: sum(work)',
  '---',
  '',
  '# Metric Note Summary',
  '',
  '```time',
  '10 Kettlebell Swings 24kg',
  '```',
  '',
].join('\n');

test.describe('ANL-04 — Entity Scope & Dashboard Promotion', () => {
  test('multi-Effort Session EventRecord table filters segments via WQL (?q= sync), fits 375x812 mobile, and promotes Entity Scope to /dashboards', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const seeded = await app.seed.world({
      propertyNotes: [
        { kind: 'effort', slug: 'kettlebell-swing', label: 'Kettlebell Swing', aliases: ['KB Swing'] },
        { kind: 'effort', slug: 'burpee', label: 'Burpee' },
      ],
      notes: [{ id: RESULTS_NOTE_ID, title: 'Session Results Table', rawContent: RESULTS_CONTENT }],
      sessions: [
        {
          id: 'sess-anl-04-mixed',
          noteId: RESULTS_NOTE_ID,
          events: [
            {
              grain: 'event',
              outputType: 'segment',
              effortSlug: 'kettlebell-swing',
              metrics: [
                { type: 'effort', value: 'kettlebell-swing', origin: 'parser' },
                { type: 'tis', value: 74, unit: 's', ...{ metadata: { canonicalKey: 'tis' } } },
              ],
            },
            {
              grain: 'event',
              outputType: 'segment',
              effortSlug: 'burpee',
              metrics: [
                { type: 'effort', value: 'burpee', origin: 'parser' },
                { type: 'tis', value: 30, unit: 's', ...{ metadata: { canonicalKey: 'tis' } } },
              ],
            },
          ],
        },
      ],
    });
    const sessionId = seeded.sessionIds[0]!;

    // 1. Tabular EventRecord inspection on /results/:sessionId shows BOTH segment efforts before filtering
    await app.goto(`/results/${sessionId}`);
    const table = page.getByTestId(TEST_IDS.PROPERTY_TABLE);
    await expect(table).toBeVisible();
    await expect(table.locator('tbody')).toContainText(/kettlebell[\s-]swing/i);
    await expect(table.locator('tbody')).toContainText(/burpee/i);

    // Verify 375x812 mobile viewport renders PropertyTable without horizontal overflow
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(table).toBeVisible();
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(mobileOverflow, 'no horizontal overflow on /results/:sessionId at 375x812').toBe(false);
    await page.setViewportSize({ width: 1280, height: 900 });

    // 2. Segment filtering through the stream query bar narrows the SAME Session's rows
    const filteredQuery = `:segment{result:${sessionId},effort:kettlebell-swing}`;
    const encodedQuery = encodeURIComponent(filteredQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await app.wql.fillStreamQueryBar(filteredQuery);
    await expect(page).toHaveURL(new RegExp(`\\?q=${encodedQuery}`));
    await expect(table.locator('tbody')).toContainText(/kettlebell[\s-]swing/i);
    await expect(table.locator('tbody')).not.toContainText(/burpee/i);

    // 3. Promote the filtered Entity Scope query into WidgetComposerDialog and inspect /dashboards?q=
    await page.getByTestId(TEST_IDS.SAVE_STREAM_QUERY).click();
    await expect(page.getByTestId(TEST_IDS.WIDGET_COMPOSER_SUBSET)).toHaveText(filteredQuery);
    await expect(page.getByTestId(TEST_IDS.WIDGET_COMPOSER_WQL)).toHaveText(filteredQuery);
    await expect(page.getByTestId(TEST_IDS.WIDGET_COMPOSER_APPLY)).toBeEnabled();
    await page.keyboard.press('Escape');

    await app.wql.openExplorer(filteredQuery);
    await expect(page).toHaveURL(new RegExp(`/dashboards\\?q=${encodedQuery}`));
    app.assertCleanConsole();
  });

  test('Note frontmatter Metric Shake-Out emits a valued totalWork summary and surfaces it via WQL', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.seed.note(SUMMARY_ROUTE_ID, SUMMARY_CONTENT, {
      type: 'playground',
      title: 'Metric Note Summary',
    });

    await app.runtime.useFastClock(60);
    await app.goto(`/${SUMMARY_ROUTE_ID}`);
    await expect(page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first()).toBeVisible();
    await app.runtime.startWorkout();
    await expect(page).toHaveURL(/\/run\//);

    const completeBanner = page.getByText('Workout Complete', { exact: true });
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({ timeout: 10_000 });
    await app.runtime.advance(1);
    await expect(page.getByRole('heading', { name: /10 Kettlebell Swings/i })).toBeVisible({ timeout: 10_000 });
    await app.runtime.advance(1);
    await expect(completeBanner).toBeVisible({ timeout: 10_000 });

    const totalWorkRow = page.getByRole('row').filter({ hasText: 'totalWork' });
    await expect(totalWorkRow).toContainText('240');

    await app.wql.queryStream('/notes', 'sum:totalWork{} by {session}');
    await expect(page.getByText(/240(?:\s*kg)?/).first()).toBeVisible({ timeout: 15_000 });
    app.assertCleanConsole();
  });
});
