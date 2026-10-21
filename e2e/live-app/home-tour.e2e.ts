import { expect, test, type Locator } from '@playwright/test'
import { syncSeed, waitForSeedReady } from '../helpers/seedReadiness'
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
      // Sync-complete notifications publish a beat after the indicators
      // clear; dismiss the stack through its close buttons only once it
      // has stopped landing, so no toast overlaps the checks below.
      await expect.poll(async () => {
        for (const close of await page.locator('[toast-close]').all()) await close.click()
        if (await page.locator('[toast-close]').count() > 0) return -1
        await page.waitForTimeout(500)
        return page.locator('[toast-close]').count()
      }, { timeout: 15_000, message: 'sync completion toasts must settle and be dismissed' }).toBe(0)

      // The page opens with the heading hero, the video pitch, and the
      // live-preview editor below it.
      await expect(page.getByTestId('tour-hero')).toBeVisible()
      await expect(page.getByTestId('tour-why-video')).toBeVisible()
      await expect(page.getByTestId('tour-scroll-hint')).toBeVisible()
      await expect(page.locator('[data-gate-id="editor-pane"] .cm-content')).toBeVisible()

      // No run yet: the Session Insights pane offers the CTA instead of
      // results. The section is one long parallax scroll — bring the
      // analytics step itself into view, then take the CTA from wherever
      // this breakpoint renders it (the active sticky scope on desktop,
      // the mobile analytics step).
      const analyticsStep = page.locator('[data-scope="analytics"]').filter({ visible: true })
      await analyticsStep.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const cta = page
        .locator('[data-scope-active="true"]')
        .getByTestId('tour-insights-run')
        .or(page.getByTestId('tour-step-mobile-analytics').getByTestId('tour-insights-run'))
        .filter({ visible: true })
      await expectTouchable(cta)

      // The CTA triggers the fullscreen run — the same big-screen clock the
      // editor Run opens.
      await tapControl(cta)
      const timer = page.locator('.fixed.inset-0').filter({ has: page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE) })
      await expect(timer).toBeVisible()


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
      // Stop preserves the partial in review before the visitor dismisses it.
      await tapControl(stop)
      await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click()
      await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible()
      await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click()
      await expect(timer).toBeHidden({ timeout: 15_000 })
      // Closing the review glides to the dashboards section header — the
      // raw statements stay in the closed fullscreen panel.
      const insights = page.getByTestId('tour-section-insights')
      await expect.poll(async () => {
        const box = await insights.boundingBox()
        return !!box && box.y >= 0 && box.y <= 140
      }, { message: 'closing the run parks the dashboards section under the sticky header' }).toBe(true)
      // The session analytics (rest/test ratios) light up in the sticky
      // viewport when the Session Insights step scrolls into view.
      await analyticsStep.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await expect(page.getByTestId('tour-insights-timeline').filter({ visible: true })).toBeVisible()
      await expect(page.getByTestId('tour-insights-ratio').filter({ visible: true })).toBeVisible()
      await expect(page.getByTestId('tour-insights-reaction').filter({ visible: true })).toBeVisible()
      // The pane header slides the visitor back up to the editor viewport
      // and resets the runtime for another run. Scope to the active pane —
      // plain visibility filters also match duplicate off-screen panes.
      const backToEditor = page
        .locator('[data-scope-active="true"]')
        .getByTestId('tour-pane-back-to-editor')
        .or(page.getByTestId('tour-step-mobile-analytics').getByTestId('tour-pane-back-to-editor'))
        .filter({ visible: true })
      await backToEditor.scrollIntoViewIfNeeded()
      // Sandbox seed-sync/quest toasts stack over the pane header's button —
      // dismiss the stack and let it settle before interacting underneath.
      await expect.poll(async () => {
        for (const close of await page.locator('[toast-close]').all()) await close.click()
        await page.waitForTimeout(500)
        return page.locator('[toast-close]').count()
      }, { timeout: 20_000, message: 'toasts must settle before the pane-header interaction' }).toBe(0)
      await backToEditor.click()
      const editorSection = page.getByTestId('tour-section-editor')
      await expect.poll(async () => {
        const box = await editorSection.boundingBox()
        return !!box && box.y >= 0 && box.y <= 140
      }, { message: 'pane header parks the editor section under the sticky header' }).toBe(true)
      // The editor section was untouched by the CTA run.
      await expect(page.locator('[data-gate-id="editor-pane"] .cm-content')).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}

