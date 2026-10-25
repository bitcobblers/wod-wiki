import { expect, test, type Page } from '@playwright/test'

const HOME_BUDGET_MS = 5_000
const PROGRESS_BUDGET_MS = 1_000

async function readBootMark(page: Page, name: string): Promise<number | null> {
  return page.evaluate((markName) => {
    return performance.getEntriesByName(markName, 'mark')[0]?.startTime ?? null
  }, name)
}

async function expectColdHome(page: Page, screenshotName: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('wodwiki.profileInitialized.v1', 'true')
    localStorage.setItem('wod-wiki-playground-theme', 'light')
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="boot-shell"]')) return
      document.documentElement.dataset.bootShellSeen = performance.now().toFixed(3)
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  })

  const navigationStarted = Date.now()
  const root = page.locator('html')
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // The static HTML phase is observable before the JS bundle downloads.
  await expect(root).toHaveAttribute('data-boot-shell-seen', /.+/, { timeout: PROGRESS_BUDGET_MS })
  const shellSeenMs = Number(await root.getAttribute('data-boot-shell-seen'))
  expect(shellSeenMs).toBeLessThan(PROGRESS_BUDGET_MS)

  // Usable Home still has the larger budget and never waits for seed-ready.
  const hero = page.getByTestId('tour-hero')
  await expect(hero).toBeVisible({ timeout: HOME_BUDGET_MS })
  const heroVisibleMs = Date.now() - navigationStarted
  expect(heroVisibleMs).toBeLessThan(HOME_BUDGET_MS)

  await expect(root).toHaveAttribute('data-boot-home-first-paint', /.+/, { timeout: HOME_BUDGET_MS })
  const homeFirstPaintMs = await readBootMark(page, 'home:first-paint')
  expect(homeFirstPaintMs).not.toBeNull()
  expect(homeFirstPaintMs!).toBeLessThan(HOME_BUDGET_MS)
  await expect(page.getByText('Loading library…')).toHaveCount(0)

  const editor = page.locator('[data-gate-id="editor-pane"] .cm-content').first()
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('0:03 Count Down')
  const arrivalText = await editor.textContent()
  const stableRegions = [
    hero.getByRole('heading', { level: 1 }),
    page.getByTestId('tour-why-video'),
    editor,
  ]
  const contentBoxesBefore = await Promise.all(stableRegions.map(region => region.boundingBox()))
  await page.screenshot({ path: `e2e/screenshots/${screenshotName}-before-seed.png`, animations: 'disabled' })

  test.info().annotations.push({
    type: 'cold-boot-budget',
    description: `boot shell ${shellSeenMs.toFixed(1)}ms; hero visible ${heroVisibleMs}ms; home:first-paint ${homeFirstPaintMs!.toFixed(1)}ms`,
  })

  // The seed pipeline remains real background work and must still finish.
  await expect(root).toHaveAttribute('data-boot-feed-settled', /.+/, { timeout: 60_000 })
  await expect(root).toHaveAttribute('data-boot-corpus-ready', /.+/, { timeout: 60_000 })
  await expect(root).toHaveAttribute('data-feed-state', 'ready', { timeout: 60_000 })
  await expect(hero).toBeVisible()
  await expect(editor).toHaveText(arrivalText ?? '')
  await page.screenshot({ path: `e2e/screenshots/${screenshotName}-after-seed.png`, animations: 'disabled' })
  for (const close of await page.locator('[toast-close]').all()) await close.click()
  await page.evaluate(() => window.scrollTo(0, 0))
  // The scroll gate's optional "Scroll page" button changes wrapper height;
  // compare the actual content regions instead.
  expect(await Promise.all(stableRegions.map(region => region.boundingBox()))).toEqual(contentBoxesBefore)

  // A corpus-backed route proves the import produced usable routed content.
  await page.goto('/guide/start', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'First Workout', exact: true }).first()).toBeVisible()
}

test('cold production Home meets the desktop budget before background import settles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await expectColdHome(page, 'cold-boot-desktop')
})

test('cold production Home meets the throttled mobile budget before background import settles', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 375, height: 812 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 40,
    downloadThroughput: 10_000_000 / 8,
    uploadThroughput: 10_000_000 / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  await expectColdHome(page, 'cold-boot-mobile')

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
})

test('a corpus deep link reports the real seed phase while the route waits', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('wodwiki.profileInitialized.v1', 'true')
  })
  await page.route('**/seed/core/chunks/canvas.*.json', async (route) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 5_000)
    await promise
    await route.continue()
  })

  await page.goto('/guide/start', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('status')).toContainText('Downloading canvas…', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'First Workout', exact: true }).first()).toBeVisible({ timeout: 60_000 })
})
