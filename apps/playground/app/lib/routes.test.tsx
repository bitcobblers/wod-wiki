import { describe, it, expect, beforeEach } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'

// ── Real router harness — no react-router-dom mocks ───────────────────────
let currentPathname = '/'
let currentSearch = ''

function LocationProbe() {
  const location = useLocation()
  currentPathname = location.pathname
  currentSearch = location.search
  return <div data-testid="location" />
}

/** Render `element` inside a real MemoryRouter at `initialEntry`, matched against `routePath`. */
function renderAt(initialEntry: string, element: ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path={routePath} element={element} />
        {/* Redirect targets land here — nothing to render, just settle the location */}
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Pure functions and route components ────────────────────────────────────
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
  matchNotebookItem,
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

// ── Route components (real router — static import is safe) ────────────────
import { TrackerRedirect, SegmentsRedirect, PlanRedirect, ReviewRedirect } from './routeRedirects'
import { NotFoundPage } from '../pages/NotFoundPage'

beforeEach(() => {
  currentPathname = '/'
  currentSearch = ''
  cleanup()
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. Retired paths (ticket 09 — no redirect matrix, no aliases)
// ═══════════════════════════════════════════════════════════════════════════

describe('retired legacy paths', () => {
  it('no redirect matrix exists in the route module', async () => {
    const routesModule = (await import('./routes')) as Record<string, unknown>
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
  it('notebookPath normalizes community- prefixed or chunk-id slugs', () => {
    expect(notebookPath('community-crossfit-girls')).toBe('/notebook/crossfit-girls')
    expect(notebookPath('notebook.crossfit-programming')).toBe('/notebook/crossfit-programming')
    expect(notebookPath('notebook/my-slug')).toBe('/notebook/my-slug')
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

  it('notebookItemPath encodes all segments, keeping a dated item split', () => {
    expect(notebookItemPath('my notebook', 'item 1')).toBe(
      '/notebook/my%20notebook/item%201',
    )
    expect(notebookItemPath('my notebook', '2026-05-19/item 1')).toBe(
      '/notebook/my%20notebook/2026-05-19/item%201',
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

  it('matchNotebookItem captures the three /notebook segments', () => {
    expect(matchNotebookItem('/notebook/my-notebook/2026-05-19/item-1')).toEqual(['my-notebook', '2026-05-19', 'item-1'])
    expect(matchNotebookItem('/notebook/my-notebook')).toBeNull()
    expect(matchNotebookItem('/notebook/my-notebook/item-1')).toBeNull()
    expect(matchNotebookItem('/feed/my-notebook/2026-05-19/item-1')).toBeNull()
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
  it('redirects /tracker/:runtimeId to /run/:runtimeId', () => {
    renderAt('/tracker/abc-123', <TrackerRedirect />, '/tracker/:runtimeId')

    expect(currentPathname).toBe('/run/abc-123')
    expect(currentSearch).toBe('')
  })
})

describe('SegmentsRedirect', () => {
  it('redirects to /sessions with the segments query pre-filled', () => {
    renderAt('/results/segments', <SegmentsRedirect />, '/results/segments')

    expect(currentPathname).toBe('/sessions')
    expect(currentSearch).toBe(`?q=${encodeURIComponent(':segment{} last 8w')}`)
  })
})

describe('PlanRedirect', () => {
  it('redirects /plan to /journal?mode=plan', () => {
    renderAt('/plan', <PlanRedirect />, '/plan')

    expect(currentPathname).toBe('/journal')
    expect(currentSearch).toBe('?mode=plan')
  })
})

describe('ReviewRedirect', () => {
  it('redirects to /results/:resultId when a result scope is present', () => {
    renderAt('/note/n1/review/s1/res-9', <ReviewRedirect />, '/note/:noteId/review/:sectionId/:resultId')

    expect(currentPathname).toBe('/results/res-9')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. NotFoundPage
// ═══════════════════════════════════════════════════════════════════════════

describe('NotFoundPage', () => {
  it('renders a not-found heading and a home affordance', () => {
    renderAt('/nope', <NotFoundPage />)

    expect(screen.getByRole('heading', { name: /not found/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /go home/i })).toBeDefined()
  })

  it('navigates home when Go home button is clicked', () => {
    renderAt('/nope', <NotFoundPage />)

    const button = screen.getByRole('button', { name: /Go home/i })
    expect(button).toBeDefined()

    fireEvent.click(button)
    expect(currentPathname).toBe('/')
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
    expect(ROUTE_PATTERNS.notebookItem).toBe('/notebook/:slug/:itemDate/:item')
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
