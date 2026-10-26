/**
 * routeView.test — the unit tests that were impossible while classification
 * lived inline in `AppContent`. Classifies URLs against injected data with no
 * React mount and no IndexedDB.
 */
import { describe, expect, it, mock } from 'bun:test'
import type { Session } from '@/types/storage'
import type { Sessions } from '@/components/Editor/types'
import type { ParsedCanvasPage } from '../canvas/parseCanvasMarkdown'
import { HOME_PAGE } from '../canvas/homeSlice'
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

describe('resolveRouteView — day route', () => {
  it('detects /day/:date and surfaces the decoded date', () => {
    const view = resolveRouteView('/day/2026-06-28', NO_PARAMS, makeDeps())
    expect(view.isDayRoute).toBe(true)
    expect(view.day).toBe('2026-06-28')
    expect(view.workout.category).toBe('journal')
    expect(view.workout.name).toBe('2026-06-28')
  })

  it('does not classify the retired /journal/:identity grammar', () => {
    const view = resolveRouteView('/journal/2026-06-28', NO_PARAMS, makeDeps())
    expect(view.isDayRoute).toBe(false)
    expect(view.day).toBeUndefined()
  })
})

describe('resolveRouteView — named routes', () => {
  it('classifies the named routes to their labels', () => {
    const cases = [
      ['/', 'Home'],
      ['/notes', 'Notes'],
      ['/notebooks', 'Notebooks'],
      ['/feeds', 'Feeds'],
      ['/pages', 'Pages'],
    ] as const
    for (const [path, name] of cases) {
      const view = resolveRouteView(path, NO_PARAMS, makeDeps())
      expect(view.workout.name).toBe(name)
      expect(view.workout.category).toBe('General')
    }
  })

  it('sets content to empty string for named stream routes so download is suppressed', () => {
    for (const path of ['/efforts', '/notebooks', '/notes', '/feeds', '/pages']) {
      const view = resolveRouteView(path, NO_PARAMS, makeDeps())
      expect(view.workout.content).toBe('')
    }
  })

  it('returns no nav for bare routes like /notes', () => {
    const view = resolveRouteView('/notes', NO_PARAMS, makeDeps())
    expect(view.nav).toEqual([])
    expect(view.canvasPage).toBeNull()
  })
})

describe('resolveRouteView — bundle-owned home route', () => {
  it('classifies / identically before and after the corpus lands', () => {
    for (const canvasPage of [null, HOME_PAGE]) {
      const view = resolveRouteView('/', NO_PARAMS, makeDeps({ canvasPage }))
      expect(view.page).toBe('home')
      expect(view.canvasPage).toBeNull()
      expect(view.workout.name).toBe('Home')
      expect(view.shell).toMatchObject({
        wrap: 'canvas',
        title: 'Home',
        actionsMode: 'collection-readonly',
        withIndex: true,
      })
      expect(view.nav).toEqual([])
    }
  })
})

describe('resolveRouteView — playground route', () => {
  it('classifies /playground/:id and resolves the effective id', () => {
    const view = resolveRouteView('/playground/abc', { id: 'abc' }, makeDeps())
    expect(view.isPlaygroundRoute).toBe(true)
    expect(view.effectivePlaygroundId).toBe('abc')
    expect(view.workout).toEqual({ name: 'Playground', content: '', category: 'playground' })
  })

  it('does not treat the retired /note/playground/:name alias as a playground route', () => {
    const view = resolveRouteView('/note/playground/xyz', NO_PARAMS, makeDeps())
    expect(view.isPlaygroundRoute).toBe(false)
    expect(view.effectivePlaygroundId).toBeUndefined()
  })
})

describe('resolveRouteView — notebook item', () => {
  it('resolves a found notebook item with its content', () => {
    const deps = makeDeps({
      workoutItems: [{ id: 'w1', name: 'Fran', category: 'girls', content: '21-15-9' }],
    })
    const view = resolveRouteView('/notebook/girls/Fran', { slug: 'girls', target: 'Fran' }, deps)
    expect(view.workout).toEqual({ name: 'Fran', content: '21-15-9', category: 'girls' })
  })

  it('falls back to the raw name and URL category when no item matches', () => {
    const view = resolveRouteView('/notebook/girls/Ghost', { slug: 'girls', target: 'Ghost' }, makeDeps())
    expect(view.workout.name).toBe('Ghost')
    // The URL-declared category wins even when the corpus index has no match:
    // usePlaygroundContent resolves stored notes by pageId(category, name), so
    // collapsing to 'General' would hide every IndexedDB-only collection note
    // behind the default notebook (only bundled corpus items matched before
    // the extraction).
    expect(view.workout.category).toBe('girls')
  })
})

