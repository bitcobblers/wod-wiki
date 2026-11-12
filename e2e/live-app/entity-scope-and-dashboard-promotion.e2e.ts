// spec: e2e/specs/analytics/entity-scope-and-dashboard-promotion.md
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';

const NOTE_ID = '01950000-0000-7000-8000-000000000777';
const CONTENT = '# Session Results Table\n\n```time\n5:00 AMRAP\n  5 Kettlebell Swings\n```\n';

test('session EventRecord table filters segments via the WQL query bar (?q= sync) and promotes the Entity Scope query to /dashboards', async ({ app }) => {
  await app.page.setViewportSize({ width: 1280, height: 900 });

  const seeded = await app.seed.world({
    propertyNotes: [
      { kind: 'effort', slug: 'kettlebell-swing', label: 'Kettlebell Swing', aliases: ['KB Swing'] },
      { kind: 'effort', slug: 'burpee', label: 'Burpee' },
    ],
    notes: [{ id: NOTE_ID, title: 'Session Results Table', rawContent: CONTENT }],
    sessions: [
      {
        id: 'sess-anl-04-kb',
        noteId: NOTE_ID,
        events: [
          {
            grain: 'event',
            outputType: 'segment',
            effortSlug: 'kettlebell-swing',
            metrics: [
              { type: 'effort', value: 'kettlebell-swing', origin: 'parser' },
              { type: 'tis', value: 74, unit: 's', metadata: { canonicalKey: 'tis' } },
            ],
          },
        ],
      },
      {
        id: 'sess-anl-04-burpee',
        noteId: NOTE_ID,
        events: [
          {
            grain: 'event',
            outputType: 'segment',
            effortSlug: 'burpee',
            metrics: [
              { type: 'effort', value: 'burpee', origin: 'parser' },
              { type: 'tis', value: 30, unit: 's', metadata: { canonicalKey: 'tis' } },
            ],
          },
        ],
      },
    ],
  });
  const sessionId = seeded.sessionIds[0]!;

  // 1. Tabular EventRecord inspection on /results/:sessionId
  await app.goto(`/results/${sessionId}`);
  const table = app.page.getByTestId(TEST_IDS.PROPERTY_TABLE);
  await expect(table).toBeVisible();
  await expect(table).toContainText('kettlebell-swing');

  // 2. Segment filtering through the stream query bar with ?q= URL synchronization
  const filteredQuery = `:session{plane:segment,effort:kettlebell-swing}`;
  const encodedQuery = encodeURIComponent(filteredQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await app.wql.fillStreamQueryBar(filteredQuery);
  await expect(app.page).toHaveURL(new RegExp(`\\?q=${encodedQuery}`));
  await expect(table.locator('tbody')).toContainText('kettlebell-swing');
  await expect(table.locator('tbody')).not.toContainText('burpee');
  // 3. Promote the filtered Entity Scope query into WidgetComposerDialog and inspect /dashboards?q=
  await app.page.getByTestId(TEST_IDS.SAVE_STREAM_QUERY).click();
  await expect(app.page.getByTestId(TEST_IDS.WIDGET_COMPOSER_SUBSET)).toHaveText(filteredQuery);
  await expect(app.page.getByTestId(TEST_IDS.WIDGET_COMPOSER_WQL)).toHaveText(filteredQuery);
  await expect(app.page.getByTestId(TEST_IDS.WIDGET_COMPOSER_APPLY)).toBeEnabled();
  await app.page.keyboard.press('Escape');

  await app.wql.openExplorer(filteredQuery);
  await expect(app.page).toHaveURL(new RegExp(`/dashboards\\?q=${encodedQuery}`));
  app.assertCleanConsole();
});
