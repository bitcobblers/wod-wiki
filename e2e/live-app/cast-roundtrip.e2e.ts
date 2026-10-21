/**
 * Cast Sender↔Receiver Round-Trip — behavioral e2e (WOD wayfinder #695)
 *
 * The only behavioral coverage of src/components/organisms/cast. Resolves the
 * ticket's core question: does a real session drive the receiver through its
 * state machine with matching workout data?
 *
 * Harness decision (made at stage open): LocalTabBackend dual-tab FIRST.
 * Rationale — dev builds default VITE_CAST_BACKEND to `local`, so the real
 * Cast button opens a genuine receiver popup (`/receiver-rpc.html?local=<id>`)
 * and exercises the real postMessage handshake + RPC transport. Playwright
 * captures the popup via context 'page' event; the popup shares the browser
 * context (same origin, window.opener intact) so the handshake is faithful.
 * Direct receiver-message injection is the documented fallback if the popup
 * handshake proves unworkable; it was not needed.
 *
 * Receiver state machine (playground/src/receiver-rpc.tsx):
 *   waiting-for-cast  →  (handshake → proxyRuntime set)  →  preview → active → review
 * The waiting screen renders `Wod.Wiki // <connectionStatus>`; once connected
 * the receiver mirrors the sender's workbench state (CONTEXT.md: Workbench
 * Session synced to the receiver via the cast RPC transport).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { navigateToRunPage } from '../pages/WallClockPage';
import { TEST_IDS } from '../contracts/TestIdContract';

// ── Runtime helpers (single home: e2e/pages/WallClockPage.ts, #691) ─────────

async function startWorkoutWithTimer(page: Page, id: string, wodScript: string): Promise<void> {
  await navigateToRunPage(page, id, wodScript);
}

/** Open the cast session and return the receiver popup once it mirrors the sender. */
async function connectReceiver(page: Page, context: BrowserContext): Promise<Page> {
  const castButton = page.getByRole('button', { name: 'Cast to TV' }).first();
  await expect(castButton).toBeVisible({ timeout: 10_000 });
  const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
  await castButton.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/receiver-rpc\.html\?local=/, { timeout: 15_000 });
  await expect(popup.getByText(/up next/i).first()).toBeVisible({ timeout: 30_000 });
  return popup;
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Cast Sender↔Receiver Round-Trip (LocalTabBackend)', () => {
  const senderErrors: string[] = [];
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    senderErrors.length = 0;
    page.on('pageerror', (e) => senderErrors.push(e.message));
    page.on('dialog', (d) => { void d.accept(); });
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    // Preview/production bundles select the Chromecast backend ('auto' →
    // MODE === 'production' in apps/playground/src/services/cast/config.ts;
    // release workflows set VITE_CAST_BACKEND=chromecast explicitly), so no
    // receiver popup exists and this LocalTabBackend round-trip cannot run
    // there. Tracked in #1067 — do not enable against production bundles.
    // A loopback E2E_APP_URL (root's isolated dev server) still runs the dev
    // build with the real LocalTabBackend, so it is allowed; only preview is
    // skipped.
    if (process.env.E2E_TARGET === 'preview') {
      test.skip(true, 'Cast round-trip needs the dev-mode LocalTabBackend; production selects ChromecastBackend (#1067)');
    }
    // Dev mode: a navigation failure fails the test — a silent skip here
    // would hide a broken dev server.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  });

  test('cast handshake connects the receiver popup to the sender session', async ({ page, context }) => {
    await startWorkoutWithTimer(page, 'cast-e2e-connect', '```time\nTimer: 1:00\n5 Burpees\n```');

    const popup = await connectReceiver(page, context);

    // No unhandled errors on either side of the cast link.
    const receiverErrors: string[] = [];
    popup.on('pageerror', (e) => receiverErrors.push(e.message));
    // Deliberate grace window: give async pageerrors on either side of the
    // cast link a beat to surface before asserting clean consoles.
    await popup.waitForTimeout(1_000);
    expect(senderErrors).toEqual([]);
    expect(receiverErrors).toEqual([]);
  });

  test('sender block transitions mirror to the connected receiver', async ({ page, context }) => {
    await startWorkoutWithTimer(page, 'cast-e2e-mirror', '```time\nTimer: 1:00\n5 Burpees\n```');

    const popup = await connectReceiver(page, context);

    // Advancing the sender into its `Timer: 1:00` block must update the
    // receiver's mirrored timer — the receiver's state follows the sender.
    const next = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
    await expect(next).toBeVisible({ timeout: 10_000 });
    await next.click();
    await expect(popup.locator('body')).toContainText('1:00', { timeout: 20_000 });
  });

  test('receiver Next is rejected while paused and resumes through the authority', async ({ page, context }) => {
    test.setTimeout(120_000);
    await startWorkoutWithTimer(page, 'cast-e2e-paused-gate', '```time\nTimer: 1:00\n5 Burpees\n```');

    const popup = await connectReceiver(page, context);
    const senderNext = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
    await senderNext.click(); // Into the Timer block — clock now runs.

    // Sender pauses: snapshot flips to paused, receiver must mirror it —
    // Next disabled with the Continue primary — and must not advance on
    // receiver Enter.
    const senderPlayPause = page.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"]:visible`).first();
    await senderPlayPause.click();
    const receiverNext = popup.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]`).first();
    await expect(receiverNext).toBeDisabled({ timeout: 20_000 });
    // Paused state renders on the shared surface's primary control label.
    await expect(popup.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"][title="Continue"]`).first())
        .toBeVisible({ timeout: 10_000 });

    await receiverNext.focus();
    await popup.keyboard.press('Enter'); // Gated: authority rejects paused next.
    await expect(receiverNext).toBeDisabled();
    await expect(popup.locator('body')).toContainText('1:00');

    // The same key resumes playback through the board's Continue primary —
    // paused state clears on the receiver via the next authoritative snapshot.
    const receiverPlayPause = popup.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"]`).first();
    await receiverPlayPause.focus();
    await popup.keyboard.press('Enter');
    await expect(popup.locator('[title="Pause"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('receiver rep adjustments and numeric entry reach the browser authority', async ({ page, context }) => {
    test.setTimeout(180_000);
    // Plain reps: actual count belongs to the movement occurrence, is
    // adjustable live, and can be overridden through numeric entry.
    await startWorkoutWithTimer(page, 'cast-e2e-reps', '```time\n21 Thrusters\n```');

    const popup = await connectReceiver(page, context);
    const senderNext = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
    await senderNext.click(); // Into the Thrusters block.

    // Receiver board mirrors the occurrence and its unknown actual (unknown
    // differs from zero), then rep adjustments travel the command channel.
    // CLOCK_REP_VALUE renders "<actual> / Target <n>" — assert on the value
    // prefix, not the whole string.
    const repValue = popup.locator(`[data-testid="${TEST_IDS.CLOCK_REP_VALUE}"]`).first();
    await expect(repValue).toBeVisible({ timeout: 20_000 });
    const repPlus = popup.locator(`[data-testid="${TEST_IDS.CLOCK_REP_PLUS}"]`).first();
    await repPlus.click();
    await expect(repValue).toHaveText(/^1\b/, { timeout: 20_000 });
    await repPlus.click();
    await expect(repValue).toHaveText(/^2\b/, { timeout: 20_000 });
    const repMinus = popup.locator(`[data-testid="${TEST_IDS.CLOCK_REP_MINUS}"]`).first();
    await repMinus.click();
    await expect(repValue).toHaveText(/^1\b/, { timeout: 20_000 });

    // Numeric collection: receiver opens the value board, types 17 into the
    // shared entry surface, saves — the authoritative snapshot consumes it
    // (busy ack via saving) and the board reflects the saved actual.
    await popup.keyboard.press('NumpadMultiply');
    const entryInput = popup.getByTestId('entry-value');
    await expect(entryInput).toBeVisible({ timeout: 20_000 });
    await popup.getByTestId('entry-digit-1').focus();
    await popup.keyboard.press('ArrowRight');
    await expect(popup.getByTestId('entry-digit-2')).toBeFocused();
    await popup.keyboard.press('Enter');
    await expect(entryInput).toHaveValue('2');
    await popup.getByTestId('entry-clear').click();
    await popup.keyboard.press('Numpad8');
    await expect(entryInput).toHaveValue('8');
    await popup.keyboard.press('Numpad2');
    await expect(entryInput).toHaveValue('82');
    await popup.keyboard.press('NumpadEnter');
    await expect(popup.locator(`[data-testid="${TEST_IDS.CLOCK_ENTRY_OVERLAY}"]`)).toBeHidden({ timeout: 20_000 });
    await expect(repValue).toHaveText(/^82\b/, { timeout: 20_000 });
    await expect(popup.locator(`[data-testid="${TEST_IDS.CLOCK_ERROR}"]`)).toHaveCount(0, { timeout: 10_000 });
  });
});
