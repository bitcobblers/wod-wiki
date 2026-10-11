import { expect, test } from '@playwright/test';

test.describe('Mobile folding zones and 2-stage transition', () => {
  test('content width never decreases and zone-4 aside appears only at 1520px+', async ({ page }) => {
    // /guide/* pages drop the desktop L2 sidebar, so the width curve differs
    // from the standard shell this test pins. /journal keeps the full
    // L2/L3 layout: content caps ~984px until the 1280px stage, holds to
    // 1520px, then the zone-4 aside mounts and content re-grows.
    await page.goto('/journal', { waitUntil: 'domcontentloaded' });

    // Selector for content column in SidebarLayout
    const contentColumn = page.locator('main').locator('..');
    const aside = page.locator('aside');

    // 1. Mobile (375px)
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(aside).toBeHidden();
    const mobileHeader = page.locator('header[data-page-sticky-boundary="true"]');
    await expect(mobileHeader).toBeVisible();

    // 2. Compact Desktop (1024px)
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(aside).toBeHidden();
    const box1024 = await contentColumn.boundingBox();
    expect(box1024).not.toBeNull();
    const w1024 = box1024!.width;

    // 3. Pre-breakpoint (1279px)
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(aside).toBeHidden();
    const box1279 = await contentColumn.boundingBox();
    const w1279 = box1279!.width;
    expect(w1279).toBeGreaterThan(w1024);

    // 4. Transition 1: Secondary state start (1280px)
    // Content width MUST NOT drop compared to 1279px
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(aside).toBeHidden();
    const box1280 = await contentColumn.boundingBox();
    const w1280 = box1280!.width;
    expect(w1280).toBeGreaterThanOrEqual(w1279 - 1); // Allow subpixel rounding
    expect(w1280).toBeLessThanOrEqual(985);

    // 5. Intermediate holding state (1400px)
    // Content width remains capped at ~984px, aside remains hidden
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(aside).toBeHidden();
    const box1400 = await contentColumn.boundingBox();
    const w1400 = box1400!.width;
    expect(w1400).toBeLessThanOrEqual(985);
    expect(Math.abs(w1400 - w1280)).toBeLessThan(2);

    // 6. Transition 2: Right panel section swap (1520px)
    // Aside mounts, content width does not decrease
    await page.setViewportSize({ width: 1520, height: 900 });
    await expect(aside).toBeVisible();
    const box1520 = await contentColumn.boundingBox();
    const w1520 = box1520!.width;
    expect(w1520).toBeGreaterThanOrEqual(w1280 - 1);

    // 7. Post-transition proportional growth (1650px)
    // Content width grows proportionally once L3 is shown
    await page.setViewportSize({ width: 1650, height: 900 });
    await expect(aside).toBeVisible();
    const box1650 = await contentColumn.boundingBox();
    const w1650 = box1650!.width;
    expect(w1650).toBeGreaterThan(w1520);
  });
});
