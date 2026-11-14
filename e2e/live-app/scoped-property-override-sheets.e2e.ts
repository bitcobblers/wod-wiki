// spec: e2e/specs/properties/scoped-property-override-sheets.md
import type { Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { WOD_DB } from '../helpers/wodwikiDb';
import { getSessions } from '../utils/sessionsDb';

interface SummaryMetricsMap {
  [metricKey: string]: number;
}

async function readSessionSummaryMetrics(page: Page, sessionId: string): Promise<SummaryMetricsMap> {
  return page.evaluate(
    async ({ dbName, sid }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains('events')) return {};
        const rows = await new Promise<
          Array<{
            resultId?: string;
            grain?: string;
            metrics?: Array<{ type?: string; value?: unknown }>;
          }>
        >((resolve, reject) => {
          const tx = db.transaction('events', 'readonly');
          const req = tx.objectStore('events').getAll();
          req.onsuccess = () => resolve(req.result as typeof rows);
          req.onerror = () => reject(tx.error);
        });
        const out: Record<string, number> = {};
        for (const row of rows) {
          if (row.resultId !== sid || row.grain !== 'summary') continue;
          for (const metric of row.metrics ?? []) {
            if (typeof metric.type === 'string' && typeof metric.value === 'number') {
              out[metric.type] = metric.value;
            }
          }
        }
        return out;
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, sid: sessionId },
  );
}

async function runWorkoutNoteToCompletion(page: Page, noteId: string): Promise<string> {
  await page.goto(`/note/${encodeURIComponent(noteId)}`, { waitUntil: 'domcontentloaded' });
  const startBtn = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
  await expect(startBtn).toBeVisible({ timeout: 15_000 });
  await startBtn.click();

  const closeBtn = page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
  await expect(closeBtn).toBeVisible({ timeout: 15_000 });

  const readyHeading = page.getByRole('heading', { name: 'Ready to Start' });
  await expect(readyHeading).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();

  const reviewDialog = page.getByRole('dialog', { name: 'Workout Complete' });
  await expect(reviewDialog).toBeVisible({ timeout: 20_000 });
  await closeBtn.click();
  await expect(reviewDialog).toBeHidden({ timeout: 10_000 });

  await expect
    .poll(
      async () => {
        const rows = await getSessions(page, noteId);
        return rows.find((r) => r.completed === true)?.id ?? '';
      },
      { timeout: 15_000 },
    )
    .not.toBe('');

  const rows = await getSessions(page, noteId);
  const completed = rows.find((r) => r.completed === true);
  if (!completed?.id) {
    throw new Error(`Expected completed session for note ${noteId}`);
  }
  return completed.id;
}

