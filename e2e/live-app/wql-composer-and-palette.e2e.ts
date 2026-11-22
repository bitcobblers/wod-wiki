// spec: e2e/specs/analytics/wql-composer-and-palette.md
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

const BENCHMARK_ID = 'journal/2099-09-10';
const RECOVERY_ID = 'journal/2099-09-11';

test.describe('ANL-06 — WQL Composer Scope Map & Command Palette Parity', () => {
  test('Scenario 1: Desktop Split-Pills, Scope Map popover, Clause Inspector, Add Filter, and inline Metric Explorer', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.seed.world({
      notes: [
        {
          id: BENCHMARK_ID,
          title: 'ANL-06 Benchmark Workout',
          rawContent: '# ANL-06 Benchmark Workout\n\n```wod\n21-15-9\n  Thruster 95lb\n  Pull-up\n```\n',
          date: Date.UTC(2099, 8, 10),
          notebookId: 'notebook/journal',
          tags: ['anl06benchmark'],
          seedOrigin: 'user',
        },
        {
          id: RECOVERY_ID,
          title: 'ANL-06 Recovery Flow',
          rawContent: '# ANL-06 Recovery Flow\n\nLight nasal zone-2 mobility.\n',
          date: Date.UTC(2099, 8, 11),
          notebookId: 'notebook/journal',
          tags: ['anl06recovery'],
          seedOrigin: 'user',
        },
      ],
    });

    try {
      // 1. /journal collapsed Split-Pills -> Clause Inspector -> traversal -> double Escape
      await app.goto('/journal');
      const journalBar = page.getByTestId(TEST_IDS.STREAM_QUERY_BAR);
      await expect(journalBar.getByTestId(TEST_IDS.WQL_SCOPE_TOGGLE)).toBeVisible();
      await expect(journalBar.locator('[role="textbox"]')).toHaveCount(0);

      await journalBar.getByTestId('token-slot-notebook').click();
      await expect(journalBar.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();
      await expect(journalBar.getByTestId(TEST_IDS.WQL_FIELD_PICKER)).toBeVisible();
      await expect(journalBar.locator('[role="textbox"]')).toHaveCount(1);

      const initialSearchLabel = await journalBar.getByTestId('wql-picker-search').getAttribute('aria-label');
      await journalBar.getByTestId(TEST_IDS.WQL_SEGMENT_NEXT).click();
      await expect(journalBar.getByTestId('wql-picker-search')).not.toHaveAttribute('aria-label', initialSearchLabel ?? '');
      await journalBar.getByTestId(TEST_IDS.WQL_SEGMENT_PREVIOUS).click();
      await expect(journalBar.getByTestId('wql-picker-search')).toHaveAttribute('aria-label', initialSearchLabel ?? '');

      await page.keyboard.press('Escape');
      await expect(journalBar.getByTestId(TEST_IDS.WQL_FIELD_PICKER)).toBeHidden();
      await expect(journalBar.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(journalBar.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeHidden();
      await expect(journalBar.locator('[role="textbox"]')).toHaveCount(0);

      await app.wql.openScopeMap();
      for (const zoneId of [
        TEST_IDS.WQL_ZONE_WHAT,
        TEST_IDS.WQL_ZONE_WHERE,
        TEST_IDS.WQL_ZONE_WHEN,
        TEST_IDS.WQL_ZONE_GROUP,
      ]) {
        await expect(journalBar.getByTestId(zoneId)).toBeVisible();
      }
      await app.wql.closeScopeMap();

      // 2. /notes default :note{} (all notes + unfiled) + narrow to journal + Add Tag filter positive/exclusion + pill removal
      await app.goto('/notes');
      const notesBar = page.getByTestId(TEST_IDS.STREAM_QUERY_BAR);
      await expect(notesBar.getByTestId('token-slot-target')).toContainText('note');
      await expect(notesBar.getByTestId('token-slot-notebook')).toHaveCount(0);
      await app.wql.fillStreamQueryBar(':note{notebook:journal}');
      await app.wql.closeScopeMap();
      await app.wql.expectStreamContains('ANL-06 Benchmark Workout');
      await app.wql.expectStreamContains('ANL-06 Recovery Flow');

      await notesBar.getByTestId(TEST_IDS.WQL_ADD_FILTER_BTN).click();
      await expect(notesBar.getByTestId(TEST_IDS.WQL_FILTER_TYPEAHEAD)).toBeVisible();
      await notesBar.getByTestId('wql-filter-typeahead-tag').click();
      await notesBar.getByTestId('wql-picker-search').fill('anl06benchmark');
      await notesBar.getByTestId('wql-clause-editor-tag-opt-0').click();
      await notesBar.getByTestId(TEST_IDS.WQL_CLAUSE_EDITOR_DONE).click();
      await notesBar.getByTestId(TEST_IDS.WQL_SCOPE_CLOSE).click();

      await app.wql.expectStreamContains('ANL-06 Benchmark Workout');
      await app.wql.expectStreamExcludes('ANL-06 Recovery Flow');

      await notesBar.getByTestId('token-slot-remove-tag').click();
      await app.wql.expectStreamContains('ANL-06 Recovery Flow');

      // 3. /efforts filter catalog & /dashboards inline Metric Explorer
      await app.goto('/efforts');
      const effortsBar = page.getByTestId(TEST_IDS.STREAM_QUERY_BAR);
      await effortsBar.getByTestId(TEST_IDS.WQL_ADD_FILTER_BTN).click();
      await expect(effortsBar.getByTestId('wql-filter-typeahead-discipline')).toBeVisible();
      await expect(effortsBar.getByTestId('wql-filter-typeahead-intensity')).toBeVisible();
      await app.wql.closeScopeMap();

      await app.wql.openExplorer();
      const explorerRoot = page.getByTestId(TEST_IDS.WQL_COMPOSER_ROOT).first();
      await expect(explorerRoot.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();
      await expect(explorerRoot.locator('[role="textbox"]')).toHaveCount(1);
      await page.getByRole('button', { name: 'Weekly strength volume' }).click();
      await expect(page).toHaveURL(/[?&]q=/);

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, BENCHMARK_ID);
      await deleteNoteByRouteId(page, RECOVERY_ID);
    }
  });

  test('Scenario 2: Desktop Command Palette WQL <-> Find parity, scope chip dismissal, and colon promotion', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/notes');

    const dialog = await app.wql.openCommandPalette();
    await expect(dialog.getByTestId(TEST_IDS.PALETTE_COMPOSER)).toBeVisible();
    await expect(dialog.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();
    await expect(dialog.locator('[role="textbox"]')).toHaveCount(1);

    await dialog.getByTestId(TEST_IDS.PALETTE_MODE).click();
    await expect(dialog.getByTestId(TEST_IDS.PALETTE_COMPOSER)).toHaveCount(0);
    await expect(dialog.getByTestId(TEST_IDS.PALETTE_FIND_INPUT)).toBeVisible();
    await expect(dialog.getByTestId(TEST_IDS.PALETTE_SCOPE_CHIP)).toBeVisible();

    // Real pointer click guarantees the scrollable results list does not overlap or intercept the chip clear button.
    await dialog.getByTestId(TEST_IDS.PALETTE_SCOPE_CLEAR).click();
    await expect(dialog.getByTestId(TEST_IDS.PALETTE_SCOPE_CHIP)).toHaveCount(0);

    await dialog.getByTestId(TEST_IDS.PALETTE_FIND_INPUT).fill(':note');
    await expect(dialog.getByTestId(TEST_IDS.PALETTE_COMPOSER)).toBeVisible();
    await expect(dialog.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    app.assertCleanConsole();
  });

  test('Scenario 3: Mobile 375x812 dock, Filter Sheet, Results/Edit toggle, and Dark Mode parity', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await app.goto('/journal');

    const assertNoOverflow = async () => {
      const dims = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
      }));
      expect(dims.sw).toBeLessThanOrEqual(dims.iw + 1);
    };

    const dockTrigger = page.getByTestId(TEST_IDS.STREAM_QUERY_BAR);
    await expect(page.getByTestId(TEST_IDS.STREAM_QUERY_BAR_DOCK)).toBeVisible();
    await expect(dockTrigger).toBeVisible();
    const dockBox = await dockTrigger.boundingBox();
    expect(dockBox).not.toBeNull();
    expect(dockBox!.height).toBeGreaterThanOrEqual(44);

    const summary = (await page.getByTestId(TEST_IDS.STREAM_QUERY_SUMMARY).textContent()) ?? '';
    expect(summary.trim().length).toBeGreaterThan(0);
    expect(summary.trim().startsWith(':')).toBe(false);
    await assertNoOverflow();

    // Compact dock opens the Filter Sheet directly on the Scope Map
    await dockTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Command Palette' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();
    const modeBox = await dialog.getByTestId(TEST_IDS.PALETTE_MODE).boundingBox();
    expect(modeBox).not.toBeNull();
    expect(modeBox!.height).toBeGreaterThanOrEqual(44);
    await assertNoOverflow();
    await dialog.getByTestId(TEST_IDS.PALETTE_CANCEL).click();
    await expect(dialog).toBeHidden();

    // Command Palette (Ctrl/Cmd+K) defaults to Results on mobile and reveals Scope Map on Edit filter
    const palette = await app.wql.openCommandPalette();
    const viewToggle = palette.getByTestId(TEST_IDS.PALETTE_MOBILE_VIEW_TOGGLE);
    await expect(viewToggle).toBeVisible();
    await expect(palette.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeHidden();

    const toggleButtons = await viewToggle.locator('button').all();
    expect(toggleButtons).toHaveLength(2);
    for (const btn of toggleButtons) {
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await viewToggle.getByRole('button', { name: 'Edit filter' }).click();
    await expect(palette.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();
    await assertNoOverflow();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    // Dark theme mobile sheet parity
    try {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await dockTrigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId(TEST_IDS.WQL_SCOPE_MAP)).toBeVisible();
      await assertNoOverflow();
      await dialog.getByTestId(TEST_IDS.PALETTE_CANCEL).click();
      await expect(dialog).toBeHidden();
    } finally {
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
    }

    app.assertCleanConsole();
  });
});
