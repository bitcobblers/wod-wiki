/**
 * WW-088 — Equipment detail /equipment/:slug renders no canonical backlinks to related Efforts or referencing workout Notes (PRP-02 Scenario 3) (medium)
 *
 * Regression test for the open QA defect WW-088 (equipment-detail-no-backlinks-section).
 * Expected behavior: the equipment detail page's main content renders an
 * inline Backlinks / Used-in section linking to the related Efforts and the
 * workout Notes that reference the equipment (PRP-02 Scenario 3).
 * Current defect: EquipmentDetailPage computes the backlinks (contextData) but
 * surfaces them only through the L2 sidebar context nav — NoteContextNav
 * "renders nothing itself" — so the page main shows only Properties, Aliases,
 * metrics, and Edit YAML, with no Backlinks/Used-in section.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';
import { USAGE_NOTE_TITLE } from '../helpers/seedEquipment';

test.describe('WW-088 — equipment detail renders an inline backlinks section', () => {
  test('WW-088: /equipment/dumbbell main content links the related effort and the referencing note', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    // Fixtures seed Dumbbell plus the Dumbbell Snatch effort (its definition
    // lists the dumbbell) and the 'Dumbbell Day' note whose script uses it.
    await app.seed.bundledEquipment();

    const equipment = await app.properties.openEquipment('dumbbell');
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Dumbbell');

    // Scope to <main>: the sidebar context nav already carries these links
    // (that is the existing PRP-02 surface) — the defect is that the page's
    // main content has no Backlinks/Used-in section of its own.
    const main = app.page.locator('main');
    await expect(
      main.getByText(/backlinks|used in/i).first(),
      'main content has a Backlinks/Used-in section heading',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      main.getByText('Dumbbell Snatch', { exact: true }).first(),
      'backlinks section links the related Dumbbell Snatch effort',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      main.getByText(USAGE_NOTE_TITLE, { exact: true }).first(),
      'backlinks section links the referencing Dumbbell Day note',
    ).toBeVisible({ timeout: 15_000 });
  });
});
