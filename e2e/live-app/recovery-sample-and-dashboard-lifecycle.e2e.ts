// spec: e2e/specs/analytics/recovery-sample-and-dashboard-lifecycle.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('ANL-05 — Recovery Sample Coverage, Precision & User Dashboard Deletion', () => {
  test('Scenario 1: sample data populates Recovery & Readiness and hides contradictory empty-range record counts', async ({
    app,
  }) => {
    const { page } = app;
    const isMobile = (page.viewportSize()?.width ?? 1280) <= 480;
    if (!isMobile) {
      await page.setViewportSize({ width: 1280, height: 850 });
    }
    await app.goto('/dashboards?q=sum%3AtotalVolume%7B%7D+by+%7Bweek%7D');

    // Load sample data if prompt is shown
    const sampleBtn = page.getByRole('button', { name: /Preview with sample data/i });
    if (await sampleBtn.isVisible().catch(() => false)) {
      await sampleBtn.click();
      await expect(page.getByRole('button', { name: /Purge sample data/i })).toBeVisible({
        timeout: 30_000,
      });
    }

    // WW-028: Recovery & Readiness renders real charts with sample data
    await app.goto('/dashboard/recovery-readiness');
    if (isMobile) {
      await expect(page.getByLabel('Breadcrumb')).toContainText('recovery-readiness');
    } else {
      await expect(page.getByRole('heading', { name: /Recovery & Readiness/i }).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: /Readiness today/i }).first()).toBeVisible();
    // Wait for widget queries to settle and confirm widgets no longer all show "No data for this range."
    await expect
      .poll(
        async () => {
          const emptyCount = await page.getByText('No data for this range.').count();
          return emptyCount;
        },
        { timeout: 20_000 },
      )
      .toBeLessThan(3);

    // Prebuilt dashboard must not expose Delete dashboard button
    await expect(page.getByTestId(TEST_IDS.DELETE_DASHBOARD_BUTTON)).toHaveCount(0);
    if (isMobile) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no horizontal overflow on /dashboard/recovery-readiness at 375px').toBeLessThanOrEqual(0);
    }

    // WW-029: Empty-range query in explorer hides contradictory records-toggle
    await app.goto('/dashboards?q=sum%3AtotalVolume%7Beffort%3Anonexistent-effort-xyz%7D+by+%7Bweek%7D');
    await expect(page.getByText('No data for this range.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('records-toggle')).toHaveCount(0);

    app.assertCleanConsole();
  });

  test('Scenario 2: user-created dashboard exposes confirmed Delete dashboard and /notes has no stuck Loading more', async ({
    app,
  }) => {
    const { page } = app;
    const isMobile = (page.viewportSize()?.width ?? 1280) <= 480;
    if (!isMobile) {
      await page.setViewportSize({ width: 1280, height: 850 });
    }
    await app.goto('/dashboards?q=sum%3AtotalVolume%7B%7D+by+%7Bweek%7D');

    // Save widget into a new user dashboard
    await page.getByTestId('save-query').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^Title$/i).fill('QA Disposable Volume Widget');
    await dialog.getByTestId('widget-composer-apply').click();

    await expect(page).toHaveURL(/\/dashboard\//, { timeout: 15_000 });

    // Enter Edit mode and delete user-created dashboard (analytics finding #7)
    if (isMobile) {
      await page.getByRole('button', { name: 'Open page options' }).click();
      const mobileEdit = page.locator('button:visible', { hasText: /^Edit$/ }).first();
      await expect(mobileEdit).toBeVisible({ timeout: 10_000 });
      await mobileEdit.click();
      await page.keyboard.press('Escape');
    } else {
      const editBtn = page.getByTestId('dashboard-edit-toggle');
      await expect(editBtn).toBeVisible({ timeout: 10_000 });
      await editBtn.click();
    }
    const deleteBtn = page.getByTestId(TEST_IDS.DELETE_DASHBOARD_BUTTON);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    const confirmBtn = page.getByTestId(TEST_IDS.CONFIRM_DELETE_DASHBOARD);
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(page).toHaveURL(/\/dashboards$/, { timeout: 15_000 });

    // WW-023 + analytics finding #4: /notes settles without any "Loading more" text visible
    await app.goto('/notes');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 15_000,
    });
    const bodyText = await page.locator('main').first().innerText();
    expect(bodyText).not.toMatch(/Loading more/i);

    app.assertCleanConsole();
  });
});
