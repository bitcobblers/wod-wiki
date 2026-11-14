/**
 * Tier-2 parity suite retiring `e2e/live-app/url-scheme.e2e.ts`:
 *  1. Every canonical list and direct route matches an explicit `ROUTE_PATTERNS`
 *     entry (never falling through to 404) and `DocumentTitleSync` assigns the
 *     exact concept title.
 *  2. All 15 retired paths fall through the `<Routes>` table to `<NotFoundPage />`
 *     without redirecting (`location.pathname` remains unchanged).
 *  3. Saved view settings (`wodwiki.viewSettings.v1/catalogs`) and WQL defaults
 *     (`wodwiki.routeWql.v1/catalogs`) resolve on `/notebooks` and clear cleanly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DocumentTitleSync } from '../DocumentTitleSync'
import { ROUTE_PATTERNS } from '../routes'
import { PlanRedirect, ReviewRedirect, SegmentsRedirect, TrackerRedirect } from '../routeRedirects'
import { NotFoundPage } from '../../pages/NotFoundPage'
import {
  applyRouteWqlConfig,
  clearRouteWqlConfig,
  readRouteWqlConfig,
} from '../routeWqlConfig'
import {
  readViewSettings,
  resetViewSettings,
  useViewSettings,
} from '../viewSettingsStorage'
import { NOTEBOOKS_STREAM_PROFILE } from '../../views/stream/streamProfile'

const CANONICAL_TITLED_ROUTES: ReadonlyArray<{ path: string; title: string }> = [
  { path: '/notebooks', title: 'Wod.Wiki - Notebooks' },
  { path: '/notes', title: 'Wod.Wiki - Notes' },
  { path: '/journal', title: 'Wod.Wiki - Journal' },
  { path: '/pages', title: 'Wod.Wiki - Pages' },
  { path: '/tags', title: 'Wod.Wiki - Tags' },
  { path: '/feeds', title: 'Wod.Wiki - Feeds' },
  { path: '/efforts', title: 'Wod.Wiki - Efforts' },
  { path: '/equipment', title: 'Wod.Wiki - Equipment' },
  { path: '/dashboards', title: 'Wod.Wiki - Dashboards' },
  { path: '/notebook/crossfit-girls', title: 'Wod.Wiki - Notebooks' },
  { path: '/notebook/crossfit-girls/fran', title: 'Wod.Wiki - Notebooks' },
  { path: '/note/url-scheme-note', title: 'Wod.Wiki - Note' },
  { path: '/day/2099-12-31', title: 'Wod.Wiki - Day' },
  { path: '/feed/sport-crossfit', title: 'Wod.Wiki - Feed' },
  { path: '/t/domain/url-scheme-e2e', title: 'Wod.Wiki - Tags' },
  { path: '/page/guide-start', title: 'Wod.Wiki - Pages' },
]

const RETIRED_PATHS: readonly string[] = [
  '/catalogs',
  '/collections/crossfit-girls',
  '/c/crossfit-girls',
  '/journal/not-a-date',
  '/notes/some-note-id',
  '/p/guide-start',
  '/d/strength-trends',
  '/e/push-up',
  '/workout/crossfit-girls/fran',
  '/analytics/explorer',
  '/note/playground/hello-world',
  '/note/girls/fran',
  '/feed',
  '/dashboard',
  '/analytics',
]

let observedPathname = '/'

function LocationProbe() {
  const location = useLocation()
  observedPathname = location.pathname
  return null
}

function MatchedSurface({ pattern }: { pattern: string }) {
  return <div data-testid="matched-route" data-pattern={pattern} />
}

/** Mirrors App.tsx's explicit `<Routes>` table against `<NotFoundPage />` fallback. */
function renderAppRouteTable(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path={ROUTE_PATTERNS.home} element={<MatchedSurface pattern={ROUTE_PATTERNS.home} />} />
        <Route path="*" element={<NotFoundPage />} />
        <Route path="/proto/calc-authoring" element={<MatchedSurface pattern="/proto/calc-authoring" />} />
        <Route path="/proto/query-block-composer" element={<MatchedSurface pattern="/proto/query-block-composer" />} />
        <Route path="/settings" element={<Navigate to="/settings/appearance" replace />} />
        <Route path="/settings/appearance" element={<MatchedSurface pattern="/settings/appearance" />} />
        <Route path={ROUTE_PATTERNS.settingsProfile} element={<MatchedSurface pattern={ROUTE_PATTERNS.settingsProfile} />} />
        <Route path={ROUTE_PATTERNS.settingsData} element={<Navigate to={ROUTE_PATTERNS.settingsStorage} replace />} />
        <Route path={ROUTE_PATTERNS.settingsDatabase} element={<Navigate to={ROUTE_PATTERNS.settingsStorage} replace />} />
        <Route path={ROUTE_PATTERNS.settingsStorage} element={<MatchedSurface pattern={ROUTE_PATTERNS.settingsStorage} />} />
        <Route path={ROUTE_PATTERNS.settingsSync} element={<MatchedSurface pattern={ROUTE_PATTERNS.settingsSync} />} />
        <Route path="/settings/system" element={<MatchedSurface pattern="/settings/system" />} />
        <Route path={ROUTE_PATTERNS.settingsQueries} element={<Navigate to={ROUTE_PATTERNS.journal} replace />} />
        <Route path={ROUTE_PATTERNS.settingsTags} element={<MatchedSurface pattern={ROUTE_PATTERNS.settingsTags} />} />
        <Route path={ROUTE_PATTERNS.settingsSoundProfiles} element={<MatchedSurface pattern={ROUTE_PATTERNS.settingsSoundProfiles} />} />
        <Route path="/settings/library/calcs" element={<MatchedSurface pattern="/settings/library/calcs" />} />
        <Route path="/legacy" element={<MatchedSurface pattern="/legacy" />} />
        <Route path="/syntax" element={<MatchedSurface pattern="/syntax" />} />
        <Route path={ROUTE_PATTERNS.plan} element={<PlanRedirect />} />
        <Route path={ROUTE_PATTERNS.feeds} element={<MatchedSurface pattern={ROUTE_PATTERNS.feeds} />} />
        <Route path={ROUTE_PATTERNS.feed} element={<MatchedSurface pattern={ROUTE_PATTERNS.feed} />} />
        <Route path={ROUTE_PATTERNS.notebooks} element={<MatchedSurface pattern={ROUTE_PATTERNS.notebooks} />} />
        <Route path={ROUTE_PATTERNS.notebook} element={<MatchedSurface pattern={ROUTE_PATTERNS.notebook} />} />
        <Route path={ROUTE_PATTERNS.notebookTarget} element={<MatchedSurface pattern={ROUTE_PATTERNS.notebookTarget} />} />
        <Route path={ROUTE_PATTERNS.notebookItem} element={<MatchedSurface pattern={ROUTE_PATTERNS.notebookItem} />} />
        <Route path={ROUTE_PATTERNS.subscribe} element={<MatchedSurface pattern={ROUTE_PATTERNS.subscribe} />} />
        <Route path={ROUTE_PATTERNS.pages} element={<MatchedSurface pattern={ROUTE_PATTERNS.pages} />} />
        <Route path={ROUTE_PATTERNS.page} element={<MatchedSurface pattern={ROUTE_PATTERNS.page} />} />
        <Route path={ROUTE_PATTERNS.load} element={<MatchedSurface pattern={ROUTE_PATTERNS.load} />} />
        <Route path={ROUTE_PATTERNS.loadJournal} element={<MatchedSurface pattern={ROUTE_PATTERNS.loadJournal} />} />
        <Route path={ROUTE_PATTERNS.loadJournalDate} element={<MatchedSurface pattern={ROUTE_PATTERNS.loadJournalDate} />} />
        <Route path={ROUTE_PATTERNS.playgroundRoot} element={<MatchedSurface pattern={ROUTE_PATTERNS.playgroundRoot} />} />
        <Route path={ROUTE_PATTERNS.playground} element={<MatchedSurface pattern={ROUTE_PATTERNS.playground} />} />
        <Route path={ROUTE_PATTERNS.playgrounds} element={<MatchedSurface pattern={ROUTE_PATTERNS.playgrounds} />} />
        <Route path={ROUTE_PATTERNS.notes} element={<MatchedSurface pattern={ROUTE_PATTERNS.notes} />} />
        <Route path={ROUTE_PATTERNS.note} element={<MatchedSurface pattern={ROUTE_PATTERNS.note} />} />
        <Route path={ROUTE_PATTERNS.journal} element={<MatchedSurface pattern={ROUTE_PATTERNS.journal} />} />
        <Route path={ROUTE_PATTERNS.day} element={<MatchedSurface pattern={ROUTE_PATTERNS.day} />} />
        <Route path={ROUTE_PATTERNS.run} element={<MatchedSurface pattern={ROUTE_PATTERNS.run} />} />
        <Route path={ROUTE_PATTERNS.tracker} element={<TrackerRedirect />} />
        <Route path="/results/segments" element={<SegmentsRedirect />} />
        <Route path={ROUTE_PATTERNS.sessionDetail} element={<MatchedSurface pattern={ROUTE_PATTERNS.sessionDetail} />} />
        <Route path={ROUTE_PATTERNS.sessions} element={<MatchedSurface pattern={ROUTE_PATTERNS.sessions} />} />
        <Route path={ROUTE_PATTERNS.sessionDate} element={<MatchedSurface pattern={ROUTE_PATTERNS.sessionDate} />} />
        <Route path="/review/:runtimeId" element={<ReviewRedirect />} />
        <Route path="/note/:noteId/review" element={<ReviewRedirect />} />
        <Route path="/note/:noteId/review/:sectionId" element={<ReviewRedirect />} />
        <Route path="/note/:noteId/review/:sectionId/:resultId" element={<ReviewRedirect />} />
        <Route path={ROUTE_PATTERNS.efforts} element={<MatchedSurface pattern={ROUTE_PATTERNS.efforts} />} />
        <Route path={ROUTE_PATTERNS.effort} element={<MatchedSurface pattern={ROUTE_PATTERNS.effort} />} />
        <Route path={ROUTE_PATTERNS.equipment} element={<MatchedSurface pattern={ROUTE_PATTERNS.equipment} />} />
        <Route path={ROUTE_PATTERNS.equipmentSlug} element={<MatchedSurface pattern={ROUTE_PATTERNS.equipmentSlug} />} />
        <Route path={ROUTE_PATTERNS.tags} element={<MatchedSurface pattern={ROUTE_PATTERNS.tags} />} />
        <Route path={ROUTE_PATTERNS.tagCategory} element={<MatchedSurface pattern={ROUTE_PATTERNS.tagCategory} />} />
        <Route path={ROUTE_PATTERNS.tag} element={<MatchedSurface pattern={ROUTE_PATTERNS.tag} />} />
        <Route path={ROUTE_PATTERNS.dashboards} element={<MatchedSurface pattern={ROUTE_PATTERNS.dashboards} />} />
        <Route path={ROUTE_PATTERNS.dashboardView} element={<MatchedSurface pattern={ROUTE_PATTERNS.dashboardView} />} />
      </Routes>
      <DocumentTitleSync />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  cleanup()
  window.localStorage.clear()
  document.title = 'Initial Title'
  observedPathname = '/'
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('URL scheme parity — canonical routes & DocumentTitleSync', () => {
  for (const { path, title } of CANONICAL_TITLED_ROUTES) {
    it(`${path} matches an explicit route and sets document.title to "${title}"`, () => {
      renderAppRouteTable(path)
      expect(screen.queryByRole('heading', { name: /not found/i })).toBeNull()
      expect(screen.getByTestId('matched-route')).toBeDefined()
      expect(observedPathname).toBe(path)
      expect(document.title).toBe(title)
    })
  }
})

describe('URL scheme parity — retired paths 404 without redirecting', () => {
  for (const path of RETIRED_PATHS) {
    it(`${path} renders NotFoundPage and keeps pathname at ${path}`, () => {
      renderAppRouteTable(path)
      expect(screen.getByRole('heading', { name: /not found/i })).toBeDefined()
      expect(screen.queryByTestId('matched-route')).toBeNull()
      expect(observedPathname).toBe(path)
    })
  }
})

describe('URL scheme parity — /catalogs -> /notebooks localStorage migrations', () => {
  it('resolves view settings stored under wodwiki.viewSettings.v1/catalogs on /notebooks', () => {
    window.localStorage.setItem(
      'wodwiki.viewSettings.v1/catalogs',
      JSON.stringify({ level: 'note', layout: 'rows', visibleFields: ['title', 'date'] }),
    )

    const resolved = readViewSettings('/notebooks', 'note')
    expect(resolved.layout).toBe('rows')
    expect(resolved.visibleFields).toEqual(['title', 'date'])

    const { result } = renderHook(() => useViewSettings('/notebooks', 'note'))
    expect(result.current.settings.layout).toBe('rows')

    resetViewSettings('/notebooks', 'note')
    expect(window.localStorage.getItem('wodwiki.viewSettings.v1/catalogs')).toBeNull()
    expect(readViewSettings('/notebooks', 'note').layout).toBe('cards')
  })

  it('resolves query config stored under wodwiki.routeWql.v1/catalogs on /notebooks', async () => {
    window.localStorage.setItem(
      'wodwiki.routeWql.v1/catalogs',
      JSON.stringify({ defaultWql: ':notebook{notebook:crossfit-girls}' }),
    )

    const config = readRouteWqlConfig('/notebooks')
    expect(config).toEqual({ defaultWql: ':notebook{notebook:crossfit-girls}' })

    const applied = applyRouteWqlConfig(NOTEBOOKS_STREAM_PROFILE)
    expect(applied.defaultWql).toBe(':notebook{notebook:crossfit-girls}')

    // Legacy `:feed{catalog:crossfit-girls}` also migrates onto `:notebook{notebook:crossfit-girls}`
    window.localStorage.setItem(
      'wodwiki.routeWql.v1/catalogs',
      JSON.stringify({ defaultWql: ':feed{catalog:crossfit-girls}' }),
    )
    expect(readRouteWqlConfig('/notebooks').defaultWql).toBe(':notebook{notebook:crossfit-girls}')

    await clearRouteWqlConfig('/notebooks')
    expect(window.localStorage.getItem('wodwiki.routeWql.v1/catalogs')).toBeNull()
    expect(readRouteWqlConfig('/notebooks')).toEqual({})
  })
})
