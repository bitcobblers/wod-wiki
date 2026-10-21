import { Page, Locator, expect } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { TEST_IDS } from '../contracts/TestIdContract';

/**
 * WallClockPage — Page Object for /tracker/:runtimeId
 *
 * A full-screen overlay (FocusedDialog + RuntimeTimerPanel) that runs a
 * compiled ScriptBlock.  This is NOT a NoteEditor page, but it is part of the
 * Note Template execution flow.
 */
export class WallClockPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  async goto(runtimeId: string) {
    await this.page.goto(`/tracker/${runtimeId}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await this.waitForLoad();
  }

  async waitForLoad() {
    // Wait for the timer overlay to appear
    await this.page.waitForSelector(`[data-testid="${TEST_IDS.FOCUSED_DIALOG_CLOSE}"]`, { timeout: 15_000 });
  }

  // ── Overlay chrome ───────────────────────────────────────────────────────

  overlay(): Locator {
    return this.page.locator('.fixed.inset-0.z-\[100\]').first();
  }

  closeButton(): Locator {
    return this.page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
  }

  async clickClose() {
    await this.closeButton().click();
  }

  // ── Timer controls ───────────────────────────────────────────────────────

  /** Main timer circle — toggles play/pause. */
  timerCircle(): Locator {
    return this.page.locator('button:has(.title-play), button:has(.title-pause)').first();
  }

  startButton(): Locator {
    return this.page.locator('.title-play').first();
  }

  pauseButton(): Locator {
    return this.page.locator('.title-pause').first();
  }

  stopButton(): Locator {
    return this.page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first();
  }

  nextButton(): Locator {
    return this.page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
  }

  async clickStart() {
    await this.timerCircle().click();
  }

  async clickPause() {
    await this.timerCircle().click();
  }

  async clickStop() {
    await this.stopButton().click();
  }

  async clickNext() {
    await this.nextButton().click();
  }

  // ── Timer display ────────────────────────────────────────────────────────

  timerDisplay(): Locator {
    return this.page.locator('.font-mono.font-semibold.tracking-tighter').first();
  }

  async timerText(): Promise<string> {
    return this.timerDisplay().innerText();
  }

  // ── State assertions ─────────────────────────────────────────────────────

  async expectOverlayVisible() {
    await expect(this.overlay()).toBeVisible();
  }

  async expectOverlayHidden() {
    await expect(this.overlay()).toBeHidden();
  }

  async expectTimerRunning() {
    await expect(this.pauseButton()).toBeVisible({ timeout: 5_000 });
  }

  async expectTimerPaused() {
    await expect(this.startButton()).toBeVisible({ timeout: 5_000 });
  }
}

// ── Runtime-flow helpers (single home — the per-spec copies were #691) ────

/** Main timer display, parsed to seconds. Throws on unparseable text. */
export async function timerSeconds(page: Page): Promise<number> {
  const text = await page
    .locator('.font-mono.tracking-tighter')
    .first()
    .innerText();
  const m = text.match(/(\d{1,3}):(\d{2})/);
  if (!m) throw new Error(`Unparseable timer text: "${text}"`);
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

export const playIconButton = (page: Page): Locator =>
  page.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"][title="Start"]:visible, [data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"][title="Continue"]:visible`).first();
export const pauseIconButton = (page: Page): Locator =>
  page.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"][title="Pause"]:visible`).first();

/**
 * Seed a playground note with one wod block, open it, and press Play.
 * Returns once the app is on the /run/:runtimeId route with the timer
 * overlay mounted. Does NOT wait for runtime initialization — see #699.
 */
export async function navigateToRunPage(page: Page, id: string, wodScript: string): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
  await seedNote(page, `playground/${id}`, `# ${id}\n\n${wodScript}`, {
    type: 'playground',
    title: id,
  });
  await page.goto(`/playground/${id}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await expect(page.locator('.cm-content[contenteditable="true"]').first()).toBeAttached({ timeout: 10_000 });

  // Blocks-parsed signal: the Play overlay button itself (bounded auto-wait,
  // replaces the fixed 2s "let blocks parse" sleep).
  const play = page.getByRole('button', { name: 'Play', exact: true }).first();
  await expect(play).toBeVisible({ timeout: 10_000 });
  // DOM click, not pointer click: the block overlay's decoration layers
  // intermittently cover the button's center point, so pointer events land
  // on the overlay instead of the button (force-click included). el.click()
  // bypasses hit-testing and still fires the React handler.
  await play.evaluate((el) => (el as HTMLElement).click());

  // PlaygroundNotePage uses enableInlineRuntime={false} → tracker route.
  await page.waitForURL(/\/(tracker|run)\//, { timeout: 10_000 });
  // The FocusedDialog close button is present whether the runtime is
  // initializing, ready, or running — the stable "overlay mounted" signal.
  await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeVisible({ timeout: 8_000 });
}

/**
 * navigateToRunPage + reach a RUNNING session. The session may sit at the
 * SessionRoot gate ("Ready to Start") or auto-advance depending on the
 * pre-run collection flow — handle both without assuming the heading.
 */
export async function startWorkoutFromPlayground(page: Page, id: string, wodScript: string): Promise<void> {
  await navigateToRunPage(page, id, wodScript);
  const readyHeading = page.getByRole('heading', { name: 'Ready to Start' });
  const paused = pauseIconButton(page);
  await Promise.race([
    readyHeading.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
    paused.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
  ]);
  // The run route starts the *session* clock but may leave the workout at the
  // SessionRoot gate ("Ready to Start", elapsed counting up). Next advances
  // into the first real block — the countdown timer mounts and runs there.
  if (await readyHeading.isVisible().catch(() => false)) {
    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
  }
  await expect(paused).toBeVisible({ timeout: 8_000 });
}

/** Click Next until the app lands on the completion route (/sessions/:id,
 *  retired /review, or /results — or fail after maxClicks). */
export async function advanceUntilReview(page: Page, maxClicks = 8): Promise<void> {
  for (let i = 0; i < maxClicks; i++) {
    if (/\/(dashboard|review|results|sessions?)/.test(page.url())) return;
    const next = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
    if ((await next.count()) === 0) break;
    await next.click().catch(() => {});
    await page.waitForURL(/\/(dashboard|review|results|sessions?)/, { timeout: 8_000 }).catch(() => {});
    if (/\/(dashboard|review|results|sessions?)/.test(page.url())) return;
    // Bounded wait for the advanced block's Next control to mount — replaces
    // the fixed 1.5s settle between clicks.
    await page
      .locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {});
  }
  await page.waitForURL(/\/(dashboard|review|results|sessions?)/, { timeout: 5_000 });
}
