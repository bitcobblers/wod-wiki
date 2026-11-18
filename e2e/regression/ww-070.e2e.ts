/**
 * WW-070 — Scoped equipment override commits silently — no confirmation and header 'Bundled' badge stays stale until full reload (medium)
 *
 * Regression test for the open QA defect WW-070 (override-silent-commit-stale-badge).
 * Expected behavior: saving a notebook-scoped equipment override navigates to
 * the scoped route (/equipment/:slug?notebook=notebook/:slug) and the header
 * source badge immediately re-derives to 'Scoped …' — parity with the effort
 * override flow in PRP-04 Scenario 1.
 * Current defect: EquipmentDetailPage's onSaved only calls refresh(); the URL
 * stays on the global route and the badge keeps reading 'Bundled' even though
 * the override notebook was written — an invisible write with stale chrome.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-070 — scoped equipment override navigates and re-badges on save', () => {
  test('WW-070: saving a scoped equipment override lands on the scoped route with a Scoped badge', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEquipment();

    // A user notebook to scope the override to (created through the real UI,
    // as in PRP-04 Scenario 1).
    const suffix = Date.now().toString().slice(-6);
    const clubName = `QA Override ${suffix}`;
    await app.notebooks.openLibrary();
    await app.notebooks.create(clubName, 'Scoped equipment overrides');
    const nbMatch = app.page.url().match(/\/notebook\/([^/?#]+)/);
    expect(nbMatch?.[1]).toBeTruthy();
    const nbSlug = decodeURIComponent(nbMatch![1]!);
    const targetNotebookId = `notebook/${nbSlug}`;

    // Bundled kettlebell → Override → pick the notebook in the sheet → Save.
    const equipment = await app.properties.openEquipment('kettlebell');
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailSource()).toHaveText('Bundled');
    await app.page.getByTestId('equipment-detail-override-btn').click();
    await app.properties.saveScopedOverride(targetNotebookId);

    // Correct behavior (effort parity): land on the scoped route, badge Scoped.
    await expect(app.page).toHaveURL(
      new RegExp(`/equipment/kettlebell\\?notebook=${encodeURIComponent(targetNotebookId)}$`),
      { timeout: 15_000 },
    );
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailSource()).toContainText('Scoped');
    await expect(equipment.detailSource()).toContainText(nbSlug);
  });
});
