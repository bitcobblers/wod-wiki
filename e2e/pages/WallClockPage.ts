import { Page, Locator, expect } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { TEST_IDS } from '../contracts/TestIdContract';

/**
 * WallClockPage — Page Object for /run/:runtimeId
 *
 * A full-screen overlay (FocusedDialog + FullscreenTimer) that runs a
 * compiled ScriptBlock. This is NOT a NoteEditor page, but it is part of the
 * Note Template execution flow.
 */
export class WallClockPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  async goto(runtimeId: string) {
    await this.page.goto(`/run/${runtimeId}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await this.waitForLoad();
  }

  async waitForLoad() {
    // Wait for the timer overlay to appear
    await this.page.waitForSelector(`[data-testid="${TEST_IDS.FOCUSED_DIALOG_CLOSE}"]`, { timeout: 15_000 });
  }

  // ── Overlay chrome ───────────────────────────────────────────────────────

  overlay(): Locator {
    return this.page
      .locator(
        `[data-testid="${TEST_IDS.TIMER_FULLSCREEN_OVERLAY}"], [role="dialog"]:has([data-testid="${TEST_IDS.FOCUSED_DIALOG_CLOSE}"])`,
      )
      .first();
  }

  closeButton(): Locator {
    return this.page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
  }

  async clickClose() {
    await this.closeButton().click();
  }

  // ── Timer controls ───────────────────────────────────────────────────────

  /** Primary play/pause control button. */
  timerCircle(): Locator {
    return this.page.locator(`[data-testid="${TEST_IDS.TIMER_PLAY_PAUSE}"]:visible`).first();
  }

  startButton(): Locator {
    return playIconButton(this.page);
  }

  pauseButton(): Locator {
    return pauseIconButton(this.page);
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
    return this.page.locator(`[data-testid="${TEST_IDS.TIMER_DISPLAY}"]:visible`).first();
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
    .locator(`[data-testid="${TEST_IDS.TIMER_DISPLAY}"]:visible`)
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

  // Blocks-parsed signal: the Play/Start workout button on InlineCommandBar.
  const play = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
  await expect(play).toBeVisible({ timeout: 10_000 });
  await play.click();

  // PlaygroundNotePage uses enableInlineRuntime={false} → /run/:runtimeId route.
  await page.waitForURL(/\/run\//, { timeout: 10_000 });
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

/** Advance Next until the review surface appears: the inline "Workout
 *  Complete" dialog on /run (the fullscreen review stays mounted on /run
 *  until it is explicitly exited) or a canonical completion route
 *  (/results/:id or /sessions — or fail after maxClicks). */
export async function advanceUntilReview(page: Page, maxClicks = 8): Promise<void> {
  const reviewDialog = page.getByRole('dialog', { name: 'Workout Complete' });
  const atReview = async (): Promise<boolean> =>
    /\/(results|sessions?)\b/.test(page.url()) ||
    (await reviewDialog.isVisible().catch(() => false));
  // Race both completion signals; whichever lands first resolves the wait.
  const waitReview = (timeout: number): Promise<void> =>
    Promise.race([
      page.waitForURL(/\/(results|sessions?)\b/, { timeout }).catch(() => {}),
      reviewDialog.waitFor({ state: 'visible', timeout }).catch(() => {}),
    ]);
  const closeOverlay = page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
  const nextBtn = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
  if (!(await atReview())) {
    await Promise.race([
      waitReview(15_000),
      closeOverlay.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      nextBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    ]);
  }
  for (let i = 0; i < maxClicks; i++) {
    if (await atReview()) return;
    const visibleNext = await nextBtn
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (!visibleNext) {
      await waitReview(8_000);
      break;
    }
    await nextBtn.click({ timeout: 1_500 }).catch(() => {});
    await waitReview(600);
  }
  if (!(await atReview())) {
    await waitReview(8_000);
  }
  if (!(await atReview())) {
    throw new Error(`advanceUntilReview: review never appeared after ${maxClicks} Next clicks (url: ${page.url()})`);
  }
}
