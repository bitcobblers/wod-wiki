import { expect, test, type Locator } from '@playwright/test'
import { syncCommunitySeed, waitForSeedReady } from '../helpers/seedReadiness'
import { TEST_IDS } from '../contracts/TestIdContract'
import { getSessions } from '../utils/sessionsDb'

async function expectTouchable(control: Locator) {
  await expect(control).toBeVisible()
  await expect.poll(() => control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width >= 44 && rect.height >= 44 && [
      [rect.x + rect.width / 2, rect.top + 8],
      [rect.x + rect.width / 2, rect.bottom - 8],
      [rect.left + 8, rect.y + rect.height / 2],
      [rect.right - 8, rect.y + rect.height / 2],
    ].every(([x, y]) => element.contains(document.elementFromPoint(x, y)))
  }), { message: 'Entire timer control must be touchable without scrolling its panel' }).toBe(true)
}

async function tapControl(control: Locator) {
  await expectTouchable(control)
  const box = await control.boundingBox()
  if (!box) throw new Error('Missing timer control')
  // Locator.tap scrolls sticky ancestors and changes the tour's active stage.
  await control.page().touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wodwiki.profileInitialized.v1', 'true')
    localStorage.setItem('wod-wiki-playground-theme', 'light')
  })
})

for (const viewport of [
  { width: 375, height: 812 },
  { width: 812, height: 375 },
  { width: 1440, height: 1000 },
]) {
  test.describe(`Homepage timer ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true })

    test('inline controls remain reachable and can pause, advance, and stop the run', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await waitForSeedReady(page)
      await expect(page.getByTestId('sync-activity-indicators')).toHaveCount(0)
      for (const close of await page.locator('[toast-close]').all()) await close.click()
      await expect(page.locator('[data-gate-id="hero-pane"] .cm-content')).toBeVisible()
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        const runway = document.querySelector<HTMLElement>('#tour-section-run [data-testid="tour-runway"]')
        if (!runway) throw new Error('Missing timer runway')
        window.scrollTo({
          top: scrollY + runway.getBoundingClientRect().top + 0.24 * (runway.offsetHeight - innerHeight),
          behavior: 'instant',
        })
      })
      const pane = page.locator('[data-gate-id="run-pane"]')
      const next = pane.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK)
      const stop = pane.getByTestId(TEST_IDS.TIMER_STOP_SESSION)
      const pause = pane.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE)
      await expectTouchable(next)
      await expectTouchable(stop)
      await expectTouchable(pause)
      await expect(pane).toHaveAttribute('data-scroll-gate', 'yield')
      await tapControl(pause)
      await expect(pause).toHaveAttribute('title', 'Continue')
      await tapControl(pause)
      await expect(pause).toHaveAttribute('title', 'Pause')
      await tapControl(next)
      await tapControl(stop)
      await expect(pane.getByRole('button', { name: 'Run timer', exact: true })).toBeEnabled()
      expect(errors).toEqual([])
    })
  })
}

test('hero run expands the result pane under the sticky header and returns to an editable workout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForSeedReady(page)
  const previousSessions = new Set((await getSessions(page)).map(session => session.id))
  await page.locator('[data-gate-id="hero-pane"]').getByRole('button', { name: 'Run', exact: true }).click()
  const timer = page.locator('.fixed.inset-0').filter({ has: page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE) })
  const clock = timer.locator('button.tv-focusable').filter({ has: page.locator('.font-mono.tracking-tighter') })
  await expect(clock).toContainText(/00:0[2-9]/, { timeout: 10_000 })
  // The 0:03 countdown block completes at ~3s and emits the statements the
  // partial is built from — stopping before any block completes records an
  // empty 0:00 session (welcome-1's session keeps running for 30s).
  await timer.getByText(/results captured/).waitFor({ timeout: 15_000 })
  await timer.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(timer).toBeHidden({ timeout: 15_000 })
  const gate = page.locator('[data-gate-id="hero-pane"]')
  const result = gate.getByTestId('tour-session-result')
  await expect(result).toBeVisible()
  // The pane expands to the full result content — no statements clipped
  // into an inner scrollbar — and the reveal glide parks its top right
  // under the sticky header, past the "Write it. Time it." heading.
  const scrollRegion = result.locator('.overflow-y-auto').first()
  await expect.poll(() => scrollRegion.evaluate((el) => el.scrollHeight - el.clientHeight),
    { message: 'statements table must not clip into an inner scrollbar' }).toBeLessThanOrEqual(1)
  await expect(result.getByTestId('tour-session-result-dismiss-top')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY),
    { message: 'reveal scrolls past the hero heading' }).toBeGreaterThan(0)
  await expect.poll(async () => {
    const box = await gate.boundingBox()
    return !!box && box.y >= 0 && box.y <= 140
  }, { message: 'expanded pane parked right under the sticky header' }).toBe(true)
  const recorded = (await getSessions(page)).filter(session => !previousSessions.has(session.id))
  expect(recorded).toHaveLength(1)
  // A real partial: the stopped execution's elapsed time is recorded
  // against a run that never reached natural completion.
  expect(recorded[0].duration).toBeGreaterThan(0)
  expect(recorded[0].completed).toBe(false)
  // Expanding with events grows the pane over the run section — reading
  // down and scrolling to the page bottom must not trip the tour demo's
  // stage scroll (the viewport stays where the visitor put it).
  await result.getByTestId('output-filter-preset-all').click()
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)))
  // Bottom reset still works below the fold and the return glide parks the
  // editor pane back under the sticky header — not stranded wherever the
  // results were being read.
  await result.getByTestId('tour-session-result-dismiss').click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect.poll(async () => {
    const box = await gate.boundingBox()
    return !!box && box.y >= 0 && box.y <= 140
  }, { message: 'editor pane parked back under the sticky header' }).toBe(true)
  await expect(page.locator('[data-gate-id="hero-pane"] .cm-content')).toBeVisible()
})

test('dashboard range changes its totals and analytics stop after leaving the section', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForSeedReady(page)
  await syncCommunitySeed(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-gate-id="hero-pane"] .cm-content')).toBeVisible()
  const dashboard = page.locator('#tour-section-run').getByTestId('tour-session-dashboard')
  await expect(dashboard).toHaveCount(0)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const runway = document.querySelector<HTMLElement>('#tour-section-run [data-testid="tour-runway"]')
    if (!runway) throw new Error('Missing timer runway')
    window.scrollTo({
      top: scrollY + runway.getBoundingClientRect().top + 0.99 * (runway.offsetHeight - innerHeight),
      behavior: 'instant',
    })
  })
  const volume = dashboard.locator('[id^="widget-"]').filter({
    has: page.getByRole('heading', { name: 'Total volume', exact: true }),
  }).locator('.tabular-nums')
  await expect(volume).toContainText(/[1-9]/)
  const fullRangeVolume = await volume.innerText()
  await dashboard.getByRole('button', { name: '8w', exact: true }).click()
  await expect(page).toHaveURL(/weeks=8/)
  await expect(volume).not.toHaveText(fullRangeVolume)
  await dashboard.getByRole('button', { name: '16w', exact: true }).click()
  await expect(volume).toHaveText(fullRangeVolume)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  })
  await expect(dashboard).toHaveCount(0)
})
