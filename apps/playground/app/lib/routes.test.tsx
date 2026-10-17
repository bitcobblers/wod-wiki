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
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => {
    lastNavigateTo = typeof to === 'string' ? to : `${to.pathname}${to.search ?? ''}`
    lastNavigateReplace = replace
    return <div data-testid="navigate" />
  },
}))

// ── Import pure functions first (no react-router-dom dependency) ──────────
import {
  ROUTE_PATTERNS,
  resolveRedirect,
  ROUTE_REDIRECTS,
  playgroundPath,
  journalEntryPath,
  noteByIdPath,
  journalEntryAutoStartPath,
  workoutPath,
  collectionPath,
  collectionDatePath,
  sessionsPath,
  sessionDetailPath,
  sessionDatePath,
  pagePath,
  dashboardPath,
  dashboardSlugPath,
  playgroundsPath,
  runPath,
  settingsPath,
  buildPlaygroundLoadUrl,
  feedDetailPath,
  feedItemPath,
  isPlaygroundNotePath,
  isJournalEntryPath,
  isTrackerPath,
  isCollectionWorkoutPath,
  effortPath,
  equipmentPath,
  isEquipmentPath,
  analyticsExplorerPath,
} from './routes'

// ── Dynamic imports for components that consume react-router-dom mocks ────
let redirectComponents: typeof import('./routeRedirects') | null = null

