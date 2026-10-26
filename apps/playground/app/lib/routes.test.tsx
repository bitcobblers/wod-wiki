import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// ── Mutable mock state for react-router-dom ───────────────────────────────
let mockParams: Record<string, string> = {}
let mockLocation: { pathname: string; search: string } = { pathname: '/', search: '' }
let lastNavigateTo: string | null = null
let lastNavigateReplace: boolean | undefined
const navigateCalls: Array<{ to: string; options?: { replace?: boolean } }> = []

mock.module('react-router-dom', () => ({
  useParams: () => mockParams,
  useLocation: (): { pathname: string; search: string } => mockLocation,
  useNavigate: () => (to: string, options?: { replace?: boolean }) => {
    navigateCalls.push({ to, options })
  },
  Navigate: ({ to, replace }: { to: string | { pathname: string; search?: string }; replace?: boolean }) => {
    lastNavigateTo = typeof to === 'string' ? to : `${to.pathname}${to.search ?? ''}`
    lastNavigateReplace = replace
    return <div data-testid="navigate" />
  },
}))

// ── Import pure functions first (no react-router-dom dependency) ──────────
import {
  ROUTE_PATTERNS,
  playgroundPath,
  dayPath,
  notePath,
  dayAutoStartPath,
  notebookItemPath,
  notebookPath,
  notebookDatePath,
  sessionsPath,
  sessionDetailPath,
  sessionDatePath,
  pagePath,
  dashboardsPath,
  dashboardViewPath,
  playgroundsPath,
  runPath,
  settingsPath,
  buildPlaygroundLoadUrl,
  feedPath,
  feedItemPath,
  matchFeedItem,
  matchFeedDetail,
  isPlaygroundNotePath,
  isDayPath,
  isTrackerPath,
  isNotebookItemPath,
  isEffortsPath,
  effortPath,
  equipmentPath,
  isEquipmentPath,
  analyticsExplorerPath,
} from './routes'

// ── Dynamic imports for components that consume react-router-dom mocks ────
let redirectComponents: typeof import('./routeRedirects') | null = null

