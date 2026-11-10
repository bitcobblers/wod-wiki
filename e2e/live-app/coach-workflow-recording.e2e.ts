import { test, expect } from '@playwright/test';

test.use({
  video: {
    mode: 'on',
    size: { width: 1280, height: 720 },
  },
  viewport: { width: 1280, height: 720 },
});

test('record coach athlete wql workflow walkthrough', async ({ page }) => {
  test.setTimeout(120_000);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 1: The Interactive Architecture & UX Prototype
  // ───────────────────────────────────────────────────────────────────────────
  const protoUrl = `file://${process.cwd()}/docs/design/wql-composer-coach-workflow.prototype.html`;
  await page.goto(protoUrl, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  // Step 1: Start on Screen 1 (Library / Journal Stream)
  const streamTab = page.locator('#tab-screen-stream');
  await streamTab.click();
  await page.waitForTimeout(1500);

  // Cycle effort in stream filter chips (Back Squat -> Thruster -> Snatch)
  const effortChip = page.locator('.filter-chip', { hasText: 'Effort:' });
  if (await effortChip.isVisible()) {
    await effortChip.click();
    await page.waitForTimeout(1000);
    await effortChip.click();
    await page.waitForTimeout(1000);
  }

  // Click "Add to dashboard ->" to trigger promotion from list to chart dialog
  const toDialogBtn = page.locator('#btn-stream-to-dialog');
  await expect(toDialogBtn).toBeVisible();
  await toDialogBtn.click();
  await page.waitForTimeout(1500);

  // Step 2: Now on Screen 2 (Add / Edit Widget Sheet with Sentence Bar + Legend)
  // Toggle metric (e.g. Top Load -> Total Volume)
  const metricSelectBtn = page.locator('.sentence-controls .inline-select').nth(0);
  await metricSelectBtn.click();
  await page.waitForTimeout(1200);

  // Toggle chart type (Line -> Bar)
  const chartSelectBtn = page.locator('.sentence-controls .inline-select').nth(2);
  await chartSelectBtn.click();
  await page.waitForTimeout(1200);

  // Add Target Goal overlay in chart legend
  const addGoalBtn = page.locator('.ghost-pill', { hasText: '+ Target Goal' });
  if (await addGoalBtn.isVisible()) {
    await addGoalBtn.click();
    await page.waitForTimeout(1200);
  }

  // Add 4w Baseline rolling average overlay in chart legend
  const addAvgBtn = page.locator('.ghost-pill', { hasText: '+ 4w Baseline' });
  if (await addAvgBtn.isVisible()) {
    await addAvgBtn.click();
    await page.waitForTimeout(1200);
  }

  // Add Comparison series (e.g. Squad Median / PR)
  const addCompBtn = page.locator('.ghost-pill', { hasText: '+ Compare' });
  if (await addCompBtn.isVisible()) {
    await addCompBtn.click();
    await page.waitForTimeout(1200);
  }

  // Inspect generated multi-stream WQL
  const inspectWqlBtn = page.locator('.wql-toggle');
  await inspectWqlBtn.click();
  await page.waitForTimeout(1500);

  // Save to Dashboard
  const saveToBoardBtn = page.locator('#btn-dialog-to-dashboard');
  await saveToBoardBtn.click();
  await page.waitForTimeout(2000);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 2: The Real Live Playground Application
  // ───────────────────────────────────────────────────────────────────────────
  // Open the real app's catalog
  await page.goto('/efforts', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Search in Catalog using WQL
  const wqlInput = page.locator('[data-testid="wql-text-input"]');
  if (await wqlInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await wqlInput.click();
    await page.waitForTimeout(600);
  }

  // Navigate to prebuilt training block review dashboard
  await page.goto('/dashboard/training-block-review', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Check if read-only banner exists and clone to vault
  const cloneVaultBtn = page.getByTestId('clone-dashboard');
  if (await cloneVaultBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await cloneVaultBtn.click();
    await page.waitForTimeout(2000);
  }

  // Turn on Edit Mode
  const editToggleBtn = page.getByTestId('dashboard-edit-toggle');
  if (await editToggleBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await editToggleBtn.click();
    await page.waitForTimeout(1200);

    // Open Widget Composer
    const addWidgetBtn = page.getByTestId('add-widget');
    if (await addWidgetBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await addWidgetBtn.click();
      await page.waitForTimeout(1500);

      // Demonstrate the promote-to-chart or sentence controls inside modal
      const promoteBtn = page.getByTestId('widget-promote-to-chart');
      if (await promoteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await promoteBtn.click();
        await page.waitForTimeout(1200);
      }

      // Switch sentence metric
      const sentenceMetric = page.getByTestId('widget-sentence-metric');
      if (await sentenceMetric.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sentenceMetric.selectOption({ index: 1 });
        await page.waitForTimeout(1000);
      }

      // Switch visualization
      const sentenceChart = page.getByTestId('widget-sentence-chart');
      if (await sentenceChart.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sentenceChart.selectOption('bar');
        await page.waitForTimeout(1200);
      }

      // Close dialog
      const cancelBtn = page.getByRole('button', { name: 'Cancel' });
      if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  await page.waitForTimeout(2000);
});