beforeEach(async () => {
  mockParams = {}
  lastNavigateTo = null
  lastNavigateReplace = undefined
  navigateCalls.length = 0
  cleanup()

  if (!redirectComponents) {
    redirectComponents = await import('./routeRedirects')
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. Redirect matrix (ROUTE_REDIRECTS + resolveRedirect)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveRedirect', () => {
  it('redirects /note/playground/:name → /playground/:name', () => {
    expect(resolveRedirect('/note/playground/hello-world')).toBe(
      '/playground/hello-world',
    )
  })

  it('redirects /workout/:category/:name → /c/:category/:name', () => {
    expect(resolveRedirect('/workout/dan-john/simple-strength')).toBe(
      '/c/dan-john/simple-strength',
    )
  })

  it('redirects /getting-started → /', () => {
    expect(resolveRedirect('/getting-started')).toBe('/')
  })

  it('redirects /chapters/basics → /guide/start', () => {
    expect(resolveRedirect('/chapters/basics')).toBe('/guide/start')
  })

  it('redirects /chapters/sequences → /guide/start', () => {
    expect(resolveRedirect('/chapters/sequences')).toBe('/guide/start')
  })

  it('redirects /chapters/protocols → /guide/protocols', () => {
    expect(resolveRedirect('/chapters/protocols')).toBe('/guide/protocols')
  })

  it('redirects /challenge → /', () => {
    expect(resolveRedirect('/challenge')).toBe('/')
  })

  it('returns null for the retired /syntax namespace (guide lives at /guide/*)', () => {
    expect(resolveRedirect('/syntax')).toBeNull()
    expect(resolveRedirect('/syntax/basics')).toBeNull()
  })

  it('redirects /note/:category/:name → /c/:category/:name', () => {
    expect(resolveRedirect('/note/dan-john/simple-strength')).toBe('/c/dan-john/simple-strength')
    // the playground alias keeps priority
    expect(resolveRedirect('/note/playground/my-note')).toBe('/playground/my-note')
  })

  it('redirects /tracker/:runtimeId → /run/:runtimeId', () => {
    expect(resolveRedirect('/tracker/abc-123')).toBe('/run/abc-123')
  })

  it('redirects /plan → /journal?mode=plan (unified journal list)', () => {
    expect(resolveRedirect('/plan')).toBe('/journal?mode=plan')
    // /plan?zip=… callers (e.g. feed → plan pre-fill) preserve caller intent
    // via the PlanRedirect component, not the matrix entry.
  })

  it('returns null for already-canonical paths', () => {
    expect(resolveRedirect('/playground/my-note')).toBeNull()
    expect(resolveRedirect('/journal/2026-05-19')).toBeNull()
    expect(resolveRedirect('/collections/dan-john/simple-strength')).toBeNull()
    expect(resolveRedirect('/guide/getting-started')).toBeNull()
    expect(resolveRedirect('/guide/start')).toBeNull()
    expect(resolveRedirect('/run/abc-123')).toBeNull()
    expect(resolveRedirect('/review/abc-123')).toBeNull()
  })

  it('returns null for unknown paths', () => {
    expect(resolveRedirect('/unknown-path')).toBeNull()
    expect(resolveRedirect('/foo/bar/baz')).toBeNull()
    expect(resolveRedirect('')).toBeNull()
  })

  it('handles URL-encoded characters in legacy paths', () => {
    expect(resolveRedirect('/note/playground/hello%20world')).toBe(
      '/playground/hello%20world',
    )
    expect(resolveRedirect('/workout/cat%201/name%202')).toBe(
      '/c/cat%201/name%202',
    )
  })

  it('redirects /feed to /feeds', () => {
    expect(resolveRedirect('/feed')).toBe('/feeds')
    expect(resolveRedirect('/feed/')).toBe('/feeds')
  })

  it('does not partially match substrings', () => {
    expect(resolveRedirect('/prefix/getting-started')).toBeNull()
    expect(resolveRedirect('/tracker')).toBeNull()
    expect(resolveRedirect('/note/playground')).toBeNull()
  })
})

describe('ROUTE_REDIRECTS structure', () => {
  it('every rule has a match function and a to function', () => {
    for (const rule of ROUTE_REDIRECTS) {
      expect(typeof rule.match).toBe('function')
      expect(typeof rule.to).toBe('function')
    }
  })

  it('match returns false for non-matching paths', () => {
    for (const rule of ROUTE_REDIRECTS) {
      expect(rule.match('/totally-unrelated-path')).toBe(false)
    }
  })

  it('match returns a params object for matching paths', () => {
    const params = ROUTE_REDIRECTS[0]!.match('/note/playground/test')
    expect(params).not.toBe(false)
    expect(params).toEqual({ name: 'test' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Path builders
// ═══════════════════════════════════════════════════════════════════════════

describe('path builders', () => {
  it('playgroundPath encodes the id', () => {
    expect(playgroundPath('hello world')).toBe('/playground/hello%20world')
  })

  it('journalEntryPath encodes the id', () => {
    expect(journalEntryPath('2026-05-19')).toBe('/journal/2026-05-19')
  })

  it('journalNotePath is retired — note selection opens the canonical editor', () => {
    // journalNotePath was removed; /journal/:date?note= and /journal/:date/:noteId
    // redirect to the canonical single-note editor.
    expect(noteByIdPath('abc-123')).toBe('/notes/abc-123')
  })

  it('journalEntryAutoStartPath appends query param', () => {
    expect(journalEntryAutoStartPath('2026-05-19', 'run-42')).toBe(
      '/journal/2026-05-19?autoStart=run-42',
    )
  })

  it('workoutPath encodes collection and page slug under the /c prefix', () => {
    expect(workoutPath('dan john', 'simple strength')).toBe(
      '/c/dan%20john/simple%20strength',
    )
  })

  it('collectionPath lands the collection under the /c prefix', () => {
    expect(collectionPath('dan-john')).toBe('/c/dan-john')
  })

  it('collectionDatePath scopes a collection to a date under the /c prefix', () => {
    expect(collectionDatePath('dan-john', '2026-09-17')).toBe('/c/dan-john/2026-09-17')
  })

  it('sessionsPath, sessionDetailPath and sessionDatePath build the sessions family', () => {
    expect(sessionsPath()).toBe('/sessions')
    expect(sessionDetailPath('res-1')).toBe('/results/res-1')
    expect(sessionDatePath('2026-09-17')).toBe('/session/2026-09-17')
  })

  it('pagePath builds the generic page render route', () => {
    expect(pagePath('syntax/basics')).toBe('/p/syntax/basics')
  })

  it('dashboardPath lands the dashboards list and dashboardSlugPath the /d view', () => {
    expect(dashboardPath()).toBe('/dashboards')
    expect(dashboardSlugPath('strength-trends')).toBe('/d/strength-trends')
  })

  it('playgroundsPath builds the playground list route', () => {
    expect(playgroundsPath()).toBe('/playgrounds')
  })

  it('effortPath builds under the /e prefix, preserving modifiers', () => {
    expect(effortPath('grace')).toBe('/e/grace')
    expect(effortPath('grace', { weight: '60' })).toBe('/e/grace?weight=60')
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

  it('feedDetailPath encodes slug', () => {
    expect(feedDetailPath('my feed')).toBe('/feeds/my%20feed')
  })

  it('feedItemPath encodes all three segments', () => {
    expect(feedItemPath('my feed', '2026-05-19', 'item 1')).toBe(
      '/feeds/my%20feed/2026-05-19/item%201',
    )
  })

  it('collectionPath lands the collection under the /c prefix', () => {
    expect(collectionPath('dan-john')).toBe('/c/dan-john')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Route family helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('route family helpers', () => {
  it('isPlaygroundNotePath detects canonical and alias paths', () => {
    expect(isPlaygroundNotePath('/playground/my-note')).toBe(true)
    expect(isPlaygroundNotePath('/note/playground/my-note')).toBe(true)
    expect(isPlaygroundNotePath('/playground')).toBe(false)
    expect(isPlaygroundNotePath('/journal/my-note')).toBe(false)
    expect(isPlaygroundNotePath('/')).toBe(false)
  })

  it('isJournalEntryPath detects /journal/:id but not /journal index', () => {
    expect(isJournalEntryPath('/journal/2026-05-19')).toBe(true)
    expect(isJournalEntryPath('/journal/abc')).toBe(true)
    expect(isJournalEntryPath('/journal')).toBe(false)
  expect(isJournalEntryPath('/journal/')).toBe(false)
    expect(isJournalEntryPath('/playground/note')).toBe(false)
  })

  it('isTrackerPath detects /tracker and /run', () => {
    expect(isTrackerPath('/tracker/abc')).toBe(true)
    expect(isTrackerPath('/run/abc')).toBe(true)
    expect(isTrackerPath('/tracker')).toBe(false)
    expect(isTrackerPath('/run')).toBe(false)
  })

  it('isCollectionWorkoutPath detects /collections/:c/:w', () => {
    expect(isCollectionWorkoutPath('/collections/dan-john/simple')).toBe(true)
    expect(isCollectionWorkoutPath('/collections/dan-john')).toBe(false)
    expect(isCollectionWorkoutPath('/collections')).toBe(false)
    expect(isCollectionWorkoutPath('/collections/a/')).toBe(false)
    expect(isCollectionWorkoutPath('/playground/note')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Redirect components
// ═══════════════════════════════════════════════════════════════════════════

describe('NotePlaygroundRedirect', () => {
  it('renders Navigate to /playground/:name with replace', async () => {
    mockParams = { name: 'my-playground' }
    const { NotePlaygroundRedirect } = redirectComponents!
    render(<NotePlaygroundRedirect />)

    expect(lastNavigateTo).toBe('/playground/my-playground')
    expect(lastNavigateReplace).toBe(true)
    expect(screen.getByTestId('navigate')).toBeDefined()
  })

  it('handles encoded names', async () => {
    mockParams = { name: 'hello world' }
    const { NotePlaygroundRedirect } = redirectComponents!
    render(<NotePlaygroundRedirect />)

    expect(lastNavigateTo).toBe('/playground/hello%20world')
  })
})

describe('WorkoutRedirect', () => {
  it('renders Navigate to /c/:category/:name with replace', async () => {
    mockParams = { category: 'dan-john', name: 'simple-strength' }
    const { WorkoutRedirect } = redirectComponents!
    render(<WorkoutRedirect />)

    expect(lastNavigateTo).toBe('/c/dan-john/simple-strength')
    expect(lastNavigateReplace).toBe(true)
  })
})

describe('CollectionItemRedirect', () => {
  it('routes a page-slug target to the /c collection editor', async () => {
    mockParams = { slug: 'dan-john', target: 'simple-strength' }
    const { CollectionItemRedirect } = redirectComponents!
    render(<CollectionItemRedirect />)

    expect(lastNavigateTo).toBe('/c/dan-john/simple-strength')
  })

  it('routes a note-UUID target to the canonical single-note editor', async () => {
    mockParams = { slug: 'dan-john', target: '550e8400-e29b-41d4-a716-446655440000' }
    const { CollectionItemRedirect } = redirectComponents!
    render(<CollectionItemRedirect />)

    expect(lastNavigateTo).toBe('/notes/550e8400-e29b-41d4-a716-446655440000')
  })

  it('routes a slug-only landing to /c/:slug', async () => {
    mockParams = { slug: 'dan-john' }
    const { CollectionItemRedirect } = redirectComponents!
    render(<CollectionItemRedirect />)

    expect(lastNavigateTo).toBe('/c/dan-john')
  })
})

describe('TrackerRedirect', () => {
  it('renders Navigate to /run/:runtimeId with replace', async () => {
    mockParams = { runtimeId: 'abc-123' }
    const { TrackerRedirect } = redirectComponents!
    render(<TrackerRedirect />)

    expect(lastNavigateTo).toBe('/run/abc-123')
    expect(lastNavigateReplace).toBe(true)
  })
})

describe('GettingStartedRedirect', () => {
  it('renders Navigate to / with replace', async () => {
    const { GettingStartedRedirect } = redirectComponents!
    render(<GettingStartedRedirect />)

    expect(lastNavigateTo).toBe('/')
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
  it('declares all canonical route families', () => {
    expect(ROUTE_PATTERNS.home).toBe('/')
    expect(ROUTE_PATTERNS.playgroundRoot).toBe('/playground')
    expect(ROUTE_PATTERNS.playground).toBe('/playground/:id')
    expect(ROUTE_PATTERNS.notePlaygroundAlias).toBe('/note/playground/:name')
    expect(ROUTE_PATTERNS.note).toBe('/note/:category/:name')
    expect(ROUTE_PATTERNS.journal).toBe('/journal')
    expect(ROUTE_PATTERNS.journalEntry).toBe('/journal/:identity')
    expect(ROUTE_PATTERNS.journalNote).toBe('/journal/:date/:uuid')
    expect(ROUTE_PATTERNS.plan).toBe('/plan')
    expect(ROUTE_PATTERNS.feeds).toBe('/feeds')
    expect(ROUTE_PATTERNS.feed).toBe('/feed')
    expect(ROUTE_PATTERNS.feedDetail).toBe('/feeds/:feedSlug')
    expect(ROUTE_PATTERNS.feedItem).toBe('/feeds/:feedSlug/:feedDate/:feedItem')
    expect(ROUTE_PATTERNS.catalogs).toBe('/catalogs')
    expect(ROUTE_PATTERNS.collections).toBe('/collections')
    expect(ROUTE_PATTERNS.collectionDetail).toBe('/collections/:slug')
    expect(ROUTE_PATTERNS.collectionWorkout).toBe('/collections/:collection/:workout')
    expect(ROUTE_PATTERNS.tracker).toBe('/tracker/:runtimeId')
    expect(ROUTE_PATTERNS.run).toBe('/run/:runtimeId')
    expect(ROUTE_PATTERNS.load).toBe('/load')
    expect(ROUTE_PATTERNS.loadJournal).toBe('/load/journal')
    expect(ROUTE_PATTERNS.loadJournalDate).toBe('/load/journal/:date')
    // Equipment L1 family — list stream + detail/create note pages.
    expect(ROUTE_PATTERNS.equipment).toBe('/equipment')
    expect(ROUTE_PATTERNS.equipmentSlug).toBe('/equipment/:slug')
    expect(equipmentPath('dumbbell')).toBe('/equipment/dumbbell')
    expect(isEquipmentPath('/equipment')).toBe(true)
    expect(isEquipmentPath('/equipment/dumbbell')).toBe(true)
    expect(isEquipmentPath('/efforts')).toBe(false)
    expect(isEquipmentPath('/e/dumbbell')).toBe(false)
  })
})
