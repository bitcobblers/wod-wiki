/**
 * routeView.test — the unit tests that were impossible while classification
 * lived inline in `AppContent`. Classifies URLs against injected data with no
 * React mount and no IndexedDB.
 */
import { describe, expect, it, mock } from 'bun:test'
import type { Session } from '@/types/storage'
import type { Sessions } from '@/components/Editor/types'
import type { ParsedCanvasPage } from '../canvas/parseCanvasMarkdown'
import {
  resolveRouteView,
  type RouteViewDeps,
  type RouteViewParams,
  type SelectWorkoutItem,
} from './routeView'
/** Minimal result fixture — only `createdAt` matters to the nav derivation. */
function makeResult(createdAt: number, id = `r-${createdAt}`): Session {
  return { id, noteId: 'note-1', data: {} as Sessions, createdAt }
}

function makeDeps(overrides: Partial<RouteViewDeps> = {}): RouteViewDeps {
  return {
    workoutItems: [],
    canvasPage: null,
    recentResults: [],
    selectWorkout: () => {},
    ...overrides,
  }
}

const NO_PARAMS: RouteViewParams = {}

describe('resolveRouteView — journal nav', () => {
  it('derives the top-10 distinct result dates for /journal, newest first', () => {
    const deps = makeDeps({
      recentResults: [
        makeResult(Date.parse('2026-06-28T10:00:00Z')),
        makeResult(Date.parse('2026-06-28T18:00:00Z')), // same day → deduped
        makeResult(Date.parse('2026-06-01T10:00:00Z')),
      ],
    })
    const view = resolveRouteView('/journal', NO_PARAMS, deps)
    expect(view.nav.map(l => l.id)).toEqual(['2026-06-28', '2026-06-01'])
  })

  it('skips results with invalid dates instead of crashing the nav', () => {
    const deps = makeDeps({
      recentResults: [
        makeResult(NaN),                              // partially-migrated row
        makeResult(undefined as unknown as number),   // legacy row missing the field
        makeResult(Date.parse('2026-06-28T10:00:00Z')),
      ],
    })
    const view = resolveRouteView('/journal', NO_PARAMS, deps)
    expect(view.nav.map(l => l.id)).toEqual(['2026-06-28'])
  })

  it('classifies /journal directly as library page with Journal title', () => {
    const view = resolveRouteView('/journal', NO_PARAMS, makeDeps())
    expect(view.page).toBe('library')
    expect(view.workout.name).toBe('Journal')
    expect(view.shell).toEqual({ wrap: 'bare' })
  })

  it('classifies /journal/ (trailing slash) the same way', () => {
    const view = resolveRouteView('/journal/', NO_PARAMS, makeDeps())
    expect(view.page).toBe('library')
    expect(view.workout.name).toBe('Journal')
    expect(view.shell).toEqual({ wrap: 'bare' })
  })

  it('classifies /settings, /settings/appearance, and /settings/system as settings page', () => {
    for (const path of ['/settings', '/settings/appearance', '/settings/system']) {
      const view = resolveRouteView(path, NO_PARAMS, makeDeps())
      expect(view.page).toBe('settings')
      expect(view.workout.name).toBe('Settings')
      expect(view.shell).toEqual({ wrap: 'bare' })
    }
  })
})

describe('resolveRouteView — journal entry route', () => {
  it('detects /journal/:id and surfaces the decoded id', () => {
    const view = resolveRouteView('/journal/2026-06-28', { name: '2026-06-28' }, makeDeps())
    expect(view.isJournalEntryRoute).toBe(true)
    expect(view.journalEntryId).toBe('2026-06-28')
    expect(view.workout.category).toBe('journal')
    expect(view.workout.name).toBe('2026-06-28')
  })
})

describe('resolveRouteView — named routes', () => {
  it('classifies the named routes to their labels', () => {
    const cases = [
      ['/', 'Home'],
      ['/feeds', 'Feeds'],
    ] as const
    for (const [path, name] of cases) {
      const view = resolveRouteView(path, NO_PARAMS, makeDeps())
      expect(view.workout.name).toBe(name)
      expect(view.workout.category).toBe('General')
    }
  })

  it('returns no nav for bare routes like /feeds', () => {
    const view = resolveRouteView('/feeds', NO_PARAMS, makeDeps())
    expect(view.nav).toEqual([])
    expect(view.canvasPage).toBeNull()
  })
})