test('editor run records results and glides the dashboards into view', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForSeedReady(page)
  const previousSessions = new Set((await getSessions(page)).map(session => session.id))
  // The run button lives in the live-preview editor below the video pitch.
  await page.getByTestId('tour-section-editor').getByRole('button', { name: 'Run', exact: true }).click()
  const timer = page.locator('.fixed.inset-0').filter({ has: page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE) })
  // Finish the workout, then dismiss its saved review — the review panel
  // owns the raw results; the page glides to the dashboards header.
  await timer.getByText(/results captured/).waitFor({ timeout: 15_000 })
  await timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).click()
  await timer.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).click()
  await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible()
  await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click()
  await expect(timer).toBeHidden({ timeout: 15_000 })
  const insights = page.getByTestId('tour-section-insights')
  await expect(insights).toBeVisible()
  // The reveal glide parks the dashboards section right under the sticky
  // header; the Session Insights pane holds the recorded run.
  const sessionPane = insights.getByTestId('tour-insights').filter({ visible: true }).first()
  await expect(sessionPane).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY),
    { message: 'reveal scrolls past the hero heading' }).toBeGreaterThan(0)
  await expect.poll(async () => {
    const box = await insights.boundingBox()
    return !!box && box.y >= 0 && box.y <= 140
  }, { message: 'insights section parked right under the sticky header' }).toBe(true)
  const recorded = (await getSessions(page)).filter(session => !previousSessions.has(session.id))
  expect(recorded).toHaveLength(1)
  expect(recorded[0].duration).toBeGreaterThan(0)
  // The recorded run lit up the Session Insights scope.
  const analyticsStep = page.locator('[data-scope="analytics"]').filter({ visible: true })
  await analyticsStep.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await expect(page.getByTestId('tour-insights-ratio').filter({ visible: true })).toBeVisible({ timeout: 15_000 })
  // Reading to the page bottom and back does not disturb the editor: it
  // stays an editor, and the recorded session stays in the insights pane.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 400)
    return promise
  })
  await expect(page.locator('[data-gate-id="editor-pane"] .cm-content')).toBeVisible()
  // The dashboards pane header slides back up to the editor viewport and
  // resets the runtime, ready for another run. Scope to the active pane
  // (the sticky scope on desktop, the mobile analytics step) — plain
  // visibility filters also match the duplicate off-screen panes.
  const backToEditor = page
    .locator('[data-scope-active="true"]')
    .getByTestId('tour-pane-back-to-editor')
    .or(page.getByTestId('tour-step-mobile-analytics').getByTestId('tour-pane-back-to-editor'))
    .filter({ visible: true })
  await backToEditor.scrollIntoViewIfNeeded()
  // Sandbox seed-sync/quest toasts stack over the pane header's button —
  // dismiss the stack and let it settle before interacting underneath.
  await expect.poll(async () => {
    for (const close of await page.locator('[toast-close]').all()) await close.click()
    await page.waitForTimeout(500)
    return page.locator('[toast-close]').count()
  }, { timeout: 20_000, message: 'toasts must settle before the pane-header interaction' }).toBe(0)
  await backToEditor.click()
  const editorSection = page.getByTestId('tour-section-editor')
  await expect.poll(async () => {
    const box = await editorSection.boundingBox()
    return !!box && box.y >= 0 && box.y <= 140
  }, { message: 'pane header parks the editor section under the sticky header' }).toBe(true)
  await expect(editorSection.getByRole('button', { name: 'Run', exact: true })).toBeVisible()
})

