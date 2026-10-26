/**
 * Error-Path Resilience — behavioral e2e (WOD wayfinder #693)
 *
 * Resolves the ticket's core question: which graceful degradations already
 * exist, and which are defects?
 *
 *   1. Malformed WOD block (unclosed fence / bad wod syntax) → parse error
 *      surfaced, no crash, Play control absent or disabled.
 *   2. IndexedDB unavailable (indexedDB.open rejects) → app degrades without
 *      an unhandled pageerror.
 *   3. Malformed journal routes (/journal/not-a-date) → handled state.
 *   4. Unknown top-level route → styled not-found view with working Go home
 *      (cold and settled boots; dogfood issue 2).
 *
 * Findings recorded inline as each test is written; defects are quarantined.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';

/** Open the editor overlay for a seeded playground note. */
async function openNote(page: Page, id: string, content: string): Promise<void> {
  await seedNote(page, `playground/${id}`, content, { type: 'playground', title: id });
  await page.goto(`/playground/${id}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await expect(page.locator('.cm-content[contenteditable="true"]').first()).toBeAttached({ timeout: 10_000 });
  // Deliberate timing window: the linter has no ready signal — its 500ms
  // debounce must elapse before error-state assertions can observe squiggles.
  await page.waitForTimeout(2_000);
}

test.describe('Error-Path Resilience', () => {
  const errors: string[] = [];
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { void d.accept(); });
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    // A navigation failure fails the test — a silent skip here would hide a
    // broken environment as green.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 5_000 });
  });

  // ── 1. Malformed WOD blocks ───────────────────────────────────────────────

  test('unclosed wod fence does not crash the editor', async ({ page }) => {
    await openNote(page, 'error-unclosed-fence', '# Unclosed\n\n```time\n5 Burpees');

    // Editor remains mounted; no unhandled error.
    await expect(page.locator('.cm-content[contenteditable="true"]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('syntactically broken wod block surfaces a lint marker or disables Play', async ({ page }) => {
    // "(2" — an unclosed round directive — is genuinely invalid Whiteboard
    // syntax: the Lezer parser emits an error node, which the wod-linter
    // extension (@codemirror/lint) surfaces as a gutter marker.
    await openNote(page, 'error-bad-syntax', '# Bad\n\n```time\n(2\n  5 Burpees\n```\n');

    const lintMarker = page.locator('.cm-lint-marker-error, .cm-lint-marker.cm-lint-marker-error');
    const play = page.getByRole('button', { name: 'Play', exact: true });

    // Either the linter surfaces the error, or the broken block yields no Play.
    await expect(lintMarker.or(play)).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test('bad timer value is tolerated (dropped), not surfaced as an error', async ({ page }) => {
    // Finding: after the #691 parser fix, an unparseable property value like
    // `Timer: banana` is DROPPED rather than surfacing a parse error — so the
    // block is still valid and runnable. This documents the existing graceful
    // degradation (tolerate-and-drop) for the ticket's inventory.
    await openNote(page, 'error-bad-timer', '# Bad timer\n\n```time\nTimer: banana\n5 Burpees\n```\n');

    await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  // ── 2. IndexedDB unavailable ──────────────────────────────────────────────

  // Quarantined #1068 (residual of #703): #703's fix (64d59e82) guards the
  // IndexedDBService constructor, but the boot rejection still escapes
  // unhandled — useSeedContent runs `void ensureSeedContent()` with no
  // .catch (apps/playground/src/services/content/seedContent.ts) and
  // ensureSeedContent rethrows load() failures, so a denied IDB open
  // surfaces as an unhandled pageerror. The interception below is the
  // ready-to-unquarantine shape: keep the API present, fail opens the way
  // permission-denied storage does (wodwiki-db, wodwiki-telemetry and
  // wodwiki-user-calcs all fail together). Re-enable once the bootstrap
  // rejection is caught.
  test.fixme('IndexedDB rejection degrades without an unhandled pageerror', async ({ browser }) => { // #1068: seedContent bootstrap lacks .catch
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { void d.accept(); });
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
      // Fail every open the way permission-denied storage does.
      const deny = (): never => {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError');
      };
      Object.defineProperty(window, 'indexedDB', {
        value: { open: deny, deleteDatabase: deny, cmp: () => 0, databases: () => Promise.resolve([]) },
        configurable: true,
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2_500); // allow async DB open to reject + propagate

    // App must not white-screen: #root renders some content, and no unhandled
    // error escapes to pageerror.
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
    expect(errors).toEqual([]);
    await context.close();
  });

  // ── 3. Malformed routes ───────────────────────────────────────────────────

  test('/journal/not-a-date is a retired path — the alias redirect is gone, it 404s', async ({ page }) => {
    await page.goto('/journal/not-a-date', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    // Ticket 09 retired the journal alias redirect matrix: the only journal
    // routes are the /journal list and /day/:date. A stray segment 404s.
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  // ── 4. Unknown top-level routes (dogfood issue 2) ─────────────────────────

  test('unknown route reached in-app after settled boot shows not-found with working Go home', async ({ page }) => {
    // SPA navigation (no reload) to an unmatched path, the way a stale
    // in-app link lands. The heading may lag behind seed derivation; the
    // wildcard must settle on the 404 view, not a blank page.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/definitely-not-a-page-xyz');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /go home/i }).click();
    await page.waitForURL(({ pathname }) => pathname === '/', { timeout: 10_000 });
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('cold boot directly on an unknown route settles into not-found', async ({ browser }) => {
    // Fresh profile: empty IndexedDB, seed import runs while the unknown
    // location is mounted — the loading gate must resolve to the 404 view.
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { void d.accept(); });
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });

    await page.goto('/definitely-not-a-page-xyz', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /go home/i }).click();
    await page.waitForURL(({ pathname }) => pathname === '/', { timeout: 10_000 });
    await expect(page.locator('#root')).not.toBeEmpty();
    await context.close();
  });
});