beforeEach(async () => {
  mockParams = {}
  mockLocation = { pathname: '/', search: '' }
  lastNavigateTo = null
  lastNavigateReplace = undefined
  navigateCalls.length = 0
  cleanup()

  if (!redirectComponents) {
    redirectComponents = await import('./routeRedirects')
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. Retired paths (ticket 09 — no redirect matrix, no aliases)
// ═══════════════════════════════════════════════════════════════════════════

describe('retired legacy paths', () => {
  it('no redirect matrix exists in the route module', () => {
    const routesModule = require('./routes') as Record<string, unknown>
    expect(routesModule.resolveRedirect).toBeUndefined()
    expect(routesModule.ROUTE_REDIRECTS).toBeUndefined()
  })

  it('the route table carries no retired patterns', () => {
    const patterns = Object.values(ROUTE_PATTERNS) as string[]
    for (const retired of [
      '/catalogs', '/collections', '/c/:slug', '/p/*', '/e/:slug', '/d/:slug',
      '/notes/:noteId', '/note/:category/:name', '/journal/:identity',
      '/feed', '/dashboard', '/analytics', '/analytics/explorer',
    ]) {
      expect(patterns).not.toContain(retired)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Path builders — one canonical builder per concept
// ═══════════════════════════════════════════════════════════════════════════

describe('path builders', () => {
  it('playgroundPath encodes the id', () => {
    expect(playgroundPath('hello world')).toBe('/playground/hello%20world')
  })

  it('dayPath builds the canonical day route', () => {
    expect(dayPath('2026-05-19')).toBe('/day/2026-05-19')
  })

  it('notePath builds the canonical single-note route', () => {
    expect(notePath('abc-123')).toBe('/note/abc-123')
  })

  it('dayAutoStartPath appends the autoStart query param', () => {
    expect(dayAutoStartPath('2026-05-19', 'run-42')).toBe(
      '/day/2026-05-19?autoStart=run-42',
    )
  })

  it('notebookItemPath addresses a notebook item', () => {
    expect(notebookItemPath('dan john', 'simple strength')).toBe(
      '/notebook/dan%20john/simple%20strength',
    )
  })

  it('notebookPath lands the notebook landing', () => {
    expect(notebookPath('dan-john')).toBe('/notebook/dan-john')
  })

  it('notebookDatePath scopes a notebook to a date', () => {
    expect(notebookDatePath('dan-john', '2026-09-17')).toBe('/notebook/dan-john/2026-09-17')
  })

  it('sessionsPath, sessionDetailPath and sessionDatePath build the sessions family', () => {
    expect(sessionsPath()).toBe('/sessions')
    expect(sessionDetailPath('res-1')).toBe('/results/res-1')
    expect(sessionDatePath('2026-09-17')).toBe('/session/2026-09-17')
  })

  it('pagePath builds the generic page render route', () => {
    expect(pagePath('guide-start')).toBe('/page/guide-start')
  })

  it('dashboardsPath lands the dashboards list and dashboardViewPath one dashboard', () => {
    expect(dashboardsPath()).toBe('/dashboards')
    expect(dashboardViewPath('strength-trends')).toBe('/dashboard/strength-trends')
  })

  it('playgroundsPath builds the playground list route', () => {
    expect(playgroundsPath()).toBe('/playgrounds')
  })

  it('effortPath builds under the /effort prefix, preserving modifiers', () => {
    expect(effortPath('grace')).toBe('/effort/grace')
    expect(effortPath('grace', { weight: '60' })).toBe('/effort/grace?weight=60')
  })

  it('analyticsExplorerPath points deep links at /dashboards', () => {
    expect(analyticsExplorerPath({ q: 'bc-fran' })).toBe('/dashboards?q=bc-fran')
  })

  it('runPath encodes runtimeId', () => {
    expect(runPath('abc-123')).toBe('/run/abc-123')
  })

  it('settingsPath returns default or section path', () => {
    expect(settingsPath()).toBe('/settings/appearance')
    expect(settingsPath('appearance')).toBe('/settings/appearance')
    expect(settingsPath('system')).toBe('/settings/system')
  })

  it('buildPlaygroundLoadUrl encodes zip query', () => {
    expect(buildPlaygroundLoadUrl({ zip: 'abc 123' })).toBe('/load?zip=abc%20123')
  })

  it('feedPath encodes slug', () => {
    expect(feedPath('my feed')).toBe('/feed/my%20feed')
  })

  it('feedItemPath encodes all three segments', () => {
    expect(feedItemPath('my feed', '2026-05-19', 'item 1')).toBe(
      '/feed/my%20feed/2026-05-19/item%201',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Route family helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('route family helpers', () => {
  it('isPlaygroundNotePath detects the playground note family', () => {
    expect(isPlaygroundNotePath('/playground/my-note')).toBe(true)
    expect(isPlaygroundNotePath('/note/playground/my-note')).toBe(false)
    expect(isPlaygroundNotePath('/playground')).toBe(false)
    expect(isPlaygroundNotePath('/day/2026-05-19')).toBe(false)
    expect(isPlaygroundNotePath('/')).toBe(false)
  })

  it('isDayPath detects /day/:date', () => {
    expect(isDayPath('/day/2026-05-19')).toBe(true)
    expect(isDayPath('/day/abc')).toBe(true)
    expect(isDayPath('/day')).toBe(false)
    expect(isDayPath('/journal')).toBe(false)
    expect(isDayPath('/journal/2026-05-19')).toBe(false)
  })

  it('isTrackerPath detects /tracker and /run', () => {
    expect(isTrackerPath('/tracker/abc')).toBe(true)
    expect(isTrackerPath('/run/abc')).toBe(true)
    expect(isTrackerPath('/tracker')).toBe(false)
    expect(isTrackerPath('/run')).toBe(false)
  })

  it('isNotebookItemPath detects /notebook/:slug/:item', () => {
    expect(isNotebookItemPath('/notebook/dan-john/simple')).toBe(true)
    expect(isNotebookItemPath('/notebook/dan-john')).toBe(false)
    expect(isNotebookItemPath('/notebooks')).toBe(false)
    expect(isNotebookItemPath('/notebook/a/')).toBe(false)
    expect(isNotebookItemPath('/playground/note')).toBe(false)
  })

  it('isEffortsPath detects the efforts family on the canonical prefix only', () => {
    expect(isEffortsPath('/efforts')).toBe(true)
    expect(isEffortsPath('/effort/grace')).toBe(true)
    expect(isEffortsPath('/e/grace')).toBe(false)
  })

  it('matchFeedItem captures the three /feed segments', () => {
    expect(matchFeedItem('/feed/my-feed/2026-05-19/item-1')).toEqual(['my-feed', '2026-05-19', 'item-1'])
    expect(matchFeedItem('/feed/my-feed')).toBeNull()
    expect(matchFeedItem('/feeds/my-feed/2026-05-19/item-1')).toBeNull()
  })

  it('matchFeedDetail captures the /feed slug but not feed items', () => {
    expect(matchFeedDetail('/feed/my-feed')).toBe('my-feed')
    expect(matchFeedDetail('/feed/my-feed/2026-05-19/item-1')).toBeNull()
    expect(matchFeedDetail('/feeds')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Redirect components (the surviving non-matrix redirects)
// ═══════════════════════════════════════════════════════════════════════════

describe('TrackerRedirect', () => {
  it('renders Navigate to /run/:runtimeId with replace', async () => {
    mockParams = { runtimeId: 'abc-123' }
    const { TrackerRedirect } = redirectComponents!
    render(<TrackerRedirect />)

    expect(lastNavigateTo).toBe('/run/abc-123')
    expect(lastNavigateReplace).toBe(true)
  })
})

describe('SegmentsRedirect', () => {
  it('renders Navigate to /sessions with the segments query pre-filled', async () => {
    const { SegmentsRedirect } = redirectComponents!
    render(<SegmentsRedirect />)

    expect(lastNavigateTo).toBe(`/sessions?q=${encodeURIComponent(':segment{} last 8w')}`)
    expect(lastNavigateReplace).toBe(true)
  })
})

describe('PlanRedirect', () => {
  it('renders Navigate to /journal?mode=plan', async () => {
    mockLocation = { pathname: '/plan', search: '' }
    const { PlanRedirect } = redirectComponents!
    render(<PlanRedirect />)

    expect(lastNavigateTo).toBe('/journal?mode=plan')
    expect(lastNavigateReplace).toBe(true)
  })
})

describe('ReviewRedirect', () => {
  it('renders Navigate to /results/:resultId when a result scope is present', async () => {
    mockParams = { noteId: 'n1', sectionId: 's1', resultId: 'res-9' }
    const { ReviewRedirect } = redirectComponents!
    render(<ReviewRedirect />)

    expect(lastNavigateTo).toBe('/results/res-9')
    expect(lastNavigateReplace).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. NotFoundPage
// ═══════════════════════════════════════════════════════════════════════════

describe('NotFoundPage', () => {
  // Dynamic import: react-router-dom is mocked via mock.module above; a
  // static import would bind the real module before the mock registers.
  it('renders a not-found heading and a home affordance', async () => {
    const { NotFoundPage } = await import('../pages/NotFoundPage')
    render(<NotFoundPage />)

    expect(screen.getByRole('heading', { name: /not found/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /go home/i })).toBeDefined()
  })

  it('navigates home when Go home button is clicked', async () => {
    const { NotFoundPage } = await import('../pages/NotFoundPage')
    render(<NotFoundPage />)

    const button = screen.getByRole('button', { name: /Go home/i })
    expect(button).toBeDefined()

    fireEvent.click(button)
    expect(navigateCalls).toEqual([{ to: '/', options: undefined }])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Canonical route patterns
// ═══════════════════════════════════════════════════════════════════════════

describe('ROUTE_PATTERNS', () => {
  it('declares all canonical route families — one library list + one direct route per concept', () => {
    // Library lists (one segment).
    expect(ROUTE_PATTERNS.notebooks).toBe('/notebooks')
    expect(ROUTE_PATTERNS.notes).toBe('/notes')
    expect(ROUTE_PATTERNS.journal).toBe('/journal')
    expect(ROUTE_PATTERNS.pages).toBe('/pages')
    expect(ROUTE_PATTERNS.tags).toBe('/tags')
    expect(ROUTE_PATTERNS.feeds).toBe('/feeds')
    expect(ROUTE_PATTERNS.efforts).toBe('/efforts')
    expect(ROUTE_PATTERNS.equipment).toBe('/equipment')
    expect(ROUTE_PATTERNS.dashboards).toBe('/dashboards')
    // Direct routes (deeper).
    expect(ROUTE_PATTERNS.notebook).toBe('/notebook/:slug')
    expect(ROUTE_PATTERNS.note).toBe('/note/:noteId')
    expect(ROUTE_PATTERNS.day).toBe('/day/:date')
    expect(ROUTE_PATTERNS.page).toBe('/page/:slug')
    expect(ROUTE_PATTERNS.tag).toBe('/t/:type/:tag')
    expect(ROUTE_PATTERNS.feed).toBe('/feed/:slug')
    expect(ROUTE_PATTERNS.feedItem).toBe('/feed/:slug/:feedDate/:feedItem')
    expect(ROUTE_PATTERNS.effort).toBe('/effort/:slug')
    expect(ROUTE_PATTERNS.equipmentSlug).toBe('/equipment/:slug')
    expect(ROUTE_PATTERNS.dashboardView).toBe('/dashboard/:slug')
    // Untouched families.
    expect(ROUTE_PATTERNS.home).toBe('/')
    expect(ROUTE_PATTERNS.playgroundRoot).toBe('/playground')
    expect(ROUTE_PATTERNS.playground).toBe('/playground/:id')
    expect(ROUTE_PATTERNS.plan).toBe('/plan')
    expect(ROUTE_PATTERNS.tracker).toBe('/tracker/:runtimeId')
    expect(ROUTE_PATTERNS.run).toBe('/run/:runtimeId')
    expect(ROUTE_PATTERNS.load).toBe('/load')
    expect(ROUTE_PATTERNS.loadJournal).toBe('/load/journal')
    expect(ROUTE_PATTERNS.loadJournalDate).toBe('/load/journal/:date')
    // Equipment L1 family — list stream + detail/create note pages.
    expect(equipmentPath('dumbbell')).toBe('/equipment/dumbbell')
    expect(isEquipmentPath('/equipment')).toBe(true)
    expect(isEquipmentPath('/equipment/dumbbell')).toBe(true)
    expect(isEquipmentPath('/efforts')).toBe(false)
  })
})
