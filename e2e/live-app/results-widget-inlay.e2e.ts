import { test, expect, type Page } from '@playwright/test';
import { WOD_DB, noteFixture } from '../helpers/wodwikiDb';
import { parseDocumentSections } from '../../packages/core/src/sections';
import { waitForFeedReady } from '../helpers/feedReadiness';

const ROUTES = {
  journal: {
    path: '/day/2099-09-01',
    noteId: 'journal/2099-09-01',
    title: 'Journal Result Widget Regression',
    screenshot: 'e2e/screenshots/results-widget-journal-after-reload.png',
    content: `# Journal Result Widget Regression

\`\`\`time
Timer: 1:00
5 Burpees
\`\`\`

\`\`\`query:table
:segment{result:WOD-341-journal-2099-09-01}
\`\`\`
`,
  },
  playground: {
    path: '/playground/WOD-341-results-widget',
    noteId: 'playground/WOD-341-results-widget',
    title: 'Playground Result Widget Regression',
    screenshot: 'e2e/screenshots/results-widget-playground-after-reload.png',
    content: `# Playground Result Widget Regression

\`\`\`time
Timer: 1:00
7 Air Squats
\`\`\`

\`\`\`query:table
:segment{result:WOD-341-playground-WOD-341-results-widget}
\`\`\`
`,
  },
} as const;

type SeedRoute = typeof ROUTES[keyof typeof ROUTES];

async function seedWorkoutDbNotesAndResults(page: Page, routes: SeedRoute[]) {
  const seeds = routes.map((route) => {
    const fixture = noteFixture(route.noteId, route.content, {
      title: route.title, type: route.noteId.startsWith('journal/') ? 'journal' : 'playground',
    });
    const workout = Object.values(fixture.note.blocks).find((block) => block.kind === 'wod');
    if (!workout) throw new Error(`No workout in ${route.noteId}`);
    const rawContent = route.content.slice(workout.from, workout.to);
    const contentId = parseDocumentSections(rawContent).find((section) => section.scriptBlock)?.contentId;
    if (!contentId) throw new Error(`No workout fingerprint in ${route.noteId}`);
    return {
      route, fixture, blockId: workout.id, blockVersion: workout.version, contentId,
      journalDate: route.noteId.startsWith('journal/') ? route.noteId.split('/')[1] : undefined,
    };
  });

  // Single evaluate: the home page can navigate asynchronously between
  // seeds, destroying the execution context of a second call.
  await page.evaluate(
    async ({ dbName, seeds }) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        for (const { route, fixture, blockId, blockVersion, contentId, journalDate } of seeds) {
          await new Promise<void>((resolve, reject) => {
            const storeNames = ['page', 'notes', 'block_revisions', 'block_index', 'page_notes', 'sessions', 'events'];
            const tx = db.transaction(storeNames, 'readwrite');
            const now = Date.now();

            // Journal-date notes join their calendar page (N-02) — the page row
            // AND the page_notes junction (V22: journalDate is derived through
            // it), or the /journal/:date list query finds no note and renders
            // the no-editor empty state (#698).
            if (journalDate) {
              tx.objectStore('page').put({ id: `page/${journalDate}`, date: journalDate, title: journalDate, createdAt: now });
              if (db.objectStoreNames.contains('page_notes')) {
                tx.objectStore('page_notes').put({
                  id: `pn-page/${journalDate}-${route.noteId}`,
                  pageId: `page/${journalDate}`,
                  noteId: route.noteId,
                  position: 0,
                  createdAt: now,
                });
              }
            }

            tx.objectStore('notes').put(fixture.note);
            for (const row of fixture.revisions) tx.objectStore('block_revisions').add(row);
            for (const row of fixture.index) tx.objectStore('block_index').put(row);
            const resultId = `WOD-341-${route.noteId.replace(/[^a-z0-9]+/gi, '-')}`;

            tx.objectStore('sessions').put({
              id: resultId,
              noteId: route.noteId,
              blockId,
              blockVersion,
              blockContentId: contentId,
              startTime: now - 74_000,
              endTime: now,
              duration: 74_000,
              completed: true,
              status: 'completed',
              createdAt: now,
            });

            tx.objectStore('events').put({
              id: `${resultId}:0`,
              resultId,
              noteId: route.noteId,
              blockId,
              blockVersion,
              blockContentId: contentId,
              timestamp: now,
              grain: 'event',
              outputType: 'segment',
              effortSlug: 'kettlebell-swing',
              metrics: [{ type: 'tis', value: 74, unit: 's', metadata: { canonicalKey: 'tis' } }],
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        }
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, seeds },
  );
}

function monitorCriticalConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' ||
      /NOTE_NOT_FOUND|persistence|IndexedDB|CodeMirror|plugin|exception/i.test(text)
    ) {
      errors.push(`[${message.type()}] ${text}`);
    }
  });
  return errors;
}

async function expectResultWidgetAfterReload(page: Page, route: SeedRoute) {
  await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
  const widget = page.locator('.cm-query-block-preview, [data-testid="rows-table"]').first();
  await expect(widget, `${route.noteId} should show the query table results block before reload`).toBeVisible({ timeout: 10_000 });
  await expect(widget.locator('tbody')).toContainText('kettlebell-swing');
  await expect(widget.locator('tbody')).toContainText('74');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
  await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
  await expect(widget, `${route.noteId} should show the query table results block after reload`).toBeVisible({ timeout: 10_000 });
  await expect(widget.locator('tbody')).toContainText('kettlebell-swing');
  await expect(widget.locator('tbody')).toContainText('74');
  await page.screenshot({ path: route.screenshot, fullPage: true });
}

test.describe('Workout results widget persistence in live app routes', () => {
  test('shows .cm-query-block-preview after reload for journal and playground routes', async ({ page }) => {
    const criticalConsole = monitorCriticalConsole(page);

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    // The canvas home page redirects/renders asynchronously — wait for the
    // app shell so seeding evaluates don't die mid-navigation.
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await waitForFeedReady(page);

    await seedWorkoutDbNotesAndResults(page, [ROUTES.journal, ROUTES.playground]);

    await expectResultWidgetAfterReload(page, ROUTES.journal);
    await expectResultWidgetAfterReload(page, ROUTES.playground);

    const unexpectedErrors = criticalConsole.filter((entry) =>
      // Successful IndexedDB-open diagnostics are benign.
      !/wodwiki-db v\d+ open/.test(entry) &&
      /NOTE_NOT_FOUND|persistence|IndexedDB|CodeMirror|plugin|exception/i.test(entry)
    );
    expect(unexpectedErrors, 'No result persistence or CodeMirror plugin errors should surface').toHaveLength(0);
  });
});
