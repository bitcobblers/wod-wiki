import { expect, test, type Page } from '@playwright/test';
import { EffortsPage } from '../pages/EffortsPage';
import { seedBundledEfforts } from '../helpers/seedEfforts';
import { gotoFeedSurface } from '../helpers/feedReadiness';

/**
 * property-responsive-defects.e2e.ts — dogfood findings #11 and #12.
 *
 * #11: at 375×812 the fixed thumb dock (page Clone action, search FAB, ⋮
 * overflow menu) overlaps the effort detail property form and intercepts
 * taps aimed at the metrics.met / discipline / adjacent inputs. The dock's
 * scroll auto-hide reveals it at arbitrary scroll positions, so the page
 * must keep every input out of the dock's occupied region at ALL scroll
 * offsets, and where content and dock share a pixel the input must win the
 * hit test.
 *
 * #12: the home page mounts its chart-bearing insight panes twice (desktop
 * sticky + mobile sequential arrangements); the hidden copies initialize
 * their Recharts ResponsiveContainers inside display:none subtrees, logging
 * repeated "The width(0) and height(0) of chart should be greater than 0"
 * warnings on a clean load.
 */

const MOBILE = { width: 375, height: 812 } as const;
const ZERO_SIZE_CHART_WARNING = /of chart should be greater than 0/;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DockConflict {
  scrollY: number;
  input: string;
  control: string;
  inputRect: Rect;
  controlRect: Rect;
  hitTest: string;
}

/** Scroll to a position and report whether the normal-flow action row is visible. */
async function revealDockAt(page: Page, y: number): Promise<boolean> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  return page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('[data-testid="actions-dock"]');
    if (!dock) return false;
    const cs = getComputedStyle(dock);
    const rect = dock.getBoundingClientRect();
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && rect.bottom > 0 && rect.top < window.innerHeight;
  });
}

/**
 * Sweep the current scroll position: every visible frontmatter property input
 * must be disjoint from every revealed dock control, and where they share a
 * pixel the hit test must resolve to the input.
 */
async function collectDockConflicts(page: Page): Promise<DockConflict[]> {
  const scrollY = await page.evaluate(() => window.scrollY);
  const conflicts = await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('[data-testid="actions-dock"]');
    if (!dock) return [];
    const found: Array<Omit<DockConflict, 'scrollY'>> = [];
    const controls = Array.from(dock.querySelectorAll<HTMLElement>('button, a'));
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('.cm-frontmatter-preview input'),
    );
    const shrink = (r: DOMRect, px: number) => ({
      x: r.left + px,
      y: r.top + px,
      width: r.width - 2 * px,
      height: r.height - 2 * px,
    });
    const overlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    for (const input of inputs) {
      const ir = shrink(input.getBoundingClientRect(), 2);
      if (ir.width <= 0 || ir.height <= 0) continue;
      // Only fields actually in the viewport can be tapped here.
      if (ir.y >= window.innerHeight || ir.y + ir.height <= 0) continue;
      for (const control of controls) {
        const cr = shrink(control.getBoundingClientRect(), 1);
        if (!overlap(ir, cr)) continue;
        const cx = (Math.max(ir.x, cr.x) + Math.min(ir.x + ir.width, cr.x + cr.width)) / 2;
        const cy = (Math.max(ir.y, cr.y) + Math.min(ir.y + ir.height, cr.y + cr.height)) / 2;
        const hit = document.elementFromPoint(cx, cy);
        found.push({
          input:
            input.getAttribute('aria-label') ??
            input.dataset.frontmatterProperty ??
            'unlabeled property input',
          control:
            control.getAttribute('data-testid') ??
            control.getAttribute('aria-label') ??
            control.textContent?.trim() ??
            'dock control',
          inputRect: { x: Math.round(ir.x), y: Math.round(ir.y), width: Math.round(ir.width), height: Math.round(ir.height) },
          controlRect: { x: Math.round(cr.x), y: Math.round(cr.y), width: Math.round(cr.width), height: Math.round(cr.height) },
          hitTest: hit
            ? hit === input
              ? 'input'
              : `${hit.tagName.toLowerCase()}${(hit as HTMLElement).dataset.testid ? `[data-testid="${(hit as HTMLElement).dataset.testid}"]` : ''}`
            : 'none',
        });
      }
    }
    return found;
  });
  return conflicts.map((c) => ({ ...c, scrollY }));
}

