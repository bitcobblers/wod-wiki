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

    test('the run-to-view CTA launches the fullscreen run with reachable controls', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await waitForSeedReady(page)
      await expect(page.getByTestId('sync-activity-indicators')).toHaveCount(0)
      for (const close of await page.locator('[toast-close]').all()) await close.click()
      await expect(page.locator('[data-gate-id="hero-pane"] .cm-content')).toBeVisible()

      // No run yet: the insights section offers the CTA instead of analytics.
      await page.getByTestId('tour-section-insights').scrollIntoViewIfNeeded()
      const cta = page.getByTestId('tour-insights-run')
      await expectTouchable(cta)

      // The CTA triggers the fullscreen run — the same big-screen clock the
      // hero Run opens.
      await tapControl(cta)
      const timer = page.locator('.fixed.inset-0').filter({ has: page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE) })
      await expect(timer).toBeVisible()
      const clock = timer.locator('button.tv-focusable').filter({ has: page.locator('.font-mono.tracking-tighter') })
      await expect(clock).toContainText(/00:0[2-9]/, { timeout: 10_000 })

      const next = timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK)
      const stop = timer.getByTestId(TEST_IDS.TIMER_STOP_SESSION)
      const pause = timer.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE)
      await expectTouchable(next)
      await expectTouchable(stop)
      await expectTouchable(pause)
      await tapControl(pause)
      await expect(pause).toHaveAttribute('title', 'Continue')
      await tapControl(pause)
      await expect(pause).toHaveAttribute('title', 'Pause')
      // Next mid-countdown locks the elapsed time and advances past the
      // last line; Stop then halts the run — the recorded partial closes
      // the fullscreen and lights the insights where the visitor is
      // already looking.
      await tapControl(next)
      await tapControl(stop)
      await expect(timer).toBeHidden({ timeout: 15_000 })
      await expect(page.getByTestId('tour-insights-timeline')).toBeVisible()
      await expect(page.getByTestId('tour-insights-ratio')).toBeVisible()
      await expect(page.getByTestId('tour-insights-reaction')).toBeVisible()
      // The hero editor was untouched by the CTA run.
      await expect(page.locator('[data-gate-id="hero-pane"] .cm-content')).toBeVisible()
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
  // run is built from; two Next clicks then run the workout to its end —
  // the completion closes the fullscreen and reveals the run in the hero.
  await timer.getByText(/results captured/).waitFor({ timeout: 15_000 })
  await timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).click()
  await timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).click()
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
  expect(recorded[0].duration).toBeGreaterThan(0)
  // Reading down and scrolling to the page bottom must not move the
  // viewport (the hero result stays where the visitor put it).
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
  // The recorded run also lit up the insights section below.
  await page.getByTestId('tour-section-insights').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('tour-insights-ratio')).toBeVisible({ timeout: 15_000 })
})

test('sample boards render over example data and the range selector drives them', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForSeedReady(page)
  // The seeded boards ship with the community corpus — the core bundle
  // carries only the canvas/efforts/equipment markdown.
  await syncCommunitySeed(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('tour-section-boards').scrollIntoViewIfNeeded()

  // Two boards, each labelled as example data, no run required.
  const boards = page.getByTestId('tour-section-boards')
  const panes = boards.getByTestId('tour-session-dashboard')
  await expect(panes).toHaveCount(2)
  await expect(boards.getByTestId('tour-session-dashboard-source')).toHaveCount(2)
  for (const pane of await panes.all()) {
    await expect(pane.locator('[data-testid="dashboard-view"]')).toBeVisible({ timeout: 30_000 })
  }

  // The range selector is URL-state shared by the boards — drive it from
  // the first pane; both reflect the same weeks param.
  const firstBoard = panes.first()
  await firstBoard.getByRole('button', { name: '8w', exact: true }).click()
  await expect(page).toHaveURL(/weeks=8/)
  await expect(panes).toHaveCount(2)
  // 16w is the default — selecting it clears the param; 4w writes again.
  await firstBoard.getByRole('button', { name: '4w', exact: true }).click()
  await expect(page).toHaveURL(/weeks=4/)
})