describe('resolveRouteView — playground route', () => {
  it('classifies /playground/:id and resolves the effective id', () => {
    const view = resolveRouteView('/playground/abc', { id: 'abc' }, makeDeps())
    expect(view.isPlaygroundRoute).toBe(true)
    expect(view.effectivePlaygroundId).toBe('abc')
    expect(view.workout).toEqual({ name: 'Playground', content: '', category: 'playground' })
  })

  it('falls back to the :name segment for /note/playground/:name', () => {
    const view = resolveRouteView('/note/playground/xyz', { name: 'xyz' }, makeDeps())
    expect(view.isPlaygroundRoute).toBe(true)
    expect(view.effectivePlaygroundId).toBe('xyz')
  })
})

describe('resolveRouteView — collection workout', () => {
  it('resolves a found collection workout with its content', () => {
    const deps = makeDeps({
      workoutItems: [{ id: 'w1', name: 'Fran', category: 'girls', content: '21-15-9' }],
    })
    const view = resolveRouteView('/collections/girls/Fran', { collection: 'girls', workout: 'Fran' }, deps)
    expect(view.workout).toEqual({ name: 'Fran', content: '21-15-9', category: 'girls' })
  })

  it('falls back to the raw name and URL category when no item matches', () => {
    const view = resolveRouteView('/collections/girls/Ghost', { collection: 'girls', workout: 'Ghost' }, makeDeps())
    expect(view.workout.name).toBe('Ghost')
    // The URL-declared category wins even when the corpus index has no match:
    // usePlaygroundContent resolves stored notes by pageId(category, name), so
    // collapsing to 'General' would hide every IndexedDB-only collection note
    // behind the default notebook (only bundled corpus items matched before
    // the extraction).
    expect(view.workout.category).toBe('girls')
  })
})

describe('resolveRouteView — collection index nav', () => {
  function makeCollectionPage(prose = 'Collection overview.'): ParsedCanvasPage {
    return {
      frontmatter: {},
      template: 'canvas',
      route: '/collections/crossfit-games',
      quests: [],
      chapters: [],
      sections: [
        {
          id: 'intro',
          heading: 'Intro',
          level: 2,
          attrs: [],
          proseChunks: [{ kind: 'prose' as const, text: prose }],
          commands: [],
          buttons: [],
        },
      ],
    } as unknown as ParsedCanvasPage
  }

  it('derives workout links with onRun + link icon for collection pages', () => {
    const selectWorkout = mock((_item: SelectWorkoutItem) => {})
    const item = {
      id: '../../markdown/collections/crossfit-games/2024-08-10-event-05.md',
      name: '2024-08-10-event-05',
      category: 'crossfit-games',
      content: '...',
    }
    const deps = makeDeps({
      canvasPage: makeCollectionPage(),
      workoutItems: [item],
      selectWorkout,
    })
    const view = resolveRouteView('/collections/crossfit-games', { collection: 'crossfit-games' }, deps)

    const workoutLink = view.nav.find(l => l.id === `workout-${item.id}`)
    expect(workoutLink).toBeDefined()
    expect(workoutLink?.label).toBe('2024-08-10-event-05')
    expect(workoutLink?.type).toBe('time')
    expect(workoutLink?.runIcon).toBe('link')
    expect(workoutLink?.onRun).toBeFunction()

    workoutLink?.onRun?.()
    expect(selectWorkout).toHaveBeenCalledWith(item)
  })

  it('falls back to listing collection items when the page has no {{workouts}} tag', () => {
    const item = {
      id: '../../markdown/collections/crossfit-games/2024-08-10-event-04.md',
      name: '2024-08-10-event-04',
      category: 'crossfit-games',
      content: '...',
    }
    const deps = makeDeps({
      canvasPage: makeCollectionPage('No workouts placeholder.'),
      workoutItems: [item],
    })
    const view = resolveRouteView('/collections/crossfit-games', { collection: 'crossfit-games' }, deps)

    const workoutLink = view.nav.find(l => l.id === `workout-${item.id}`)
    expect(workoutLink).toBeDefined()
    expect(workoutLink?.runIcon).toBe('link')
  })
})

