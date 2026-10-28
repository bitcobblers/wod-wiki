import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { buildAppNavTree, appNavTree } from '../appNavTree'
import type { CanvasRoute } from '../../canvas/canvasRoutes'
import { ROUTE_PATTERNS } from '../../lib/routes'
import { resetRouteShortcuts, writeRouteShortcuts } from '../../lib/routeWqlShortcuts'
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

  it('derives L1 zones: Notebooks, Journal, Pages, Dashboards, Settings — notes, sessions, efforts, equipment, tags, feeds removed from L1', () => {
    const tree = buildAppNavTree(() => {})
    const l1 = tree.filter(item => item.level === 1).map(item => item.id)

    expect(l1).toEqual([
      'home',
      'notebooks',
      'journal',
      'pages',
      'dashboards',
      'settings',
      'buy-me-a-coffee',
    ])
    // Rolled up into Pages L2 or Settings; removed from L1 rail:
    expect(tree.find(item => item.id === 'notes')).toBeUndefined()
    expect(tree.find(item => item.id === 'feeds')).toBeUndefined()
    expect(tree.find(item => item.id === 'efforts')).toBeUndefined()
    expect(tree.find(item => item.id === 'equipment')).toBeUndefined()
    expect(tree.find(item => item.id === 'sessions')).toBeUndefined()
    expect(tree.find(item => item.id === 'tags')).toBeUndefined()
  })

  it('derives L1 labels for the core domains', () => {
    const tree = buildAppNavTree(() => {})
    for (const [id, route, label] of [
      ['notebooks', ROUTE_PATTERNS.notebooks, 'Notebooks'],
      ['journal', ROUTE_PATTERNS.journal, 'Journal'],
      ['pages', ROUTE_PATTERNS.pages, 'Pages'],
      ['dashboards', ROUTE_PATTERNS.dashboards, 'Dashboards'],
    ] as const) {
      const zone = tree.find(item => item.id === id)!
      expect(zone).toBeDefined()
      expect(zone.label).toBe(label)
      expect(zone.action).toEqual({ type: 'route', to: route })
    }
  })
  it('lights Notebooks for notebooks and playgrounds routes', () => {
    const tree = buildAppNavTree(() => {})
    const notebooks = tree.find(item => item.id === 'notebooks')!

    expect(notebooks.isActive!(mockLocation('/notebooks'))).toBe(true)
    expect(notebooks.isActive!(mockLocation('/notebook/dan-john'))).toBe(true)
    expect(notebooks.isActive!(mockLocation('/playgrounds'))).toBe(true)
    expect(notebooks.isActive!(mockLocation('/playground/example'))).toBe(true)
    // Journal has its own L1 zone now
    expect(notebooks.isActive!(mockLocation('/journal'))).toBe(false)
    expect(notebooks.isActive!(mockLocation('/feeds'))).toBe(false)
    expect(notebooks.isActive!(mockLocation('/notes'))).toBe(false)
  })

  it('lights Journal for journal and day routes', () => {
    const tree = buildAppNavTree(() => {})
    const journal = tree.find(item => item.id === 'journal')!

    expect(journal.isActive!(mockLocation('/journal'))).toBe(true)
    expect(journal.isActive!(mockLocation('/day/2026-10-26'))).toBe(true)
    expect(journal.isActive!(mockLocation('/notebooks'))).toBe(false)
    expect(journal.isActive!(mockLocation('/pages'))).toBe(false)
  })

  it('lights Pages for pages and all rolled-up entity routes (notes, sessions, efforts, equipment, tags)', () => {
    const tree = buildAppNavTree(() => {})
    const pages = tree.find(item => item.id === 'pages')!

    expect(pages.isActive!(mockLocation('/pages'))).toBe(true)
    expect(pages.isActive!(mockLocation('/page/guide-start'))).toBe(true)
    expect(pages.isActive!(mockLocation('/notes'))).toBe(true)
    expect(pages.isActive!(mockLocation('/note/123'))).toBe(true)
    expect(pages.isActive!(mockLocation('/sessions'))).toBe(true)
    expect(pages.isActive!(mockLocation('/efforts'))).toBe(true)
    expect(pages.isActive!(mockLocation('/equipment'))).toBe(true)
    expect(pages.isActive!(mockLocation('/tags'))).toBe(true)
    expect(pages.isActive!(mockLocation('/journal'))).toBe(false)
    expect(pages.isActive!(mockLocation('/notebooks'))).toBe(false)
  })
})


