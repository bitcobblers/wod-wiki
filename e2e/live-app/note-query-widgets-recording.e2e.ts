import { test, expect, type Page } from '@playwright/test';
import { WOD_DB, noteFixture } from '../helpers/wodwikiDb';
import { parseDocumentSections } from '../../packages/core/src/sections';
import { waitForFeedReady } from '../helpers/feedReadiness';

test.use({
  video: {
    mode: 'on',
    size: { width: 1440, height: 900 },
  },
  viewport: { width: 1440, height: 900 },
});

const NOTE_ID = 'playground/coach-training-review';
const ROUTE_PATH = `/playground/coach-training-review`;

const SESSION_1_ID = 'session-coach-001';
const SESSION_2_ID = 'session-coach-002';

const NOTE_CONTENT = `# Coach Training Review & Metric Queries

Logged heavy strength and conditioning session data for athlete review.

\`\`\`time
Timer: 15:00
5 Rounds:
  5 Back Squats 140kg
  15 Kettlebell Swings 32kg
  20 Burpees
\`\`\`

## Session Logged Workouts
Detailed movements, loads, and round splits recorded in this session:

\`\`\`query:table
:segment{result:${SESSION_1_ID}}
\`\`\`

## Athlete Benchmark Volume
Total volume accumulation across training blocks:

\`\`\`query:value
:segment{} | :sum{metric:totalVolume} | :value{}
\`\`\`

## Movement Distribution
Work distribution by effort:

\`\`\`query:bar
:segment{} | :sum{metric:tis} by {effort} | :bar{}
\`\`\`
`;

async function seedCoachNoteAndSessions(page: Page) {
  const fixture = noteFixture(NOTE_ID, NOTE_CONTENT, {
    title: 'Coach Training Review & Metric Queries',
    type: 'playground',
  });
  const workout = Object.values(fixture.note.blocks).find((b) => b.kind === 'wod');
  if (!workout) throw new Error('No workout in fixture');
  const rawContent = NOTE_CONTENT.slice(workout.from, workout.to);
  const contentId = parseDocumentSections(rawContent).find((s) => s.scriptBlock)?.contentId;
  if (!contentId) throw new Error('No contentId');

  await page.evaluate(
    async ({ dbName, noteId, fixture, blockId, blockVersion, contentId, s1, s2 }) => {
      const { promise: dbPromise, resolve: dbResolve, reject: dbReject } = Promise.withResolvers<IDBDatabase>();
      const req = indexedDB.open(dbName);
      req.onsuccess = () => dbResolve(req.result);
      req.onerror = () => dbReject(req.error);
      const db = await dbPromise;

      try {
        const { promise: txPromise, resolve: txResolve, reject: txReject } = Promise.withResolvers<void>();
        const tx = db.transaction(
          ['page', 'notes', 'block_revisions', 'block_index', 'sessions', 'events'],
          'readwrite',
        );
        const now = Date.now();

        tx.objectStore('notes').put(fixture.note);
        for (const row of fixture.revisions) tx.objectStore('block_revisions').put(row);
        for (const row of fixture.index) tx.objectStore('block_index').put(row);

        // Session 1
        tx.objectStore('sessions').put({
          id: s1,
          noteId,
          blockId,
          blockVersion,
          blockContentId: contentId,
          startTime: now - 3600_000,
          endTime: now - 2700_000,
          duration: 900_000,
          completed: true,
          status: 'completed',
          createdAt: now - 2700_000,
        });

        // Session 1 events
        tx.objectStore('events').put({
          id: `${s1}:0`,
          resultId: s1,
          noteId,
          blockId,
          blockVersion,
          blockContentId: contentId,
          timestamp: now - 3500_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'back-squat',
          metrics: [
            { type: 'rep', value: 25, unit: 'reps', metadata: { canonicalKey: 'rep' } },
            { type: 'load', value: 140, unit: 'kg', metadata: { canonicalKey: 'load' } },
            { type: 'tis', value: 320, unit: 's', metadata: { canonicalKey: 'tis' } },
          ],
        });
        tx.objectStore('events').put({
          id: `${s1}:1`,
          resultId: s1,
          noteId,
          blockId,
          blockVersion,
          blockContentId: contentId,
          timestamp: now - 3200_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'kettlebell-swing',
          metrics: [
            { type: 'rep', value: 75, unit: 'reps', metadata: { canonicalKey: 'rep' } },
            { type: 'load', value: 32, unit: 'kg', metadata: { canonicalKey: 'load' } },
            { type: 'tis', value: 280, unit: 's', metadata: { canonicalKey: 'tis' } },
          ],
        });
        tx.objectStore('events').put({
          id: `${s1}:2`,
          resultId: s1,
          noteId,
          blockId,
          blockVersion,
          blockContentId: contentId,
          timestamp: now - 2800_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'burpee',
          metrics: [
            { type: 'rep', value: 100, unit: 'reps', metadata: { canonicalKey: 'rep' } },
            { type: 'tis', value: 300, unit: 's', metadata: { canonicalKey: 'tis' } },
          ],
        });

        // Session 2 events (previous cycle)
        tx.objectStore('sessions').put({
          id: s2,
          noteId,
          blockId,
          blockVersion,
          blockContentId: contentId,
          startTime: now - 86400_000 * 7,
          endTime: now - 86400_000 * 7 + 850_000,
          duration: 850_000,
          completed: true,
          status: 'completed',
          createdAt: now - 86400_000 * 7 + 850_000,
        });
        tx.objectStore('events').put({
          id: `${s2}:0`,
          resultId: s2,
          noteId,
          blockId,
          blockVersion,
          blockContentId: contentId,
          timestamp: now - 86400_000 * 7 + 200_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'back-squat',
          metrics: [
            { type: 'rep', value: 25, unit: 'reps', metadata: { canonicalKey: 'rep' } },
            { type: 'load', value: 135, unit: 'kg', metadata: { canonicalKey: 'load' } },
            { type: 'tis', value: 350, unit: 's', metadata: { canonicalKey: 'tis' } },
          ],
        });

        tx.oncomplete = () => txResolve();
        tx.onerror = () => txReject(tx.error);
        await txPromise;
      } finally {
        db.close();
      }
    },
    {
      dbName: WOD_DB,
      noteId: NOTE_ID,
      fixture,
      blockId: workout.id,
      blockVersion: workout.version,
      contentId,
      s1: SESSION_1_ID,
      s2: SESSION_2_ID,
    },
  );
}