describe('resolveRouteView — stream list routes', () => {
  it('/journal, /feeds, /efforts, /results, and /results/segments map directly to library page', () => {
    // Bare /collections is no longer a view — the router redirects it to /feeds.
    for (const route of ['/journal', '/feeds', '/efforts', '/results', '/results/segments', '/results/res-42']) {
      const view = resolveRouteView(route, NO_PARAMS, makeDeps())
      expect(view.page).toBe('library')
      expect(view.shell).toEqual({ wrap: 'bare' })
    }
  })

  it('classifies bare routes → bare shell', () => {
    expect(resolveRouteView('/feeds', NO_PARAMS, makeDeps()).shell).toEqual({ wrap: 'bare' })
    expect(resolveRouteView('/efforts', NO_PARAMS, makeDeps()).page).toBe('library')
    expect(resolveRouteView('/efforts', NO_PARAMS, makeDeps()).workout.name).toBe('Efforts')
    expect(resolveRouteView('/effort/squat', NO_PARAMS, makeDeps()).page).toBe('effortDetail')
  })

  it('classifies execution telemetry routes (/results list redirect source, /results/:resultId canonical detail)', () => {
    const resultsView = resolveRouteView('/results', NO_PARAMS, makeDeps())
    expect(resultsView.page).toBe('library')
    expect(resultsView.workout.name).toBe('Results')

    const segmentsView = resolveRouteView('/results/segments', NO_PARAMS, makeDeps())
    expect(segmentsView.page).toBe('library')
    expect(segmentsView.workout.name).toBe('Segments')

    const detailView = resolveRouteView('/results/res-42', NO_PARAMS, makeDeps())
    expect(detailView.page).toBe('library')
    expect(detailView.workout.name).toBe('Result')
  })

  it('classifies a canvas collection route → canvas shell with collection-workouts subheader', () => {
    const canvasPage = { route: '/collections/girls', sections: [] } as unknown as ParsedCanvasPage // fixture: only route+sections matter to page/shell derivation
    const view = resolveRouteView('/collections/girls', { collection: 'girls' }, makeDeps({ canvasPage }))
    expect(view.page).toBe('canvas')
    expect(view.shell.wrap).toBe('canvas')
    expect(view.shell.title).toBe('Canvas')
    expect(view.shell.actionsMode).toBe('collection-readonly')
    expect(view.shell.withIndex).toBe(true)
    expect(view.shell.subheader).toBe('filter-collection-workouts')
  })

  it('classifies /playground/:id and the fallback note route → bare shell', () => {
    expect(resolveRouteView('/playground/abc', { id: 'abc' }, makeDeps()).page).toBe('playground')
    expect(resolveRouteView('/note/General/Fran', { category: 'General', name: 'Fran' }, makeDeps()).page).toBe('workout')
  })

  it('classifies the dashboard namespace → bare shell', () => {
    // Legacy /analytics/explorer still classifies (it redirects to /dashboard
    // at the router, but resolveRouteView is pure on the pathname).
    const explorer = resolveRouteView('/analytics/explorer', NO_PARAMS, makeDeps())
    expect(explorer.page).toBe('analyticsExplorer')
    expect(explorer.shell).toEqual({ wrap: 'bare' })

    // The new namespace: /dashboard is the explorer, /dashboard/:slug a view.
    expect(resolveRouteView('/dashboard', NO_PARAMS, makeDeps()).page).toBe('dashboardExplorer')
    expect(resolveRouteView('/dashboard/training-block-review', NO_PARAMS, makeDeps()).page).toBe('dashboardView')
  })
})

describe('resolveRouteView — single-note and collection-date routes', () => {
  const UUID = '01990e80-0000-7000-8000-000000000001'

  it('classifies /notes/:noteId as the single-note page', () => {
    const view = resolveRouteView(`/notes/${UUID}`, NO_PARAMS, makeDeps())
    expect(view.page).toBe('note')
    expect(view.isNoteByIdRoute).toBe(true)
    expect(view.noteById).toBe(UUID)
    expect(view.workout.category).toBe('note')
  })
  it('classifies /note/:noteId as the single-note page', () => {
    const view = resolveRouteView(`/note/${UUID}`, NO_PARAMS, makeDeps())
    expect(view.page).toBe('note')
    expect(view.isNoteByIdRoute).toBe(true)
    expect(view.noteById).toBe(UUID)
    expect(view.workout.category).toBe('note')
  })

  it('classifies /collections/:slug/:noteId as the single-note page', () => {
    const view = resolveRouteView(`/collections/girls/${UUID}`, { collection: 'girls', workout: UUID }, makeDeps())
    expect(view.page).toBe('note')
    expect(view.noteById).toBe(UUID)
  })

  it('classifies /collections/:slug/:date as the date-scoped collection page', () => {
    const view = resolveRouteView('/collections/girls/2026-09-17', { collection: 'girls', workout: '2026-09-17' }, makeDeps())
    expect(view.page).toBe('collectionDate')
    expect(view.collectionDate).toEqual({ slug: 'girls', date: '2026-09-17' })
    expect(view.workout.category).toBe('girls')
  })

  it('keeps /collections/:slug/:name on the workout page', () => {
    const view = resolveRouteView('/collections/girls/Fran', { collection: 'girls', workout: 'Fran' }, makeDeps())
    expect(view.page).toBe('workout')
    expect(view.collectionDate).toBeNull()
    expect(view.noteById).toBeUndefined()
  })
})