describe('appNavTree - Notebooks zone views (Journal / Playgrounds)', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the journal view panel on /journal — create action, view rows, inclusive All row', () => {
    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )
    expect(screen.getAllByText('Journal').length).toBeGreaterThan(0)

    // Journal view chrome survives the zone fold: its create action and landing.
    expect(screen.getByTestId('journal-create-entry')).toBeDefined()
    expect(screen.getByText('New journal entry')).toBeDefined()
    expect(screen.getByText('All entries')).toBeDefined()

    // All entries landing row renders
    expect(screen.getByText('All entries')).toBeDefined()

    // The All row links the inclusive :note{!source:playground} query view on
    // the journal surface — no route of its own.
    const allRow = screen.getAllByText('All', { exact: true })[0]!.closest('[role="button"], a, button')
    expect(allRow).not.toBeNull()
  })

  it('renders the notebooks landing panel on /notebooks without the journal create action', () => {
    render(
      <MemoryRouter initialEntries={['/notebooks']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText('Subscribed notebooks')).toBeDefined()
    expect(screen.queryByTestId('journal-create-entry')).toBeNull()
    expect(screen.queryByTestId('playgrounds-create-playground')).toBeNull()
    // The view rows still offer the switch.
    expect(screen.getByText('Configure sources')).toBeDefined()
    expect(screen.getByText('Playgrounds')).toBeDefined()
  })

  it('renders the playgrounds view panel on /playgrounds with its create action', () => {
    render(
      <MemoryRouter initialEntries={['/playgrounds']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('playgrounds-create-playground')).toBeDefined()
    expect(screen.getByText('New playground')).toBeDefined()
    expect(screen.getByText('All playgrounds')).toBeDefined()
  })

  it('binds each view panel to its own canonical route storage — saved shortcuts survive the zone fold', async () => {
    // A user who customized the journal landing link under /journal keeps it
    // even though Journal is no longer an L1 zone: the view panel resolves
    // the /journal shortcut key, not the notebooks one.
    await writeRouteShortcuts(ROUTE_PATTERNS.journal, [
      { id: 'all', label: 'Everything', icon: 'calendar', wql: '' },
    ])
    try {
      render(
        <MemoryRouter initialEntries={['/journal']}>
          <NavProvider tree={appNavTree}>
            <NavSidebar />
          </NavProvider>
        </MemoryRouter>,
      )
      expect(screen.getByText('Everything')).toBeDefined()
      expect(screen.queryByText('All entries')).toBeNull()
    } finally {
      await resetRouteShortcuts(ROUTE_PATTERNS.journal)
    }
  })
})

