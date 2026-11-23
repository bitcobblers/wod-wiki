// spec: e2e/specs/properties/effort-creation-and-tag-mobile-layout.md
import { test, expect, TEST_IDS, clickStreamAdd } from '../fixtures/playgroundActor';

test.describe('PRP-03 — Effort Creation, WQL Syntax Guidance & Mobile Tag Layout', () => {
  test('Scenario 1: invalid WQL shows syntax hint and newly created Effort resolves immediately on /effort/:slug', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.seed.bundledEfforts();

    await app.goto('/efforts');
    await app.wql.fillStreamQueryBar('kettlebell');

    const status = page.getByTestId('stream-query-status');
    await expect(status).toContainText(':effort');
    await expect(status).toContainText('18 of');

    await app.wql.fillStreamQueryBar(':effort{oops');
    await expect(status).toContainText('Invalid query — showing previous results');
    await expect(status.getByTestId(TEST_IDS.STREAM_QUERY_SYNTAX_HINT)).toHaveText(
      'Syntax: :effort{key:value} — supported keys: effort, discipline, intensity, origin, text. Example: :effort{text:kettlebell}',
    );

    // Create new Effort via View -> + Add dialog (WW-035)
    await clickStreamAdd(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify Catalog section and select Effort option deterministically
    await expect(dialog.getByText('Catalog', { exact: true })).toBeVisible();
    const effortOption = dialog.getByTestId('new-entry-effort');
    await expect(effortOption).toBeVisible();
    await effortOption.click();
    await expect(effortOption).toHaveAttribute('aria-pressed', 'true');

    const titleInput = dialog.getByTestId(TEST_IDS.ENTRY_CREATE_TITLE_INPUT);
    const uniqueName = `QA Turkish Get Up ${Date.now().toString().slice(-4)}`;
    await titleInput.fill(uniqueName);
    await dialog.getByTestId(TEST_IDS.ENTRY_CREATE_SUBMIT_BTN).click();

    await expect(page).toHaveURL(/\/effort\/qa-turkish-get-up/);
    await expect(page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND)).toHaveCount(0);
    await expect(page.locator('main').first()).toContainText(uniqueName);
    app.assertCleanConsole();
  });

  test('Scenario 2: /t/quality/strength fits 375x812 without overflow and unknown /notebook/:slug shows not-found', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });

    // WW-037: Tag drill-down at 375x812 must have zero horizontal overflow
    await app.goto('/t/quality/strength');
    await expect(page.locator('#tags-new')).toBeVisible();
    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(1);

    // Built-in tonnage Tag Property Note renders its synthesized query block preview without syntax errors
    await app.goto('/t/tag/tonnage');
    await expect(page.getByRole('heading', { name: 'Edit tonnage' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cm-query-block-preview').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Query syntax error/i)).toHaveCount(0);

    // WW-032: Unknown notebook slug renders explicit not-found recovery state
    await app.goto('/notebook/does-not-exist-qa');
    const notFound = page.getByTestId(TEST_IDS.NOTEBOOK_NOT_FOUND);
    await expect(notFound).toBeVisible();
    await expect(notFound).toContainText('does-not-exist-qa');
    await expect(page.getByRole('button', { name: /\+ Add Note/i })).toHaveCount(0);

    app.assertCleanConsole();
  });

  test('Scenario 3: mobile effort property inputs stay clear of actions-dock across scroll positions', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await app.seed.bundledEfforts();

    const efforts = await app.properties.openEffort('thruster');
    await efforts.waitForDetailLoaded();

    const properties = efforts.frontmatterProperties();
    const metInput = properties.getByLabel('Value for metrics.met');
    const detailsToggle = page.getByRole('button', { name: 'Show property details' });
    if (await detailsToggle.isVisible()) {
      await detailsToggle.click();
    }
    await expect(metInput).toBeVisible();
    await expect(properties.getByLabel('Value for discipline')).toBeVisible();

    const dock = page.getByTestId('actions-dock');
    await expect(dock).toBeAttached();

    // Tapping MET input must focus it cleanly without dock interception
    await metInput.click();
    await expect(metInput).toBeFocused();

    const { scrollHeight, viewportHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));

    let revealedPositions = 0;
    const conflicts: string[] = [];
    for (let y = 0; y <= scrollHeight - viewportHeight + 200; y += 200) {
      await page.evaluate(
        (top) =>
          new Promise<void>((resolve) => {
            window.scrollTo(0, top);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
        y,
      );
      const stepResult = await page.evaluate(() => {
        const dockEl = document.querySelector<HTMLElement>('[data-testid="actions-dock"]');
        if (!dockEl) return { revealed: false, hits: [] as string[] };
        const cs = getComputedStyle(dockEl);
        const dr = dockEl.getBoundingClientRect();
        const revealed =
          cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && dr.bottom > 0 && dr.top < window.innerHeight;
        if (!revealed) return { revealed: false, hits: [] as string[] };
        const hits: string[] = [];
        const controls = Array.from(dockEl.querySelectorAll<HTMLElement>('button, a'));
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.cm-frontmatter-preview input'));
        for (const input of inputs) {
          const ir = input.getBoundingClientRect();
          if (ir.width <= 4 || ir.height <= 4 || ir.bottom <= 0 || ir.top >= window.innerHeight) continue;
          for (const ctrl of controls) {
            const cr = ctrl.getBoundingClientRect();
            const overlaps =
              ir.left + 2 < cr.right - 1 &&
              cr.left + 1 < ir.right - 2 &&
              ir.top + 2 < cr.bottom - 1 &&
              cr.top + 1 < ir.bottom - 2;
            if (overlaps) {
              hits.push(`${input.getAttribute('aria-label') ?? 'input'} vs ${ctrl.getAttribute('aria-label') ?? ctrl.textContent}`);
            }
          }
        }
        return { revealed: true, hits };
      });
      if (stepResult.revealed) {
        revealedPositions += 1;
        conflicts.push(...stepResult.hits);
      }
    }

    expect(revealedPositions).toBeGreaterThan(0);
    expect(conflicts).toEqual([]);
    app.assertCleanConsole();
  });
});
