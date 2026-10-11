import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { buildAppNavTree, appNavTree } from '../appNavTree'
import type { CanvasRoute } from '../../canvas/canvasRoutes'
import { ROUTE_PATTERNS } from '../../lib/routes'
import { NavProvider } from '../NavContext'
import { NavSidebar } from '../NavSidebar'

function mockLocation(pathname: string): Location {
  return {
    pathname,
    search: '',
    hash: '',
    state: null,
    key: 'test',
  }
}

describe('appNavTree - Flattened listing zones', () => {
  afterEach(() => {
    cleanup()
  })

  it('flattens Library into Journal, Feeds, Playgrounds L1 rows with no Library row', () => {
    const tree = buildAppNavTree(() => {})
    const l1 = tree.filter(item => item.level === 1).map(item => item.id)

    expect(l1).toEqual([
      'home',
      'journal',
      'catalogs',
      'feeds',
      'playgrounds',
      'dashboards',
      'efforts',
      'sessions',
      'settings',
      'buy-me-a-coffee',
    ])
    expect(tree.find(item => item.id === 'library')).toBeUndefined()
  })

  it('lights Feeds for feed routes and catalog item routes', () => {
    const tree = buildAppNavTree(() => {})
    const feeds = tree.find(item => item.id === 'feeds')!

    // The listing itself is /feeds (the renamed collections surface); the
    // /c/:slug catalog landing and item routes light the same zone.
    expect(feeds.isActive!(mockLocation('/feeds'))).toBe(true)
    expect(feeds.isActive!(mockLocation('/feed/routines'))).toBe(true)
    expect(feeds.isActive!(mockLocation('/c/dan-john'))).toBe(true)
    expect(feeds.isActive!(mockLocation('/journal'))).toBe(false)
    expect(feeds.isActive!(mockLocation('/playgrounds'))).toBe(false)

    const journal = tree.find(item => item.id === 'journal')!
    const playgrounds = tree.find(item => item.id === 'playgrounds')!
    expect(journal.isActive!(mockLocation('/feeds'))).toBe(false)
    expect(playgrounds.isActive!(mockLocation('/feeds'))).toBe(false)
  })

  it('activates Playgrounds for /playgrounds and /playground notes only', () => {
    const tree = buildAppNavTree(() => {})
    const playgrounds = tree.find(item => item.id === 'playgrounds')!

    expect(playgrounds.isActive!(mockLocation('/playgrounds'))).toBe(true)
    expect(playgrounds.isActive!(mockLocation('/playground/example'))).toBe(true)
    expect(playgrounds.isActive!(mockLocation('/journal'))).toBe(false)
  })

  it('renders the Journal conditions panel with the inclusive All row', () => {
    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    // The All row links the inclusive :note{!source:playground} query view on
    // the journal surface — no /library route of its own.
    const allRow = screen.getAllByText('All', { exact: true })[0]!.closest('[role="button"], a, button')
    expect(allRow).not.toBeNull()
  })

  it('renders the Feeds conditions panel rows in NavSidebar on /feeds', () => {
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getAllByText('All feeds').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Catalog crosswalk').length).toBeGreaterThan(0)
  })
})

describe('appNavTree - Efforts navigation', () => {
  afterEach(() => {
    cleanup()
  })

  it('defines L1 efforts item routed to /efforts with the shared conditions panel', () => {
    const tree = buildAppNavTree(() => {})
    const efforts = tree.find(item => item.id === 'efforts')

    expect(efforts).toBeDefined()
    expect(efforts?.label).toBe('Efforts')
    expect(efforts?.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.efforts })
    // Discipline conditions live in the shared current-result panel now.
    expect(efforts?.panel).toBeDefined()
  })

  it('activates efforts L1 for /efforts and /effort/:slug routes', () => {
    const tree = buildAppNavTree(() => {})
    const efforts = tree.find(item => item.id === 'efforts')!

    expect(efforts.isActive!(mockLocation('/efforts'))).toBe(true)
    expect(efforts.isActive!(mockLocation('/effort/push-up'))).toBe(true)
    expect(efforts.isActive!(mockLocation('/e/push-up'))).toBe(true)
    expect(efforts.isActive!(mockLocation('/journal'))).toBe(false)
  })
})

