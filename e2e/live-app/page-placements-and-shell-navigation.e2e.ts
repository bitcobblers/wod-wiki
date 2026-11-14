// spec: e2e/specs/notebooks/page-placements-and-shell-navigation.md
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

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
});
