// spec: e2e/specs/notebooks/notebook-cross-flow.md
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

const TEST_PAGE_NAME = 'nbk04-cross-flow';
const WIDGET_RICH_NOTE = `# Wod.Wiki Playground

\`\`\`widget:attention
{"headline":"Wod.Wiki Playground","subtitle":"Seeded widget page for e2e.","pillars":[{"icon":"✍️","label":"Markdown","description":"Seed pillar."}],"actions":[]}
\`\`\`

\`\`\`widget:code-example
{"lines":[{"code":"(3)","annotation":"repeat the indented workout block 3 times"},{"code":"  10 Kettlebell Swings 24kg","annotation":"reps · movement · load"},{"code":"  *:30 Rest","annotation":"rest timer between rounds"}],"cta":"Run this example"}
\`\`\`

\`\`\`widget:playground-run-tip
{}
\`\`\`

\`\`\`time
(3)
  10 Kettlebell Swings 24kg
  *:30 Rest
\`\`\`

\`\`\`widget:syntax-group
{"category":"Structure","icon":"🔁","title":"Simple Rounds","description":"Repeat a block N times.","example":"(3)\\n  10 Swings","docsPath":"/syntax"}
\`\`\`
`;

test.describe('NBK-04 — Cross-Route Notebook, Playground Widgets, Theme & Dated Item Flow', () => {
  test('Scenario 1: playground widgets render, launch /run/:id, switch dark/light mode, and hold 375x812 bounds', async ({
    app,
  }) => {
    const { page } = app;
    const noteId = `playground/${TEST_PAGE_NAME}`;

    await app.seed.note(noteId, WIDGET_RICH_NOTE, {
      type: 'playground',
      title: TEST_PAGE_NAME,
    });

    try {
      // 1. Desktop widget rendering + annotations
      await page.setViewportSize({ width: 1440, height: 900 });
      await app.goto(`/playground/${TEST_PAGE_NAME}`);
      const editor = page.getByRole('textbox', { name: 'Note editor' });
      await expect(editor).toContainText('Wod.Wiki Playground');
      await expect(editor.getByTestId('widget-preview-surface').first()).toBeVisible({ timeout: 10_000 });
      await expect(editor.getByRole('heading', { name: 'Code example', exact: true })).toBeVisible();
      await expect(editor.getByRole('button', { name: 'Run this example' })).toBeVisible();
      await expect(editor.getByText('repeat the indented workout block 3 times')).toBeVisible();
      await expect(editor.getByText('Ready to try it?')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

      // 2. Dark / light mode switch on /settings/appearance
      await app.goto('/settings/appearance');
      const darkOption = page.getByTestId('theme-option-dark');
      await expect(darkOption).toBeVisible({ timeout: 5_000 });
      await darkOption.click();
      await expect
        .poll(async () => ((await page.locator('html').getAttribute('class')) ?? '').split(/\s+/))
        .toContain('dark');

      await page.getByTestId('theme-option-light').click();
      await expect
        .poll(async () => ((await page.locator('html').getAttribute('class')) ?? '').split(/\s+/))
        .toContain('light');

      // 3. Mobile 375x812 touch target & zero overflow
      await page.setViewportSize({ width: 375, height: 812 });
      await app.goto(`/playground/${TEST_PAGE_NAME}`);
      const runExampleBtn = page.getByRole('button', { name: 'Run this example' });
      await expect(runExampleBtn).toBeVisible();
      const box = await runExampleBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(32);
      const mobileOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(mobileOverflow).toBe(false);

      // 4. Launch workout from wod block -> /run/:runtimeId
      await page.setViewportSize({ width: 1280, height: 900 });
      await app.seed.note(
        noteId,
        '# My Workout\n\n```time\nTimer 1:00\n  - 10 Pushups\n  - 10 Situps\n```\n',
        { type: 'playground', title: TEST_PAGE_NAME },
      );
      await app.goto(`/playground/${TEST_PAGE_NAME}`);
      const playButton = page.getByRole('button', { name: 'Play', exact: true }).first();
      await expect(playButton).toBeVisible({ timeout: 10_000 });
      await playButton.click();

      await page.waitForURL(/\/(tracker|run)\//, { timeout: 10_000 });
      await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({ timeout: 10_000 });
      await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
      const pauseButton = page.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"][title="Pause"]:visible`).first();
      await expect(pauseButton).toBeVisible({ timeout: 8_000 });

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, noteId);
    }
  });

  test('Scenario 2: dated notebook item /notebook/:slug/:date/:item renders and Play mints today journal entry (notebook-dated-item)', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const datedNoteId = 'nbk04-dated-session-1';
    const datedPath = 'markdown/notebooks/nbk04-dated/2099-02-01/session-1.md';
    await app.seed.world({
      notes: [
        {
          id: datedNoteId,
          title: 'Dated Session One',
          sourceId: 'notebook:nbk04-dated/2099-02-01/session-1',
          sourcePath: datedPath,
          tags: ['dated'],
          rawContent: '---\ntags: [dated]\n---\n# Dated Session One\n\n```time\n5 Burpees\n```\n',
        },
      ],
    });

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    try {
      await app.goto('/notebook/nbk04-dated/2099-02-01/session-1');
      await expect(page.locator('#dated-session-one')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.cm-content').getByText('5 Burpees')).toBeVisible({ timeout: 15_000 });

      await page.locator('.cm-content').getByText('5 Burpees').first().click();
      const play = page.locator('button[aria-label="Play"]').first();
      await expect(play).toBeVisible({ timeout: 10_000 });
      await play.click();

      await page.waitForURL(/\/day\/\d{4}-\d{2}-\d{2}/, { timeout: 30_000 });
      await expect(page.locator('.cm-content')).toContainText('5 Burpees', { timeout: 30_000 });
      await app.journal.expectNotePersisted(`journal/${todayKey}`, '5 Burpees');

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, datedNoteId);
      await app.journal.clearDate(todayKey);
    }
  });
});