test.describe('PRP-04 — Scoped Property Override Sheets & Runtime Precedence', () => {
  test('Scenario 1: Coach creates and edits a Notebook-scoped Effort override across mobile and desktop without mutating the bundled Effort', async ({
    app,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const clubName = `KB Club ${suffix}`;

    // 1. Create a user Notebook and open /effort/kettlebell-swing at 375x812 mobile viewport
    await app.notebooks.openLibrary();
    await app.notebooks.create(clubName, 'Heavy kettlebell club overrides');
    const nbMatch = app.page.url().match(/\/notebook\/([^/?#]+)/);
    expect(nbMatch?.[1]).toBeTruthy();
    const nbSlug = decodeURIComponent(nbMatch![1]!);
    const targetNotebookId = `notebook/${nbSlug}`;

    await app.page.setViewportSize({ width: 375, height: 812 });
    const kbDetail = await app.properties.openEffort('kettlebell-swing');
    await kbDetail.waitForDetailLoaded();
    await expect(kbDetail.detailSource()).toHaveText('Bundled');

    const metInput = kbDetail.frontmatterProperties().getByLabel('Value for metrics.met');
    await expect(metInput).toHaveValue('9.8');

    await app.page.getByTestId('effort-detail-override-btn').click();
    const sheet = app.page.getByTestId(TEST_IDS.PROPERTY_OVERRIDE_SHEET);
    await expect(sheet).toBeVisible();

    const mobileOverflow = await app.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(mobileOverflow).toBeLessThanOrEqual(0);

    await app.properties.saveScopedOverride(targetNotebookId);
    await expect(app.page).toHaveURL(
      new RegExp(`/effort/kettlebell-swing\\?notebook=${encodeURIComponent(targetNotebookId)}$`),
      { timeout: 15_000 },
    );

    // 2. Return to desktop viewport, update scoped Effort metrics.met -> 30, and verify persistence across reload
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await kbDetail.waitForDetailLoaded();
    await expect(kbDetail.detailSource()).toContainText(`Scoped · ${nbSlug}`);

    const scopedMetInput = kbDetail.frontmatterProperties().getByLabel('Value for metrics.met');
    await scopedMetInput.fill('30');
    await scopedMetInput.press('Enter');

    await expect
      .poll(() => app.editor.readStoredContent(`override/${nbSlug}/effort/kettlebell-swing`), {
        timeout: 15_000,
      })
      .toContain('30');

    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await kbDetail.waitForDetailLoaded();
    await expect(kbDetail.detailSource()).toContainText(`Scoped · ${nbSlug}`);
    await expect(kbDetail.frontmatterProperties().getByLabel('Value for metrics.met')).toHaveValue('30');

    // 3. Global bundled /effort/kettlebell-swing remains untouched at 9.8
    await app.page.getByTestId('effort-detail-global-link').click();
    await expect(app.page).toHaveURL(/\/effort\/kettlebell-swing$/);
    await kbDetail.waitForDetailLoaded();
    await expect(kbDetail.detailSource()).toHaveText('Bundled');
    await expect(kbDetail.frontmatterProperties().getByLabel('Value for metrics.met')).toHaveValue('9.8');

    app.assertCleanConsole();
  });

  test('Scenario 2: Recorded Session derived Metrics honor Notebook-scoped Effort override precedence over un-scoped Notes', async ({
    app,
  }) => {
    test.setTimeout(90_000);
    const suffix = Date.now().toString().slice(-6);
    const nbSlug = `kb-precedence-${suffix}`;
    const targetNotebookId = `notebook/${nbSlug}`;
    const scopedNoteId = `note-scoped-kb-${suffix}`;
    const unscopedNoteId = `note-unscoped-kb-${suffix}`;
    const workoutMarkdown = '# Kettlebell Swing Sprint\n\n```time\n:12 Kettlebell Swing\n```\n';

    await app.runtime.useFastClock(20);
    await app.goto('/');

    // 1. Seed the user Notebook, Scoped Property Override (met: 30), Notebook-scoped Note, and un-scoped Note
    await app.seed.world({
      propertyNotes: [
        {
          kind: 'effort',
          slug: 'kettlebell-swing',
          label: 'Kettlebell Swing',
          aliases: ['kettlebell swings', 'kb swing'],
          baseAttributes: { met: 30, discipline: 'kettlebell', intensityTier: 'high' },
          notebookId: targetNotebookId,
          asOverride: true,
        },
      ],
      notes: [
        {
          id: scopedNoteId,
          title: `Scoped KB Sprint ${suffix}`,
          rawContent: workoutMarkdown,
          notebookIds: [targetNotebookId],
        },
        {
          id: unscopedNoteId,
          title: `Unscoped KB Sprint ${suffix}`,
          rawContent: workoutMarkdown,
        },
      ],
    });

    // 2. Execute the Notebook-scoped Note via fastClock and capture its derived Session summary metrics
    const scopedSessionId = await runWorkoutNoteToCompletion(app.page, scopedNoteId);
    await expect
      .poll(async () => Object.keys(await readSessionSummaryMetrics(app.page, scopedSessionId)).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const scopedSummary = await readSessionSummaryMetrics(app.page, scopedSessionId);

    // 3. Execute the un-scoped Note via fastClock and assert Notebook-scoped Effort override precedence
    const unscopedSessionId = await runWorkoutNoteToCompletion(app.page, unscopedNoteId);
    await expect
      .poll(async () => Object.keys(await readSessionSummaryMetrics(app.page, unscopedSessionId)).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const unscopedSummary = await readSessionSummaryMetrics(app.page, unscopedSessionId);

    expect(scopedSummary['calc.metMinutes']).toBeGreaterThan(unscopedSummary['calc.metMinutes']! * 2);
    expect(scopedSummary['calc.metMinutes']).toBeGreaterThanOrEqual(5);
    expect(unscopedSummary['calc.metMinutes']).toBeGreaterThan(0);
    expect(scopedSummary['tis']).toBeGreaterThan(unscopedSummary['tis']!);

    app.assertCleanConsole();
  });
});
