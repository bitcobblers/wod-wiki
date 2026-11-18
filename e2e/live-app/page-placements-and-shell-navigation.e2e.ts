// spec: e2e/specs/notebooks/page-placements-and-shell-navigation.md
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId, getNotePlacements } from '../helpers/wodwikiDb';

const PALETTE_NOTE_ID = '01950000-0000-7000-8000-000000000831';
const PALETTE_NOTE_TITLE = 'NBK03 Atlas Kettlebell Complex';
const PALETTE_NOTE_MARKDOWN = [
  `# ${PALETTE_NOTE_TITLE}`,
  '',
  '```time',
  '(4)',
  '  12 Kettlebell Swings 24kg',
  '  10 Goblet Squats 24kg',
  '```',
  '',
].join('\n');

test.describe('NBK-03 — Page Placements & Shell Navigation', () => {
  test('Scenario 1: Global Ctrl+/ chord and L1 Search open PaletteShell, toggle Find/WQL + query settings, and navigate to a Note hit', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.seed.world({
      notes: [
        {
          id: PALETTE_NOTE_ID,
          title: PALETTE_NOTE_TITLE,
          rawContent: PALETTE_NOTE_MARKDOWN,
          seedOrigin: 'user',
        },
      ],
    });

    try {
      await app.journal.openStream();

      // 1. Launch PaletteShell via global keyboard chord (Ctrl+/ / Cmd+/)
      await page.keyboard.press('ControlOrMeta+/');
      const dialog = page.getByRole('dialog', { name: 'Command Palette' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('palette-composer')).toBeVisible();

      // Initial palette query is WQL (`:note{source:journal,notebooks} by {date}`)
      const modeButton = dialog.getByTestId('palette-mode');
      await expect(modeButton).toHaveAttribute('aria-pressed', 'true');
      await expect(modeButton).toHaveText('WQL');

      // Toggle WQL -> Find -> WQL
      await modeButton.click();
      await expect(modeButton).toHaveAttribute('aria-pressed', 'false');
      await expect(modeButton).toHaveText('Find');

      await modeButton.click();
      await expect(modeButton).toHaveAttribute('aria-pressed', 'true');
      await expect(modeButton).toHaveText('WQL');

      // Toggle inline query settings panel open and closed
      const settingsButton = dialog.getByTestId('palette-settings');
      await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
      await settingsButton.click();
      await expect(settingsButton).toHaveAttribute('aria-expanded', 'true');
      await expect(dialog.getByTestId('palette-settings-panel')).toBeVisible();

      await settingsButton.click();
      await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog.getByTestId('palette-settings-panel')).toBeHidden();

      // Dismiss cleanly via Cancel
      await dialog.getByTestId('palette-cancel').click();
      await expect(dialog).toBeHidden();

      // 2. Reopen via L1 rail Search button, query the seeded Note, and select the hit
      await page.getByTestId(TEST_IDS.NAV_L1_SEARCH).click();
      await expect(dialog).toBeVisible();

      const composerEditor = dialog
        .getByTestId('palette-composer')
        .getByLabel('WQL', { exact: true });
      await composerEditor.fill(':note{text:"NBK03 Atlas"}');

      const noteOption = dialog.getByRole('option', {
        name: new RegExp(PALETTE_NOTE_TITLE),
      });
      await expect(noteOption).toBeVisible();
      await noteOption.click();

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/note/${PALETTE_NOTE_ID}`));
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        PALETTE_NOTE_TITLE,
      );

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, PALETTE_NOTE_ID);
    }
  });

  test('Scenario 2: /settings/profile navigates via desktop rail and mobile 375x812 drawer and persists athlete metrics across reload', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    try {
      await app.journal.openStream();

      // 1. Desktop L1 rail navigation to /settings/profile
      await page.getByTestId('nav-profile').click();
      await expect(page).toHaveURL(/\/settings\/profile/);

      const displayNameInput = page.getByTestId('profile-display-name');
      const weightInput = page.getByTestId('profile-weight');
      const heightInput = page.getByTestId('profile-height');

      await expect(displayNameInput).toBeVisible();
      await displayNameInput.fill('Jordan Rivera');
      await weightInput.fill('78');
      await heightInput.fill('179');

      // Reload /settings/profile and assert values persisted in IndexedDB
      await page.reload();
      await app.feeds.waitForReady();

      await expect(page.getByTestId('profile-display-name')).toHaveValue('Jordan Rivera');
      await expect(page.getByTestId('profile-weight')).toHaveValue('78');
      await expect(page.getByTestId('profile-height')).toHaveValue('179');

      // 2. Mobile 375x812 navigation drawer -> Profile + overflow gate
      await page.setViewportSize({ width: 375, height: 812 });
      await app.journal.openStream();

      await page.getByTestId(TEST_IDS.MOBILE_NAV_OPEN).click();
      const drawer = page.getByTestId(TEST_IDS.MOBILE_NAV_DRAWER);
      await expect(drawer).toBeVisible();
      await drawer.getByTestId('nav-profile').click();

      await expect(page).toHaveURL(/\/settings\/profile/);
      await expect(page.getByTestId('profile-display-name')).toHaveValue('Jordan Rivera');
      await expect(page.getByTestId('profile-weight')).toHaveValue('78');
      await expect(page.getByTestId('profile-height')).toHaveValue('179');

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow, 'no horizontal overflow on /settings/profile at 375x812').toBe(
        false,
      );

      app.assertCleanConsole();
    } finally {
      // Restore clean default profile state for subsequent shared-worker specs
      await app.goto('/settings/profile');
      const displayNameInput = page.getByTestId('profile-display-name');
      await expect(displayNameInput).toBeVisible();
      await displayNameInput.fill('Anonymous');
      await page.getByTestId('profile-weight').fill('');
      await page.getByTestId('profile-height').fill('');
    }
  });

  test('Scenario 3: many-to-many page placement lists Notes on /day/:date and /page/:slug while keeping /note/:id canonical', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const dateOne = '2099-09-10';
    const dateOther = '2099-09-11';
    const dateTwo = '2099-09-12';
    const noteOneId = `journal/${dateOne}`;
    const noteTwoId = `journal/${dateTwo}`;
    const namedSlug = `placement-nbk03-${Date.now().toString().slice(-4)}`;

    await app.journal.clearDate(dateOne);
    await app.journal.clearDate(dateTwo);
    await app.seed.journalNote(dateOne, '# Placement One\n\nFirst note body.', { title: 'Placement One' });
    await app.seed.journalNote(dateTwo, '# Placement Two\n\nSecond note body.', { title: 'Placement Two' });

    try {
      // Place Note 1 onto named page and second journal date
      await app.goto(`/note/${encodeURIComponent(noteOneId)}`);
      const placementsDialog = page.getByRole('dialog', { name: 'Note placements' });
      await page.getByRole('button', { name: 'Page options' }).click();
      await page.getByRole('button', { name: 'Note placements' }).click();
      await expect(placementsDialog).toBeVisible();
      await page.getByLabel('Named page').fill(namedSlug);
      await page.getByRole('button', { name: 'Place on this page' }).click();
      await expect(placementsDialog).toBeHidden();

      await page.getByRole('button', { name: 'Page options' }).click();
      await page.getByRole('button', { name: 'Note placements' }).click();
      await page.getByLabel('Journal date').fill(dateOther);
      await page.getByRole('button', { name: 'Place on this page' }).click();
      await expect(placementsDialog).toBeHidden();

      const placementsAfterAdd = await getNotePlacements(page, noteOneId);
      expect(placementsAfterAdd.map((r) => r.date ?? r.slug).sort()).toEqual([dateOne, dateOther, namedSlug].sort());

      // Place Note 2 onto the same named page
      await app.goto(`/note/${encodeURIComponent(noteTwoId)}`);
      await page.getByRole('button', { name: 'Page options' }).click();
      await page.getByRole('button', { name: 'Note placements' }).click();
      await page.getByLabel('Named page').fill(namedSlug);
      await page.getByRole('button', { name: 'Place on this page' }).click();
      await expect(placementsDialog).toBeHidden();

      // Verify /day/:otherDate and /page/:slug list their placed Notes and open canonical routes
      await app.goto(`/day/${dateOther}`);
      await expect(page.getByRole('link', { name: 'Placement One' }).first()).toBeVisible();

      await app.goto(`/page/${namedSlug}`);
      await expect(page.getByRole('link', { name: 'Placement One' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Placement Two' })).toBeVisible();

      await page.getByRole('link', { name: 'Placement One' }).click();
      await expect(page).toHaveURL(new RegExp(`/note/${encodeURIComponent(noteOneId)}`));
      await expect(page.getByText('First note body.')).toBeVisible();

      // Remove one placement and verify canonical route still holds remaining placements
      await page.getByRole('button', { name: 'Page options' }).click();
      await page.getByRole('button', { name: 'Note placements' }).click();
      await page.getByRole('button', { name: 'Remove' }).first().click();
      await expect(placementsDialog).toBeHidden();
      expect(await getNotePlacements(page, noteOneId)).toHaveLength(2);

      app.assertCleanConsole();
    } finally {
      await app.journal.clearDate(dateOne);
      await app.journal.clearDate(dateTwo);
    }
  });

  test('Scenario 4: live L2/L3 note facet sync, inline L2 saved-link CRUD, and L2 dashboard switcher', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1600, height: 1000 });

    const noteId = 'nbk03-live-facets-note';
    await app.seed.note(
      noteId,
      '# Morning Prep\n\n```time\n21-15-9\n  Thrusters 95 lb\n  Pull-ups\n```\n',
      { title: 'Morning Prep' },
    );

    try {
      await app.goto(`/note/${noteId}?edit=1`);
      const editor = page.locator('.cm-content').first();
      await expect(editor).toBeVisible({ timeout: 15_000 });

      const sidebar = page.getByRole('navigation', { name: 'Main' }).locator('nav').last();
      await expect(sidebar.getByText('Efforts', { exact: true })).toBeVisible({ timeout: 30_000 });

      await editor.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('\n\n## Finisher\n#hyroxprep\n\n```time\n12 Kettlebell Zottman Curl\n```\n');

      await expect(page.getByRole('button', { name: 'Finisher', exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(sidebar.getByRole('button', { name: 'Kettlebell', exact: true })).toBeVisible({ timeout: 10_000 });
      const defineAction = page.getByTestId('l3-define-zottman-curl').first();
      await expect(defineAction).toBeVisible({ timeout: 10_000 });

      await defineAction.click();
      const createDialog = page.getByTestId('create-reference-dialog');
      await expect(createDialog).toBeVisible();
      await createDialog.getByTestId('create-reference-submit').click();
      await expect(createDialog).toBeHidden({ timeout: 10_000 });

      await expect(sidebar.getByTestId('menu-filter-note-context-efforts:zottman-curl')).toBeVisible({ timeout: 10_000 });
      await sidebar.getByTestId('menu-filter-note-context-efforts:zottman-curl').click();
      await expect(page).toHaveURL(/\/notes\?q=.*zottman-curl/);

      await page.goBack();
      await expect(sidebar.getByRole('button', { name: 'Zottman Curl', exact: true })).toBeVisible({ timeout: 15_000 });
      await sidebar.getByRole('button', { name: 'Zottman Curl', exact: true }).click();
      await expect(page).toHaveURL(/\/effort\/zottman-curl$/);

      // L2 inline saved-link CRUD on /notes
      await app.goto('/notes');
      const mainNav = page.getByRole('navigation', { name: 'Main' });
      await mainNav.getByTestId('conditions-nav-shortcut-add').click();
      await expect(mainNav.getByTestId('conditions-nav-inline-editor')).toBeVisible();
      await mainNav.getByTestId('conditions-nav-editor-label').fill('Kettlebell Notes');
      await mainNav.getByTestId('conditions-nav-editor-wql').fill(':note{equipment:kettlebell}');
      await mainNav.getByTestId('conditions-nav-editor-save').click();
      await expect(page).toHaveURL(/\/notes\?q=.*equipment%3Akettlebell/);

      await mainNav.getByTestId('conditions-nav-edit-toggle').click();
      await mainNav.getByRole('button', { name: 'Edit Kettlebell Notes' }).click();
      await mainNav.getByTestId('conditions-nav-editor-label').fill('KB Sessions');
      await mainNav.getByTestId('conditions-nav-editor-save').click();
      await expect(mainNav.getByText('KB Sessions', { exact: true })).toBeVisible();
      await mainNav.getByRole('button', { name: 'Delete KB Sessions' }).click();
      await expect(mainNav.getByText('KB Sessions', { exact: true })).toHaveCount(0);
      await mainNav.getByTestId('conditions-nav-edit-toggle').click();

      // Dashboard L2 switcher live-syncs newly created dashboards with deduplicated slugs
      await app.wql.openExplorer();
      await mainNav.getByTestId('dashboards-nav-new').click();
      await expect(page).toHaveURL(/\/dashboard\/new-dashboard$/, { timeout: 15_000 });
      await expect(mainNav.getByTestId('dashboard-nav-item-new-dashboard')).toBeVisible({ timeout: 10_000 });
      await mainNav.getByTestId('dashboards-nav-new').click();
      await expect(page).toHaveURL(/\/dashboard\/new-dashboard-2$/, { timeout: 15_000 });
      await expect(mainNav.getByTestId('dashboard-nav-item-new-dashboard-2')).toBeVisible({ timeout: 15_000 });

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, noteId);
    }
  });
});
