/**
 * WW-071 — Alias chips on /effort/:slug and /equipment/:slug are non-interactive spans — PRP-01 spec promises linked chips (low)
 *
 * Regression test for the open QA defect WW-071 (alias-chips-noninteractive-spans).
 * Expected behavior: alias chips in a property detail page's frontmatter
 * summary are links to the canonical property route — PRP-01 Scenario 2
 * expects resolved alias chips ('row', 'rower', 'concept2 row') linking to
 * the Rowing page, and equipment aliases behave the same.
 * Current defect: frontmatter-preview.ts createSummaryPill builds alias pills
 * with document.createElement('span') — no anchor semantics, no href, not
 * clickable — on both effort and equipment detail pages.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-071 — alias chips are links on property detail pages', () => {
  test('WW-071: /effort/rowing alias chips link to the Rowing page', async ({ app }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    const effort = await app.properties.openEffort('rowing');
    await effort.waitForDetailLoaded();
    await expect(effort.detailLabel()).toHaveText('Rowing');

    // The summary pills live in the frontmatter preview; each alias must be
    // a real link to the canonical effort route, not a plain span.
    const preview = effort.frontmatterProperties();
    for (const alias of ['row', 'rower', 'concept2 row']) {
      const chip = preview.getByRole('link', { name: alias, exact: true });
      await expect(chip, `alias chip "${alias}" is a link`).toBeVisible({ timeout: 15_000 });
      await expect(chip, `alias chip "${alias}" targets the canonical route`).toHaveAttribute(
        'href',
        /\/effort\/rowing$/,
      );
    }

    // And the link actually navigates (self-alias resolves to the same page).
    await preview.getByRole('link', { name: 'rower', exact: true }).click();
    await expect(app.page).toHaveURL(/\/effort\/rowing$/);
  });

  test('WW-071 (path 2): /equipment/kettlebell alias chips link to the Kettlebell page', async ({
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
    const chip = preview.getByRole('link', { name: 'kb', exact: true });
    await expect(chip, 'alias chip "kb" is a link').toBeVisible({ timeout: 15_000 });
    await expect(chip, 'alias chip "kb" targets the canonical route').toHaveAttribute(
      'href',
      /\/equipment\/kettlebell$/,
    );
  });
});