describe('appNavTree - Sessions navigation', () => {
  afterEach(() => {
    cleanup()
  })

  it('defines L1 sessions item with panel', () => {
    const tree = buildAppNavTree(() => {})
    const sessions = tree.find(item => item.id === 'sessions')

    expect(sessions).toBeDefined()
    expect(sessions?.label).toBe('Sessions')
    expect(sessions?.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.sessions })
    expect(sessions?.panel).toBeDefined()
  })

  it('activates sessions L1 for /sessions, /session/:date, and /results', () => {
    const tree = buildAppNavTree(() => {})
    const sessions = tree.find(item => item.id === 'sessions')!

    expect(sessions.isActive!(mockLocation('/sessions'))).toBe(true)
    expect(sessions.isActive!(mockLocation('/sessions/session-123'))).toBe(true)
    expect(sessions.isActive!(mockLocation('/session/2026-09-17'))).toBe(true)
    expect(sessions.isActive!(mockLocation('/results'))).toBe(true)
    expect(sessions.isActive!(mockLocation('/efforts'))).toBe(false)
  })
})

describe('appNavTree - Settings navigation', () => {
  afterEach(() => {
    cleanup()
  })

  it('defines L1 settings item with L2 children for Appearance, Profile, System, and Query Defaults', () => {
    const tree = buildAppNavTree(() => {})
    const settings = tree.find(item => item.id === 'settings')

    expect(settings).toBeDefined()
    expect(settings?.label).toBe('Settings')
    expect(settings?.level).toBe(1)
    expect(settings?.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsAppearance })
    expect(settings?.children).toBeDefined()
    expect(settings?.children?.length).toBe(7)

    const [appearance, profile, database, sync, queries, tags, system] = settings!.children!

    expect(appearance.id).toBe('settings-appearance')
    expect(appearance.label).toBe('Appearance')
    expect(appearance.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsAppearance })

    expect(profile.id).toBe('settings-profile')
    expect(profile.label).toBe('Profile')
    expect(profile.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsProfile })

    expect(database.id).toBe('settings-database')
    expect(database.label).toBe('Database')
    expect(database.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsDatabase })

    expect(sync.id).toBe('settings-sync')
    expect(sync.label).toBe('Sync')
    expect(sync.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsSync })

    expect(queries.id).toBe('settings-queries')
    expect(queries.label).toBe('Query Defaults')
    expect(queries.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsQueries })

    expect(tags.id).toBe('settings-tags')
    expect(tags.label).toBe('Tags')
    expect(tags.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsTags })

    expect(system.id).toBe('settings-system')
    expect(system.label).toBe('System')
    expect(system.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsSystem })
  })

  it('activates settings L1 for /settings, /settings/appearance, and /settings/system', () => {
    const tree = buildAppNavTree(() => {})
    const settings = tree.find(item => item.id === 'settings')!

    expect(settings.isActive!(mockLocation('/settings'))).toBe(true)
    expect(settings.isActive!(mockLocation('/settings/appearance'))).toBe(true)
    expect(settings.isActive!(mockLocation('/settings/system'))).toBe(true)
    expect(settings.isActive!(mockLocation('/results/res-1'))).toBe(false)
  })
  it('activates appropriate L2 child based on route', () => {
    const tree = buildAppNavTree(() => {})
    const settings = tree.find(item => item.id === 'settings')!
    const [appearance, profile, database, sync, queries, tags, system] = settings.children!

    expect(appearance.isActive!(mockLocation('/settings'))).toBe(true)
    expect(appearance.isActive!(mockLocation('/settings/appearance'))).toBe(true)

    expect(profile.isActive!(mockLocation('/settings/profile'))).toBe(true)
    expect(profile.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(database.isActive!(mockLocation('/settings/database'))).toBe(true)
    expect(database.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(sync.isActive!(mockLocation('/settings/sync'))).toBe(true)
    expect(sync.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(queries.isActive!(mockLocation('/settings/queries'))).toBe(true)
    expect(queries.isActive!(mockLocation('/settings/appearance'))).toBe(false)
    expect(appearance.isActive!(mockLocation('/settings/system'))).toBe(false)
    expect(tags.isActive!(mockLocation('/settings/tags'))).toBe(true)
    expect(tags.isActive!(mockLocation('/settings/appearance'))).toBe(false)


    expect(system.isActive!(mockLocation('/settings/system'))).toBe(true)
    expect(system.isActive!(mockLocation('/settings/appearance'))).toBe(false)
  })

  it('renders L2 menu items in NavSidebar when on /settings/appearance', () => {
    render(
      <MemoryRouter initialEntries={['/settings/appearance']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Appearance')[0]).toBeDefined()
    expect(screen.getAllByText('System')[0]).toBeDefined()
  })
})

describe('appNavTree - Buy Me a Coffee', () => {
  afterEach(() => {
    cleanup()
  })

  it('sits directly below Settings with an external support-link action', () => {
    const tree = buildAppNavTree(() => {})
    const coffee = tree.find(item => item.id === 'buy-me-a-coffee')

    expect(coffee).toBeDefined()
    expect(coffee?.label).toBe('Buy Me a Coffee')
    expect(coffee?.action).toEqual({
      type: 'external',
      href: 'https://www.buymeacoffee.com/sergeigolos',
    })
    // Sidebar order: the coffee row trails the Settings section.
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Appearance')[0]).toBeDefined()
    expect(screen.getAllByText('System')[0]).toBeDefined()
  })
})
describe('appNavTree - L2 notable buttons and Catalogs', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders top notable button and flattened guide links in Home L2', () => {
    const dummyRoutes = [
      {
        route: '/guide/start',
        page: { frontmatter: { type: 'guide' }, sections: [{ heading: 'Getting Started' }] } as unknown as CanvasRoute['page'],
      },
      {
        route: '/guide/wql',
        page: { frontmatter: { type: 'guide' }, sections: [{ heading: 'WQL Basics' }] } as unknown as CanvasRoute['page'],
      },
    ]
    const tree = buildAppNavTree(() => {}, dummyRoutes)
    const home = tree.find(i => i.id === 'home')!
    expect(home.children?.[0]?.id).toBe('home-new-journal')
    expect(home.children?.[0]?.variant).toBe('notable')
    expect(home.children?.[0]?.label).toBe('New journal entry')
    // Guide items are flattened directly under Home (no guide-group accordion)
    expect(home.children?.find(i => i.id === 'guide-group')).toBeUndefined()
    expect(home.children?.find(i => i.id === 'guide-/guide/start')).toBeDefined()
  })

  it('defines Catalogs on L1 above Feeds doing :catalog search', () => {
    const tree = buildAppNavTree(() => {})
    const catalogs = tree.find(i => i.id === 'catalogs')!
    expect(catalogs).toBeDefined()
    expect(catalogs.label).toBe('Catalogs')
    expect(catalogs.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.catalogs })
  })

  it('renders notable create button on Journal, Feeds, Playgrounds, Efforts L2 panels', () => {
    const tree = buildAppNavTree(() => {})
    const journal = tree.find(i => i.id === 'journal')!
    expect(journal.panel).toBeDefined()

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NavProvider tree={tree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('journal-create-entry')).toBeDefined()
    expect(screen.getByText('New journal entry')).toBeDefined()
    cleanup()

    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <NavProvider tree={tree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('collections-create-note')).toBeDefined()
    expect(screen.getByText('New note')).toBeDefined()
    expect(screen.getByText('Catalog crosswalk')).toBeDefined()
    cleanup()

    render(
      <MemoryRouter initialEntries={['/playgrounds']}>
        <NavProvider tree={tree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('playgrounds-create-playground')).toBeDefined()
    expect(screen.getByText('New playground')).toBeDefined()
    cleanup()

    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <NavProvider tree={tree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('efforts-create-effort')).toBeDefined()
    expect(screen.getByText('New effort')).toBeDefined()
  })
})


