// spec: e2e/specs/journal/cold-boot-and-home-tour.md
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { getSessions } from '../utils/sessionsDb';

async function dismissSettledSyncToasts(page: Page): Promise<void> {
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

async function expectTouchable(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await expect
    .poll(
      () =>
        control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width >= 44 &&
            rect.height >= 44 &&
            [
              [rect.x + rect.width / 2, rect.top + 8],
              [rect.x + rect.width / 2, rect.bottom - 8],
              [rect.left + 8, rect.y + rect.height / 2],
              [rect.right - 8, rect.y + rect.height / 2],
            ].every(([x, y]) => element.contains(document.elementFromPoint(x, y)))
          );
        }),
      { message: 'Entire control must meet 44x44px touch target without obscuring overlays' },
    )
    .toBe(true);
}

test.describe('JRN-01 — Cold Boot & Home Tour', () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`Home Tour renders hero, scroll-stable video lightbox, fullscreen timer stop/review loop, and Session Insights glide at ${viewport.width}x${viewport.height}`, async ({
      app,
    }) => {
      test.setTimeout(90_000);
      const { page } = app;
      await page.setViewportSize(viewport);
      await app.goto('/');
      await dismissSettledSyncToasts(page);

      const priorSessionIds = new Set((await getSessions(page)).map((s) => s.id));

      await expect(page.getByTestId('tour-hero')).toBeVisible();
      await expect(page.getByTestId('tour-why-video')).toBeVisible();
      await expect(page.locator('[data-gate-id="editor-pane"] .cm-content').first()).toContainText('0:03 Count Down');

      // Open pitch video lightbox -> collapses to Watch again -> re-expands
      await page.getByTestId('tour-why-video').click();
      await expect(page.getByTestId('youtube-lightbox')).toBeVisible();
      await page.getByTestId('youtube-lightbox-close').click();
      await expect(page.getByTestId('tour-why-watch-again')).toBeVisible();
      await expect(page.getByTestId('tour-why-video')).toBeHidden();
      await page.getByTestId('tour-why-watch-again').click();
      await expect(page.getByTestId('tour-why-video')).toBeVisible();
      await expect(page.getByTestId('tour-why-watch-again')).toBeHidden();

      // Scrolling past the pitch without watching must NOT collapse it (no layout jump under scroll)
      await page
        .getByTestId('tour-section-editor')
        .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await expect(page.getByTestId('tour-why-watch-again')).toBeHidden();
      await expect(page.getByTestId('tour-why-video')).toBeAttached();

      // Scroll to Session Insights and trigger 44x44px touch-safe Run to view CTA
      const analyticsStep = page.locator('[data-scope="analytics"]').filter({ visible: true }).first();
      await analyticsStep.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const cta = page
        .locator('[data-scope-active="true"]')
        .getByTestId('tour-insights-run')
        .or(page.getByTestId('tour-step-mobile-analytics').getByTestId('tour-insights-run'))
        .filter({ visible: true })
        .first();
      await expectTouchable(cta);
      await cta.click();

      const timer = page.locator('.fixed.inset-0').filter({ has: page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE) });
      await expect(timer).toBeVisible({ timeout: 15_000 });

      const next = timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK);
      const stop = timer.getByTestId(TEST_IDS.TIMER_STOP_SESSION);
      const pause = timer.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE);
      await expectTouchable(next);
      await expectTouchable(stop);
      await expectTouchable(pause);

      await pause.click();
      await expect(pause).toHaveAttribute('title', 'Continue');
      await pause.click();
      await expect(pause).toHaveAttribute('title', 'Pause');

      // Stop -> confirm -> Workout Complete review -> close glides to insights & illuminates metrics
      await stop.click();
      await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();
      await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible();
      await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
      await expect(timer).toBeHidden({ timeout: 15_000 });

      await expect
        .poll(async () => (await getSessions(page)).filter((s) => !priorSessionIds.has(s.id)).length, {
          timeout: 10_000,
        })
        .toBe(1);

      const insights = page.getByTestId('tour-section-insights');
      await expect
        .poll(
          async () => {
            const box = await insights.boundingBox();
            return !!box && box.y >= 0 && box.y <= 140;
          },
          { timeout: 15_000, message: 'closing review parks tour-section-insights under sticky header' },
        )
        .toBe(true);

      await analyticsStep.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await expect(page.getByTestId('tour-insights-timeline').filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByTestId('tour-insights-impatience').filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByTestId('tour-insights-reaction').filter({ visible: true }).first()).toBeVisible();

      // Pane header button glides back to tour-section-editor with live editor intact
      const backToEditor = page
        .locator('[data-scope-active="true"]')
        .getByTestId('tour-pane-back-to-editor')
        .or(page.getByTestId('tour-step-mobile-analytics').getByTestId('tour-pane-back-to-editor'))
        .filter({ visible: true })
        .first();
      await backToEditor.scrollIntoViewIfNeeded();
      await dismissSettledSyncToasts(page);
      await backToEditor.click();

      const editorSection = page.getByTestId('tour-section-editor');
      await expect
        .poll(
          async () => {
            const box = await editorSection.boundingBox();
            return !!box && box.y >= 0 && box.y <= 140;
          },
          { timeout: 15_000, message: 'back-to-editor parks tour-section-editor under sticky header' },
        )
        .toBe(true);
      await expect(page.locator('[data-gate-id="editor-pane"] .cm-content').first()).toBeVisible();

      app.assertCleanConsole();
    });
  }

  test('Wod Wiki University outline scrolls to the 9 alternating guide cards, /page/guide-start renders, and /legacy preserves ADR-0010 boundary', async ({
    app,
  }) => {
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

    const thumbLeftOfText = async (idx: number): Promise<boolean> => {
      const card = cards.nth(idx);
      const thumbX = (await card.getByTestId('guide-watch').boundingBox())!.x;
      const textX = (await card.getByRole('link').first().boundingBox())!.x;
      return thumbX < textX;
    };
    expect(await thumbLeftOfText(0)).toBe(true);
    expect(await thumbLeftOfText(1)).toBe(false);

    await cards.first().getByTestId('guide-watch').click();
    await expect(page.getByTestId('youtube-lightbox')).toBeVisible();
    await page.getByTestId('youtube-lightbox-close').click();
    await expect(page.getByTestId('youtube-lightbox')).toBeHidden();

    await app.goto('/page/guide-start');
    await expect(page.getByRole('heading', { name: 'First Workout', exact: true }).first()).toBeVisible();

    // ADR-0010 boundary: /legacy renders the classic playground landing without Home Tour onboarding UI
    await app.goto('/legacy');
    await expect(
      page.getByRole('heading', { name: 'Build and preview widget-driven workout pages.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run this example' })).toBeVisible();
    await expect(page.getByText(/Step 1 of \d+/)).toHaveCount(0);
    await expect(page.getByText('Getting started')).toHaveCount(0);

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