describe('resolveRouteView — notebook index nav', () => {
  function makeNotebookPage(prose = 'Notebook overview.'): ParsedCanvasPage {
    return {
      frontmatter: {},
      template: 'canvas',
      route: '/notebook/crossfit-games',
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

  it('derives workout links with onRun + link icon for notebook pages', () => {
    const selectWorkout = mock((_item: SelectWorkoutItem) => {})
    const item = {
      id: '../../markdown/collections/crossfit-games/2024-08-10-event-05.md',
      name: '2024-08-10-event-05',
      category: 'crossfit-games',
      content: '...',
    }
    const deps = makeDeps({
      canvasPage: makeNotebookPage(),
      workoutItems: [item],
      selectWorkout,
    })
    const view = resolveRouteView('/notebook/crossfit-games', { slug: 'crossfit-games' }, deps)

    const workoutLink = view.nav.find(l => l.id === `workout-${item.id}`)
    expect(workoutLink).toBeDefined()
    expect(workoutLink?.label).toBe('2024-08-10-event-05')
    expect(workoutLink?.type).toBe('time')
    expect(workoutLink?.runIcon).toBe('link')
    expect(workoutLink?.onRun).toBeFunction()

    workoutLink?.onRun?.()
    expect(selectWorkout).toHaveBeenCalledWith(item)
  })

  it('falls back to listing notebook items when the page has no {{workouts}} tag', () => {
    const item = {
      id: '../../markdown/collections/crossfit-games/2024-08-10-event-04.md',
      name: '2024-08-10-event-04',
      category: 'crossfit-games',
      content: '...',
    }
    const deps = makeDeps({
      canvasPage: makeNotebookPage('No workouts placeholder.'),
      workoutItems: [item],
    })
    const view = resolveRouteView('/notebook/crossfit-games', { slug: 'crossfit-games' }, deps)

    const workoutLink = view.nav.find(l => l.id === `workout-${item.id}`)
    expect(workoutLink).toBeDefined()
    expect(workoutLink?.runIcon).toBe('link')
  })
})

describe('resolveRouteView — stream list routes', () => {
  it('maps every library list route directly to the library page', () => {
    for (const route of ['/journal', '/notes', '/notebooks', '/feeds', '/pages', '/efforts', '/results/res-42']) {
      const view = resolveRouteView(route, NO_PARAMS, makeDeps())
      expect(view.page).toBe('library')
      expect(view.shell).toEqual({ wrap: 'bare' })
    }
  })

  it('does not classify the retired bare /results list as a stream', () => {
    // Bare /results has no stream profile of its own — the router 404s it
    // before a page renders.
    expect(resolveRouteView('/results', NO_PARAMS, makeDeps()).page).not.toBe('library')
  })

  it('classifies bare routes → bare shell', () => {
    expect(resolveRouteView('/notes', NO_PARAMS, makeDeps()).shell).toEqual({ wrap: 'bare' })
    expect(resolveRouteView('/efforts', NO_PARAMS, makeDeps()).page).toBe('library')
    expect(resolveRouteView('/efforts', NO_PARAMS, makeDeps()).workout.name).toBe('Efforts')
    expect(resolveRouteView('/effort/squat', NO_PARAMS, makeDeps()).page).toBe('effortDetail')
  })

  it('classifies equipment routes — /equipment is the note stream, /equipment/:slug is the detail page', () => {
    const listView = resolveRouteView('/equipment', NO_PARAMS, makeDeps())
    expect(listView.page).toBe('library')
    expect(listView.workout.name).toBe('Equipment')

    const detailView = resolveRouteView('/equipment/dumbbell', NO_PARAMS, makeDeps())
    expect(detailView.page).toBe('equipmentDetail')
    expect(detailView.workout.name).toBe('dumbbell')
    expect(detailView.workout.category).toBe('equipment')

    // Effort routes keep their own family — no prefix bleed either way.
    expect(resolveRouteView('/equipment', NO_PARAMS, makeDeps()).page).not.toBe('effortDetail')
  })

  it('classifies execution telemetry routes (/results/:resultId canonical detail)', () => {
    const detailView = resolveRouteView('/results/res-42', NO_PARAMS, makeDeps())
    expect(detailView.page).toBe('library')
    expect(detailView.workout.name).toBe('Result')
  })

  it('classifies a canvas page route → canvas shell', () => {
    const canvasPage = { route: '/page/guide-structure', sections: [] } as unknown as ParsedCanvasPage // fixture: only route+sections matter to page/shell derivation
    const view = resolveRouteView('/page/guide-structure', NO_PARAMS, makeDeps({ canvasPage }))
    expect(view.page).toBe('canvas')
    expect(view.shell.wrap).toBe('canvas')
    expect(view.shell.title).toBe('Canvas')
    expect(view.shell.actionsMode).toBe('collection-readonly')
    expect(view.shell.withIndex).toBe(true)
  })

  it('canvas pages under the notebook prefix keep the collection filter subheader', () => {
    // A corpus canvas page may declare a deep route under a notebook
    // (/notebook/<slug>/<page> is not a stream route). It renders on the
    // canvas shell with the same TextFilterStrip subheader the
    // /collections/:slug landing carried before the rename.
    const canvasPage = { route: '/notebook/girls/welcome', sections: [] } as unknown as ParsedCanvasPage
    const view = resolveRouteView('/notebook/girls/welcome', NO_PARAMS, makeDeps({ canvasPage }))
    expect(view.page).toBe('canvas')
    expect(view.shell.subheader).toBe('filter-collection-workouts')
  })

  it('prefers the stream landing when a notebook path also has a canvas page', () => {
    const canvasPage = { route: '/notebook/girls', sections: [] } as unknown as ParsedCanvasPage
    const view = resolveRouteView('/notebook/girls', { slug: 'girls' }, makeDeps({ canvasPage }))
    expect(view.page).toBe('library')
  })

  it('classifies /playground/:id → playground page, retired note aliases → not playground', () => {
    expect(resolveRouteView('/playground/abc', { id: 'abc' }, makeDeps()).page).toBe('playground')
    expect(resolveRouteView('/note/General/Fran', NO_PARAMS, makeDeps()).isNoteRoute).toBe(false)
  })

  it('classifies the dashboard namespace → bare shell', () => {
    expect(resolveRouteView('/dashboards', NO_PARAMS, makeDeps()).page).toBe('dashboardExplorer')
    expect(resolveRouteView('/dashboard/training-block-review', NO_PARAMS, makeDeps()).page).toBe('dashboardView')

    // The retired /dashboard landing and /analytics/explorer no longer
    // classify to a dashboard page — the router 404s them.
    expect(resolveRouteView('/dashboard', NO_PARAMS, makeDeps()).page).not.toBe('dashboardExplorer')
    expect(resolveRouteView('/analytics/explorer', NO_PARAMS, makeDeps()).page).not.toBe('dashboardExplorer')
  })
})

describe('resolveRouteView — single-note and notebook-date routes', () => {
  const UUID = '01990e80-0000-7000-8000-000000000001'

  it('classifies /note/:noteId as the single-note page', () => {
    const view = resolveRouteView(`/note/${UUID}`, NO_PARAMS, makeDeps())
    expect(view.page).toBe('note')
    expect(view.isNoteRoute).toBe(true)
    expect(view.note).toBe(UUID)
    expect(view.workout.category).toBe('note')
  })

  it('does not classify the retired /notes/:noteId spelling', () => {
    const view = resolveRouteView(`/notes/${UUID}`, NO_PARAMS, makeDeps())
    expect(view.isNoteRoute).toBe(false)
    expect(view.note).toBeUndefined()
  })

  it('classifies /notebook/:slug/:noteId as the single-note page', () => {
    const view = resolveRouteView(`/notebook/girls/${UUID}`, { slug: 'girls', target: UUID }, makeDeps())
    expect(view.page).toBe('note')
    expect(view.note).toBe(UUID)
  })

  it('classifies /notebook/:slug/:date as the date-scoped notebook page', () => {
    const view = resolveRouteView('/notebook/girls/2026-09-17', { slug: 'girls', target: '2026-09-17' }, makeDeps())
    expect(view.page).toBe('collectionDate')
    expect(view.collectionDate).toEqual({ slug: 'girls', date: '2026-09-17' })
    expect(view.workout.category).toBe('girls')
  })

  it('keeps /notebook/:slug/:name on the workout page', () => {
    const view = resolveRouteView('/notebook/girls/Fran', { slug: 'girls', target: 'Fran' }, makeDeps())
    expect(view.page).toBe('workout')
    expect(view.collectionDate).toBeNull()
    expect(view.note).toBeUndefined()
  })
})

describe('resolveRouteView — canonical direct routes (/notebook, /effort, /dashboard, /page, /feed, /t)', () => {
  const UUID = '01990e80-0000-7000-8000-000000000001'

  it('classifies /notebook/:slug as a stream notebook landing', () => {
    const view = resolveRouteView('/notebook/girls', { slug: 'girls' }, makeDeps())
    expect(view.page).toBe('library')
    expect(view.workout.name).toBe('Girls')
  })

  it('classifies /effort/:slug as the effort detail page', () => {
    const view = resolveRouteView('/effort/grace', NO_PARAMS, makeDeps())
    expect(view.page).toBe('effortDetail')
    expect(view.workout.name).toBe('grace')
    expect(view.workout.category).toBe('effort')
  })

  it('does not classify the retired /e/:slug spelling as the effort detail', () => {
    const view = resolveRouteView('/e/grace', NO_PARAMS, makeDeps())
    expect(view.page).not.toBe('effortDetail')
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

  it('classifies /dashboards as the explorer and /dashboard/:slug as a dashboard view', () => {
    const landing = resolveRouteView('/dashboards', NO_PARAMS, makeDeps())
    expect(landing.page).toBe('dashboardExplorer')

    const bySlug = resolveRouteView('/dashboard/strength-trends', NO_PARAMS, makeDeps())
    expect(bySlug.page).toBe('dashboardView')
    expect(bySlug.workout.name).toBe('strength-trends')

    const retired = resolveRouteView('/d/strength-trends', NO_PARAMS, makeDeps())
    expect(retired.page).not.toBe('dashboardView')
  })

  it('classifies /playgrounds as the playground listing stream', () => {
    const view = resolveRouteView('/playgrounds', NO_PARAMS, makeDeps())
    expect(view.page).toBe('library')
    expect(view.workout.name).toBe('Playgrounds')
  })

  it('classifies /feed/:slug as the feed detail page and deeper segments as the feed item', () => {
    const detail = resolveRouteView('/feed/seed-crossfit', NO_PARAMS, makeDeps())
    expect(detail.page).toBe('feedDetail')
    expect(detail.workout.name).toBe('seed-crossfit')
    expect(detail.workout.category).toBe('feed')

    const item = resolveRouteView('/feed/seed-crossfit/2026-05-19/fran', NO_PARAMS, makeDeps())
    expect(item.page).toBe('feedItem')
    expect(item.workout.name).toBe('fran')
  })

  it('classifies /t/:type/:tag as the tag detail page', () => {
    const view = resolveRouteView('/t/domain/running', NO_PARAMS, makeDeps())
    expect(view.page).toBe('tagDetail')
    expect(view.workout.category).toBe('tags')
  })

  it('classifies /page/:slug canvas pages onto the canvas shell', () => {
    const canvasPage = { route: '/page/guide-structure', sections: [] } as unknown as ParsedCanvasPage
    const view = resolveRouteView('/page/guide-structure', NO_PARAMS, makeDeps({ canvasPage }))
    expect(view.page).toBe('canvas')
    expect(view.shell.wrap).toBe('canvas')
  })

  it('classifies /page/:slug non-canvas pages as the named-page listing', () => {
    const view = resolveRouteView('/page/my-custom-note', NO_PARAMS, makeDeps({ canvasPage: null }))
    expect(view.page).toBe('note')
    expect(view.isNoteRoute).toBe(false)
    expect(view.note).toBeUndefined()
    expect(view.namedPageSlug).toBe('my-custom-note')
  })

  it('does not resolve retired page/note spellings', () => {
    expect(resolveRouteView('/p/my-custom-note', NO_PARAMS, makeDeps({ canvasPage: null })).namedPageSlug).toBeUndefined()
    expect(resolveRouteView(`/note/${UUID}/extra`, NO_PARAMS, makeDeps()).isNoteRoute).toBe(false)
  })
})