test.describe('library & community feeds gallery', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('seed cards browse, filter, and sort before any import', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForSeedReady(page)

    const section = page.getByTestId('tour-jump-section')
    await section.scrollIntoViewIfNeeded()
    // One card per SEED — the thing a reader subscribes to — over the two
    // workspace exits. The marquee loops by duplicating each row's cards, so
    // queries are scoped to the first copy.
    await expect(section.getByTestId('jump-library')).toBeVisible()
    await expect(section.getByTestId('jump-new-note')).toBeVisible()
    await expect(section.getByTestId('jump-row-a')).toBeVisible()
    await expect(section.getByTestId('jump-row-b')).toBeVisible()
    await expect(section.getByTestId('jump-row-mobile')).toHaveCount(0)
    const firstCopy = section.getByTestId('jump-row-a').locator('[data-marquee-copy="0"]')
    // Cards are duplicated by the marquee loop — one copy of each row is the
    // complete card set (the two rows hold disjoint halves).
    const copies = section.locator('[data-marquee-copy="0"]')

    // Alphabetical before any import: CrossFit leads row A.
    const crossfit = firstCopy.getByTestId('seed-card-seed-crossfit')
    await expect(crossfit).toBeVisible()
    await expect(crossfit.getByTestId('seed-card-seed-crossfit-import')).toBeVisible()
    // The card says what one Subscribe brings: its notebooks.
    for (const notebook of [
      'community-crossfit-programming',
      'community-crossfit-girls',
      'community-crossfit-heroes',
    ]) {
      await expect(crossfit.getByTestId(`seed-card-seed-crossfit-notebook-${notebook}`)).toBeVisible()
    }
    // Registries and dashboards are not notebooks — never a card.
    await expect(copies.getByTestId('seed-card-seed-core')).toHaveCount(0)

    // Search matches the seed AND the notebooks it publishes.
    await section.getByTestId('package-search-input').fill('heroes')
    await expect(copies.getByTestId('seed-card-seed-crossfit')).toBeVisible()
    await expect(copies.getByTestId('seed-card-seed-swimming')).toHaveCount(0)
    await section.getByTestId('package-search-input').fill('kettlebell zebras')
    await expect(copies.getByTestId('seed-card-seed-crossfit')).toHaveCount(0)
    await section.getByTestId('package-search-input').fill('')
    await expect(copies.getByTestId('seed-card-seed-crossfit')).toBeVisible()

    // Kind facets keep the seeds publishing a notebook of that kind.
    await section.getByTestId('package-kind-collection').click()
    await expect(copies.getByTestId('seed-card-seed-crossfit')).toBeVisible()
    await expect(copies.getByTestId('seed-card-r-workoutroutines')).toHaveCount(0)
    await section.getByTestId('package-kind-collection').click()

    // Sort by name keeps CrossFit leading.
    await section.getByTestId('package-sort-name').click()
    await expect(section.getByTestId('jump-row-a').locator('[data-marquee-copy="0"] article[data-testid^="seed-card-"]').first())
      .toHaveAttribute('data-testid', 'seed-card-seed-crossfit')
  })

  test('mobile slides the same cards in one alternating row', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForSeedReady(page)

    const section = page.getByTestId('tour-jump-section')
    await section.scrollIntoViewIfNeeded()
    await expect(section.getByTestId('jump-row-mobile')).toBeVisible()
    await expect(section.getByTestId('jump-row-a')).toHaveCount(0)
    await expect(section.getByTestId('jump-row-b')).toHaveCount(0)
    const firstCopy = section.getByTestId('jump-row-mobile').locator('[data-marquee-copy="0"]')
    await expect(firstCopy.getByTestId('seed-card-seed-crossfit')).toBeVisible()
    await expect(firstCopy.getByTestId('seed-card-seed-crossfit-notebook-community-crossfit-games')).toBeVisible()
  })
})

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 1000 },
]) {
  test.describe(`hosted interest quiz ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('marking a feature interested unlocks the survey and reports the funnel event', async ({ page }) => {
      // No seed wait: the hosted section is static content, independent of
      // seed sync (which errors in sandboxes without registry access).
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      const hosted = page.getByTestId('tour-section-hosted')
      await hosted.scrollIntoViewIfNeeded()

      // The survey card does not exist on first load — the third slot stays
      // empty until interest is shown.
      await expect(hosted.getByTestId('hosted-survey-button')).toHaveCount(0)
      await expect(hosted.getByText('Thank you!')).toHaveCount(0)

      await hosted.getByTestId('hosted-interest-managed-hosting').click()

      // The interest click must reach the gtag dataLayer (consent defaults on).
      await expect.poll(() =>
        page.evaluate(() => {
          const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []
          return layer.some((entry) => {
            const args = Array.from(entry as ArrayLike<unknown>)
            return args[0] === 'event'
              && args[1] === 'home:hosted_interest_clicked'
              && (args[2] as { feature?: string } | undefined)?.feature === 'managed-hosting'
          })
        }),
      ).toBe(true)

      // Interest mounts the thank-you card with a prominent button CTA.
      const button = hosted.getByTestId('hosted-survey-button')
      await expect(button).toBeVisible()
      await expect(hosted.getByText('Thanks for showing interest — please fill out the survey and give us feedback.')).toBeVisible()

      // The button opens the survey in a new tab.
      const popupPromise = page.waitForEvent('popup')
      await button.click()
      const popup = await popupPromise
      await popup.close()

      // The latch marks the feature interested exactly once.
      await expect(hosted.getByTestId('hosted-interest-managed-hosting')).toBeDisabled()
    })
  })
}

test('dashboard carousel slides across the two seeded boards', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForSeedReady(page)
  // The seeded boards ship with the syncable seed corpus — the bundled core
  // carries only the canvas/efforts/equipment markdown.
  await syncSeed(page, 'seed-crossfit')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // Scrolling the "One Run Becomes Many" step into view gives the sticky
  // viewport its boards scope.
  const boardsStep = page.getByTestId('tour-section-boards')
  await boardsStep.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const boards = page.getByTestId('tour-sticky-pane')
  await expect(boards.getByTestId('dashboard-slide-tab-road-to-560-total')).toHaveAttribute('aria-selected', 'true')

  // The first seeded board over example data.
  const pane = boards.getByTestId('tour-session-dashboard')
  await expect(boards.getByTestId('tour-session-dashboard-source')).toBeVisible()
  await expect(pane.locator('[data-testid="dashboard-view"]')).toBeVisible({ timeout: 30_000 })

  // The range selector is URL-state shared by the boards.
  await pane.getByRole('button', { name: '8w', exact: true }).click()
  await expect(page).toHaveURL(/weeks=8/)
  // 4w writes again from the visible board.
  await pane.getByRole('button', { name: '4w', exact: true }).click()
  await expect(page).toHaveURL(/weeks=4/)

  // The arrows step to the remaining board and wrap back around.
  await boards.getByTestId('dashboard-slide-next').click()
  await expect(boards.getByTestId('dashboard-slide-tab-polarized-base-marathon')).toHaveAttribute('aria-selected', 'true')
  await expect(boards.getByTestId('tour-session-dashboard')).toBeVisible()
  await boards.getByTestId('dashboard-slide-prev').click()
  await expect(boards.getByTestId('dashboard-slide-tab-road-to-560-total')).toHaveAttribute('aria-selected', 'true')
  await expect(boards.getByTestId('tour-session-dashboard')).toBeVisible()
})