test.describe('effort properties vs fixed dock at 375×812 (finding #11)', () => {
  test.use({ viewport: MOBILE });

  test('dock controls never cover or intercept effort property inputs at mobile scroll positions', async ({ page }) => {
    const efforts = new EffortsPage(page);

    // Bundled corpus is community content: seed the fixture row this test renders.
    await gotoFeedSurface(page, '/effort/thruster');
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();

    const properties = efforts.frontmatterProperties();
    await expect(properties).toBeVisible();

    // The preview boots in summary mode; the reported fields live in the
    // detailed table — expand it the way a user does.
    const detailsToggle = page.getByRole('button', { name: 'Show property details' });
    if (await detailsToggle.isVisible().catch(() => false)) {
      await detailsToggle.click();
    }
    // The reported fields: metrics.met, discipline, and their neighbors.
    await expect(properties.getByLabel('MET value')).toBeVisible();
    await expect(properties.getByLabel('Discipline', { exact: true })).toBeVisible();

    const dock = page.getByTestId('actions-dock');
    await expect(dock).toBeAttached();

    const { scrollHeight, viewportHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));

    const conflicts: DockConflict[] = [];
    const step = 200;
    const positions: number[] = [];
    for (let y = 0; y < scrollHeight - viewportHeight; y += step) positions.push(y);
    positions.push(scrollHeight);

    // Positive control: the dock must still reveal at clear positions — a
    // dock that never shows would pass the sweep vacuously.
    let revealedPositions = 0;
    for (const y of positions) {
      const revealed = await revealDockAt(page, y);
      if (!revealed) continue; // content guard keeps the dock hidden here
      revealedPositions += 1;
      conflicts.push(...(await collectDockConflicts(page)));
    }

    expect(
      revealedPositions,
      'dock never revealed during the sweep — it must remain reachable where content is clear',
    ).toBeGreaterThan(0);
    expect(
      conflicts,
      `revealed dock controls overlap/intercept property inputs:\n${conflicts
        .map((c) => `  scrollY=${c.scrollY} input="${c.input}" control="${c.control}" rects=${JSON.stringify(c.inputRect)}×${JSON.stringify(c.controlRect)} hitTest=${c.hitTest}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('expanding property details never parks the dock on the new fields — including while an input is focused', async ({ page }) => {
    const efforts = new EffortsPage(page);

    await gotoFeedSurface(page, '/effort/thruster');
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();

    // Expand at the very top of the page: the detailed fields appear with
    // no scroll event, and the normal-flow action row cannot overlap them.
    const detailsToggle = page.getByRole('button', { name: 'Show property details' });
    await expect(detailsToggle).toBeVisible();
    await detailsToggle.click();

    const properties = efforts.frontmatterProperties();
    await expect(properties.getByLabel('MET value')).toBeVisible();
    await expect(properties.getByLabel('Discipline', { exact: true })).toBeVisible();
    await expect(page.getByTestId('actions-dock')).toBeAttached();

    // No dock button may intersect or hit-test-cover a freshly inserted field.
    const expanded = await collectDockConflicts(page);
    expect(
      expanded,
      `dock overlaps fields immediately after expanding details:\n${JSON.stringify(expanded, null, 2)}`,
    ).toEqual([]);

    // A tap on the MET field must land on the field itself (Playwright
    // verifies the hit target — a covering dock fails this click). The
    // focused-input state is the keyboard-open case in environments with a
    // soft keyboard: the dock stays put only while the zone stays clear.
    const met = properties.getByLabel('MET value');
    await met.click();
    await expect(met).toBeFocused();

    const focused = await collectDockConflicts(page);
    expect(
      focused,
      `dock overlaps property inputs while one is focused:\n${JSON.stringify(focused, null, 2)}`,
    ).toEqual([]);
  });
});

for (const viewport of [
  { name: 'mobile', size: MOBILE },
  { name: 'desktop', size: { width: 1440, height: 900 } },
]) {
  test.describe(`home chart mounting at ${viewport.name} (finding #12)`, () => {
    test('clean load initializes every home chart with a real box and no zero-size warnings', async ({ page }) => {
      const warnings: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'warning' && ZERO_SIZE_CHART_WARNING.test(message.text())) {
          warnings.push(message.text());
        }
      });

      await page.setViewportSize(viewport.size);
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // The boards pane mounts its charts once seed content resolves; the
      // clean-load warnings fire during exactly that initialization.
      await expect
        .poll(() => page.locator('.recharts-responsive-container').count(), {
          message: 'seeded example board charts must mount on home',
          timeout: 30_000,
        })
        .toBeGreaterThan(0);

      // Exercise the scroll-driven scope flip so both arrangements have run.
      await page.locator('[data-testid="tour-section-insights"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);

      expect(
        warnings,
        `charts initialized at zero dimensions ${viewport.name}: ${warnings.length} warning(s), first: ${warnings[0] ?? ''}`,
      ).toEqual([]);

      const zeroBoxes = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.recharts-responsive-container')).filter(
          (el) => {
            const r = el.getBoundingClientRect();
            return r.width <= 0 || r.height <= 0;
          },
        ).length,
      );
      expect(
        zeroBoxes,
        `${zeroBoxes} chart container(s) mounted inside hidden/zero-size containers — the hidden breakpoint duplicate of the home insight panes`,
      ).toBe(0);
    });
  });
}
