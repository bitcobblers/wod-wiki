/**
 * WW-071 — On /effort/:slug and /equipment/:slug, alias chips must NOT
 * self-link back to the current property's own canonical URL (no-op self-links).
 *
 * Expected behavior: alias chips in a property detail page's frontmatter
 * preview render as visible non-link pills/badges when they resolve to the
 * current effort or equipment's own canonical URL.
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-071 — alias chips do not self-link on property detail pages', () => {
  test('WW-071: /effort/rowing alias chips render as non-link pills', async ({ app }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    const effort = await app.properties.openEffort('rowing');
    await effort.waitForDetailLoaded();
    await expect(effort.detailLabel()).toHaveText('Rowing');

    // Each self-referencing alias renders as a visible non-link pill, not a
    // self-linking anchor targeting /effort/rowing.
    const preview = effort.frontmatterProperties();
    for (const alias of ['row', 'rower', 'concept2 row']) {
      await expect(
        preview.getByText(alias, { exact: true }),
        `alias pill "${alias}" is visible`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        preview.getByRole('link', { name: alias, exact: true }),
        `alias pill "${alias}" must not self-link`,
      ).toHaveCount(0);
    }
  });

  test('WW-071 (path 2): /equipment/kettlebell alias chips render as non-link pills', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEquipment();

    const equipment = await app.properties.openEquipment('kettlebell');
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Kettlebell');

    // Expand the frontmatter preview if it starts collapsed (same pattern as
    // EffortsPage.waitForDetailLoaded).
    const detailsToggle = app.page.getByRole('button', { name: /Show property details/i });
    try {
      await detailsToggle.waitFor({ state: 'visible', timeout: 2_000 });
      await detailsToggle.click();
    } catch {
      // Property details already expanded or not collapsible on this surface.
    }

    const preview = equipment.notebookEditor().locator('.cm-frontmatter-preview');
    await expect(
      preview.getByText('kb', { exact: true }),
      'alias pill "kb" is visible',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      preview.getByRole('link', { name: 'kb', exact: true }),
      'alias pill "kb" must not self-link',
    ).toHaveCount(0);
  });
});
