// spec: e2e/specs/journal/cold-boot-and-home-tour.md
import AxeBuilder from '@axe-core/playwright';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

async function dismissSettledSyncToasts(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(
      async () => {
        for (const close of await page.locator('[toast-close]').all()) {
          await close.click().catch(() => {});
        }
        return page.locator('[toast-close]').count();
      },
      { timeout: 15_000 },
    )
    .toBe(0);
}

test.describe('JRN-01 — Cold Boot & Home Tour', () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`Home Tour renders hero, video lightbox, and fullscreen timer controls at ${viewport.width}x${viewport.height}`, async ({
      app,
    }) => {
      test.setTimeout(90_000);
      const { page } = app;
      await page.setViewportSize(viewport);
      await app.goto('/');
      await dismissSettledSyncToasts(page);

      await expect(page.getByTestId('tour-hero')).toBeVisible();
      await expect(page.getByTestId('tour-why-video')).toBeVisible();
      await expect(page.locator('[data-gate-id="editor-pane"] .cm-content').first()).toContainText('0:03 Count Down');

      // Open pitch video lightbox -> collapses to Watch again -> re-expands
      await page.getByTestId('tour-why-video').click();
      await expect(page.getByTestId('youtube-lightbox')).toBeVisible();
      await page.getByTestId('youtube-lightbox-close').click();
      await expect(page.getByTestId('tour-why-watch-again')).toBeVisible();
      await page.getByTestId('tour-why-watch-again').click();
      await expect(page.getByTestId('tour-why-video')).toBeVisible();

      // Scroll to Session Insights and trigger Run to view
      const analyticsStep = page.locator('[data-scope="analytics"]').filter({ visible: true }).first();
      await analyticsStep.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const cta = page
        .locator('[data-scope-active="true"]')
        .getByTestId('tour-insights-run')
        .or(page.getByTestId('tour-step-mobile-analytics').getByTestId('tour-insights-run'))
        .filter({ visible: true })
        .first();
      await expect(cta).toBeVisible();
      await cta.click();

      const timer = page.locator('.fixed.inset-0').filter({ has: page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE) });
      await expect(timer).toBeVisible({ timeout: 15_000 });

      const next = timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK);
      const stop = timer.getByTestId(TEST_IDS.TIMER_STOP_SESSION);
      const pause = timer.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE);
      await expect(next).toBeVisible();
      await expect(stop).toBeVisible();
      await expect(pause).toBeVisible();

      await pause.click();
      await expect(pause).toHaveAttribute('title', 'Continue');
      await pause.click();
      await expect(pause).toHaveAttribute('title', 'Pause');

      await stop.click();
      await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();
      await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible();
      await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();

      app.assertCleanConsole();
    });
  }

  test('Wod Wiki University outline scrolls to the 9 guide cards and /page/guide-start renders', async ({ app }) => {
    test.setTimeout(90_000);
    const { page } = app;
    await page.setViewportSize({ width: 1600, height: 1000 });
    await app.goto('/');
    await dismissSettledSyncToasts(page);

    const tocEntry = page.getByRole('button', { name: 'Wod Wiki University' });
    await expect(tocEntry).toBeVisible();
    await tocEntry.click();

    const section = page.getByTestId('tour-section-university');
    await expect
      .poll(async () => (await section.boundingBox())?.y ?? Infinity, { timeout: 15_000 })
      .toBeLessThan(250);

    const cards = section.locator('ul > li');
    await expect(cards).toHaveCount(9);
    await expect(cards.first().getByRole('link', { name: 'First Workout' })).toBeVisible();

    await cards.first().getByTestId('guide-watch').click();
    await expect(page.getByTestId('youtube-lightbox')).toBeVisible();
    await page.getByTestId('youtube-lightbox-close').click();
    await expect(page.getByTestId('youtube-lightbox')).toBeHidden();

    await app.goto('/page/guide-start');
    await expect(page.getByRole('heading', { name: 'First Workout', exact: true }).first()).toBeVisible();
    app.assertCleanConsole();
  });

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`Home Tour meets WCAG A and AA rules at ${viewport.width}x${viewport.height}`, async ({ app }) => {
      test.setTimeout(90_000);
      const { page } = app;
      await page.setViewportSize(viewport);
      await app.goto('/');
      await expect(page.getByTestId('tour-hero')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(
        results.violations.map(({ id, impact, nodes }) => ({
          id,
          impact,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      ).toEqual([]);
      app.assertCleanConsole();
    });
  }
});