test('record note query widgets with saved session data in playground', async ({ page }) => {
  test.setTimeout(90_000);

  // 1. Initial boot and setup
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.localStorage.setItem('wodwiki.firstNoteDone.v1', 'true');
    window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
  });
  await waitForFeedReady(page);

  // 2. Seed note and session events
  await seedCoachNoteAndSessions(page);

  // 3. Navigate directly to the seeded note in Playground
  await page.goto(ROUTE_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(2000);

  // 4. Observe the rendered note with query widgets
  // Query 1: Table of session movements
  const queryBlocks = page.locator('.cm-query-block-preview');
  await expect(queryBlocks.first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Hover over the first query block (session results table)
  await queryBlocks.first().hover();
  await page.waitForTimeout(1200);

  // Scroll down to view the second widget (Value widget) and third (Bar chart widget)
  await queryBlocks.nth(1).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);

  await queryBlocks.nth(2).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);

  // 5. Open the Omni-Composer to edit a query widget in the note
  await queryBlocks.first().scrollIntoViewIfNeeded();
  await queryBlocks.first().hover();
  await page.waitForTimeout(800);

  const editBtn = queryBlocks.first().getByLabel('Edit query in Omni-Composer');
  if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await editBtn.click();
    await page.waitForTimeout(2000);

    // Edit query in WqlComposer inspector modal
    const composerInput = page.getByRole('textbox', { name: 'WQL' });
    if (await composerInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await composerInput.click();
      await page.waitForTimeout(1000);
    }

    // Close inspector modal
    const cancelModalBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelModalBtn.isVisible().catch(() => false)) {
      await cancelModalBtn.click();
      await page.waitForTimeout(1200);
    }
  }

  // 6. Demonstrate "Add to dashboard" action on the query block
  await queryBlocks.first().hover();
  const addDashBtn = queryBlocks.first().getByLabel('Add to dashboard');
  if (await addDashBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addDashBtn.click();
    await page.waitForTimeout(2500);

    // We are now inside QueryToDashboardDialog / WidgetComposerDialog!
    const dialogPromoteBtn = page.getByTestId('widget-promote-to-chart');
    if (await dialogPromoteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dialogPromoteBtn.click();
      await page.waitForTimeout(1500);
    }

    // Close dialog
    const cancelDialog = page.getByRole('button', { name: 'Cancel' });
    if (await cancelDialog.isVisible().catch(() => false)) {
      await cancelDialog.click();
      await page.waitForTimeout(1500);
    }
  }

  // Final view of the note with its live query widgets
  await page.locator('.cm-content').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
});