describe('resolveRouteView — target-scheme routes (/c, /e, /sessions, /d, /p, /playgrounds)', () => {
  const UUID = '01990e80-0000-7000-8000-000000000001'

  it('classifies /c/:slug/:date as the date-scoped collection page', () => {
    const view = resolveRouteView('/c/girls/2026-09-17', { collection: 'girls', workout: '2026-09-17' }, makeDeps())
    expect(view.page).toBe('collectionDate')
    expect(view.collectionDate).toEqual({ slug: 'girls', date: '2026-09-17' })
    expect(view.workout.category).toBe('girls')
  })

  it('classifies /c/:slug/:noteId as the single-note page', () => {
    const view = resolveRouteView(`/c/girls/${UUID}`, { collection: 'girls', workout: UUID }, makeDeps())
    expect(view.page).toBe('note')
    expect(view.noteById).toBe(UUID)
  })

  it('keeps /c/:slug/:name on the workout page', () => {
    const view = resolveRouteView('/c/girls/Fran', { collection: 'girls', workout: 'Fran' }, makeDeps())
    expect(view.page).toBe('workout')
    expect(view.collectionDate).toBeNull()
    expect(view.noteById).toBeUndefined()
  })

  it('classifies /c/:slug as a stream collection landing', () => {
    const view = resolveRouteView('/c/girls', { collection: 'girls' }, makeDeps())
    expect(view.page).toBe('library')
    expect(view.workout.name).toBe('Girls')
  })

  it('classifies /e/:slug as the effort detail page', () => {
    const view = resolveRouteView('/e/grace', NO_PARAMS, makeDeps())
    expect(view.page).toBe('effortDetail')
    expect(view.workout.name).toBe('grace')
    expect(view.workout.category).toBe('effort')
  })

  it('classifies the sessions family as stream surfaces', () => {
    const listing = resolveRouteView('/sessions', NO_PARAMS, makeDeps())
    expect(listing.page).toBe('library')
    expect(listing.workout.name).toBe('Sessions')

    const detail = resolveRouteView('/results/res-42', NO_PARAMS, makeDeps())
    expect(detail.page).toBe('library')
    expect(detail.workout.name).toBe('Result')

    const byDate = resolveRouteView('/session/2026-09-17', NO_PARAMS, makeDeps())
    expect(byDate.page).toBe('library')
    expect(byDate.workout.name).toBe('2026-09-17')
  })

  it('classifies /dashboards as the explorer and /d/:slug as a dashboard view', () => {
    const landing = resolveRouteView('/dashboards', NO_PARAMS, makeDeps())
    expect(landing.page).toBe('dashboardExplorer')

    const bySlug = resolveRouteView('/d/strength-trends', NO_PARAMS, makeDeps())
    expect(bySlug.page).toBe('dashboardView')
    expect(bySlug.workout.name).toBe('strength-trends')
  })

  it('classifies /playgrounds as the playground listing stream', () => {
    const view = resolveRouteView('/playgrounds', NO_PARAMS, makeDeps())
    expect(view.page).toBe('library')
    expect(view.workout.name).toBe('Playgrounds')
  })

  it('classifies /p/:slug canvas pages onto the canvas shell', () => {
    const canvasPage = { route: '/guide/syntax/basics', sections: [] } as unknown as ParsedCanvasPage
    const view = resolveRouteView('/p/syntax/basics', NO_PARAMS, makeDeps({ canvasPage }))
    expect(view.page).toBe('canvas')
    expect(view.shell.wrap).toBe('canvas')
  })
  it('classifies /p/:slug non-canvas pages as a single-note page by slug', () => {
    const view = resolveRouteView('/p/my-custom-note', NO_PARAMS, makeDeps({ canvasPage: null }))
    expect(view.page).toBe('note')
    expect(view.isNoteByIdRoute).toBe(true)
    expect(view.noteById).toBe('my-custom-note')
  })
})