describe('appNavTree - Pages L2 roll-up navigation', () => {
  afterEach(() => {
    cleanup()
  })

  it('defines L1 Pages item routed to /pages with the PagesZonePanel', () => {
    const tree = buildAppNavTree(() => {})
    const pages = tree.find(item => item.id === 'pages')

    expect(pages).toBeDefined()
    expect(pages?.label).toBe('Pages')
    expect(pages?.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.pages })
    expect(pages?.panel).toBeDefined()
  })

  it('renders Pages L2 panel with lateral variations (Notes, Sessions, Efforts, Equipment, Tags) on /pages', () => {
    render(
      <MemoryRouter initialEntries={['/pages']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getAllByText('All pages').length).toBeGreaterThan(0)
    expect(screen.getByText('Notes')).toBeDefined()
    expect(screen.getByText('Sessions')).toBeDefined()
    expect(screen.getByText('Efforts')).toBeDefined()
    expect(screen.getByText('Equipment')).toBeDefined()
    expect(screen.getByText('Tags')).toBeDefined()
  })

  it('renders Sessions conditions panel with Pages lateral variations on /sessions', () => {
    render(
      <MemoryRouter initialEntries={['/sessions']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getAllByText('All Sessions').length).toBeGreaterThan(0)
    expect(screen.getByText('Notes')).toBeDefined()
    expect(screen.getByText('Efforts')).toBeDefined()
  })

  it('renders Efforts conditions panel with Pages lateral variations on /efforts', () => {
    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <NavProvider tree={appNavTree}>
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    )

    expect(screen.getAllByText('All Efforts').length).toBeGreaterThan(0)
    expect(screen.getByText('Notes')).toBeDefined()
    expect(screen.getByText('Sessions')).toBeDefined()
  })
})
describe('appNavTree - Settings navigation', () => {
  afterEach(() => {
    cleanup()
  })

  it('defines L1 settings item with L2 children in menu order: Profile, Appearance, Tags, Sound Profiles, Sync, Storage, System', () => {
    const tree = buildAppNavTree(() => {})
    const settings = tree.find(item => item.id === 'settings')

    expect(settings).toBeDefined()
    expect(settings?.label).toBe('Settings')
    expect(settings?.level).toBe(1)
    expect(settings?.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsAppearance })
    expect(settings?.children).toBeDefined()
    expect(settings?.children?.length).toBe(8)

    const [profile, feeds, appearance, tags, soundProfiles, sync, storage, system] = settings!.children!
    expect(feeds.id).toBe('settings-feeds')
    expect(feeds.label).toBe('Feeds & Sources')
    expect(feeds.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.feeds })

    expect(appearance.id).toBe('settings-appearance')
    expect(appearance.label).toBe('Appearance')
    expect(appearance.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsAppearance })

    expect(profile.id).toBe('settings-profile')
    expect(profile.label).toBe('Profile')
    expect(profile.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsProfile })

    expect(storage.id).toBe('settings-storage')
    expect(storage.label).toBe('Storage')
    expect(storage.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsStorage })

    expect(sync.id).toBe('settings-sync')
    expect(sync.label).toBe('Sync')
    expect(sync.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsSync })

    expect(tags.id).toBe('settings-tags')
    expect(tags.label).toBe('Tag Types')
    expect(tags.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsTags })

    expect(soundProfiles.id).toBe('settings-sound-profiles')
    expect(soundProfiles.label).toBe('Sound Profiles')
    expect(soundProfiles.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.settingsSoundProfiles })

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
    const [profile, feeds, appearance, tags, soundProfiles, sync, storage, system] = settings.children!

    expect(appearance.isActive!(mockLocation('/settings'))).toBe(true)
    expect(appearance.isActive!(mockLocation('/settings/appearance'))).toBe(true)

    expect(profile.isActive!(mockLocation('/settings/profile'))).toBe(true)
    expect(profile.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(storage.isActive!(mockLocation('/settings/storage'))).toBe(true)
    expect(storage.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(sync.isActive!(mockLocation('/settings/sync'))).toBe(true)
    expect(sync.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(appearance.isActive!(mockLocation('/settings/system'))).toBe(false)
    expect(tags.isActive!(mockLocation('/settings/tags'))).toBe(true)
    expect(tags.isActive!(mockLocation('/settings/appearance'))).toBe(false)

    expect(soundProfiles.isActive!(mockLocation('/settings/sound-profiles'))).toBe(true)
    expect(soundProfiles.isActive!(mockLocation('/settings/appearance'))).toBe(false)


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
        route: '/page/guide-start',
        page: { frontmatter: { type: 'guide' }, sections: [{ heading: 'Getting Started' }] } as unknown as CanvasRoute['page'],
      },
      {
        route: '/page/guide-wql',
        page: { frontmatter: { type: 'guide' }, sections: [{ heading: 'WQL Basics' }] } as unknown as CanvasRoute['page'],
      },
    ]
    const tree = buildAppNavTree(() => {}, dummyRoutes)
    const home = tree.find(i => i.id === 'home')!
    expect(home.children?.[0]?.id).toBe('home-landing')
    expect(home.children?.[0]?.label).toBe('Home')
    expect(home.children?.[1]?.id).toBe('home-all-pages')
    expect(home.children?.[1]?.label).toBe('All pages')
    expect(home.children?.[2]?.id).toBe('home-new-journal')
    expect(home.children?.[2]?.variant).toBe('notable')
    expect(home.children?.[2]?.label).toBe('New journal entry')
    // Guide items are flattened directly under Home (no guide-group accordion)
    expect(home.children?.find(i => i.id === 'guide-group')).toBeUndefined()
    expect(home.children?.find(i => i.id === 'guide-/page/guide-start')).toBeDefined()
  })

  it('defines Notebooks on L1 above Notes routed to /notebooks', () => {
    const tree = buildAppNavTree(() => {})
    const notebooks = tree.find(i => i.id === 'notebooks')!
    expect(notebooks).toBeDefined()
    expect(notebooks.label).toBe('Notebooks')
    expect(notebooks.action).toEqual({ type: 'route', to: ROUTE_PATTERNS.notebooks })
  })

  it('renders the create actions on the notebooks-zone views and the Efforts panel', () => {
    const tree = buildAppNavTree(() => {})

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


