/**
 * appNavTree — the authoritative L1 + L2 navigation tree for the app.
 *
 * L3 (page-index / scroll anchors) is injected dynamically by each route
 * component via useSetNavL3() or AppContent's setL3Items() call.
 *
 * Structure:
 *   L1: Home, Notebooks, Notes, Feeds, Pages, Dashboards, Efforts,
 *       Equipment, Sessions, Tags, Settings
 *   L2 of Home:        the consolidated Guide chapters (markdown/canvas/guide/**;
 *                      the old syntax/behaviors/analytics pillars are folded in)
 *   L2 of the list routes (Notebooks/Notes/Feeds/Pages/Efforts/Equipment/
 *                      Sessions): the shared ConditionsNavPanel — the
 *                      current-result `{}` condition accordion plus grouping
 *                      presets over the CURRENT query
 *   L2 of Notebooks:   the notebook family — the Journal and Playgrounds
 *                      VIEWS live inside this zone (they are not concepts of
 *                      their own), each rendered by its own route-keyed
 *                      ConditionsNavPanel so saved per-route config binds
 *                      to the view's canonical route
 *   L2 of Dashboards:  dynamic panel (vault/runtime data)
 *   Search has moved out of the L1 sidebar and into the top app-bar.
 *
 * Derivation contract: every library L1 zone IS a canonical list route —
 * the zone id and label are derived from the route path ("/notebooks" →
 * id "notebooks", label "Notebooks"), never hand-written, so the sidebar
 * cannot disagree with the URL.
 *
 * The canvas-guide children derive from the seeded canvas routes passed by
 * the caller (App.tsx hydrates them from IndexedDB); tests/storybook use the
 * static `appNavTree` export, which carries no canvas children.
 */

import { HomeIcon, CodeBracketIcon } from '@heroicons/react/20/solid'
import { ChartBarIcon, Dumbbell, Rss, Settings, Paintbrush, Sliders, ClipboardList, File, Tag, Library, CalendarPlus, UserRound, Database, CloudDownload, Wrench, Volume2, Calendar } from 'lucide-react'
import type { NavItem } from './navTypes'
import type { Location } from 'react-router-dom'
import { NOTES_STREAM_PROFILE, FEEDS_STREAM_PROFILE, PAGES_STREAM_PROFILE, EFFORTS_STREAM_PROFILE, EQUIPMENT_STREAM_PROFILE, SESSIONS_STREAM_PROFILE, TAGS_STREAM_PROFILE, type StreamProfile } from '../views/stream/streamProfile'
import { ROUTE_PATTERNS, isEffortsPath, isEquipmentPath } from '../lib/routes'

import { DashboardsNavPanel } from './panels/DashboardsNavPanel'
import { NotebookZonePanel, JournalViewConditionsPanel } from './panels/NotebookZonePanel'
import { createPagesZonePanel } from './panels/PagesZonePanel'
import { createConditionsNavPanel, type ConditionsPanelSpec } from './panels/ConditionsNavPanel'
import type { CanvasRoute } from '../canvas/canvasRoutes'
import { isGuidePinned, setGuidePinned } from '../lib/pinnedGuidesStorage'

import { BUY_ME_A_COFFEE_URL, BuyMeACoffeeIcon } from '../components/atoms/BuyMeACoffee'

// ─── L2 children for Home ─────────────────────────────────────────────────────

// Sidebar order for the consolidated learning guide (one pillar, eight
// chapters — markdown/canvas/guide/**; the old syntax/behaviors/analytics
// pillars were folded into these eight routes).
const guideOrder: Record<string, number> = {
  '/page/guide-start': 0,
  '/page/guide-protocols': 1,
  '/page/guide-structure': 2,
  '/page/guide-metrics': 3,
  '/page/guide-clock': 4,
  '/page/guide-wql': 5,
  '/page/guide-dashboards': 6,
  '/page/guide-sessions': 7,
  '/page/guide-metrics-summaries': 8,
}

/** Guide chapters as NavItems — the Home L2 list and the end-of-page
 * GuideIndexFooter both render this, so the two stay in sync. */
export function guideChildrenFrom(routes: CanvasRoute[]): NavItem[] {
  return routes
    .filter(r => !r.route.startsWith('/notebook'))
    .filter(r => r.page.frontmatter?.type === 'guide')
    .filter(r => isGuidePinned(r.route))
    .sort((a, b) => (guideOrder[a.route] ?? 99) - (guideOrder[b.route] ?? 99))
    .map(r => ({
      id: `guide-${r.route}`,
      label: r.page.sections[0]?.heading ?? 'Untitled',
      level: 2 as const,
      icon: CodeBracketIcon,
      action: { type: 'route' as const, to: r.route },
      isActive: (loc: Location) => loc.pathname === r.route,
      pinned: true,
      onTogglePin: () => {
        setGuidePinned(r.route, false)
      },
    }))
}

function buildHomeChildren(routes: CanvasRoute[]): NavItem[] {
  return [
    {
      id: 'home-landing',
      label: 'Home',
      level: 2,
      icon: HomeIcon,
      action: { type: 'route', to: ROUTE_PATTERNS.home },
      isActive: (loc: Location) =>
        loc.pathname === '/' || loc.pathname === '' || loc.pathname === ROUTE_PATTERNS.home,
    },
    {
      id: 'home-all-pages',
      label: 'All pages',
      level: 2,
      icon: File,
      action: { type: 'route', to: ROUTE_PATTERNS.pages },
      isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.pages,
    },
    {
      id: 'home-new-journal',
      label: 'New journal entry',
      level: 2,
      icon: CalendarPlus,
      variant: 'notable',
      action: { type: 'route', to: '/journal?create=1' },
      isActive: () => false,
    },
    ...guideChildrenFrom(routes),
  ]
}

// ─── Listing zones (flattened Library) ────────────────────────────────────────

/**
 * The library concepts are top-level L1 rows — one zone per canonical list
 * route. The zone id and label are DERIVED from the route path (the label
 * is the route's name), so the sidebar cannot disagree with the URL.
 * Every zone's L2 is the shared ConditionsNavPanel; there are no static
 * preset children to keep in sync.
 */
interface ListingZoneSpec {
  landingLabel: string
  icon: NavItem['icon']
  route: string
  profile: StreamProfile
  /** Extra panel rows appended after the presets (e.g. the notebook views). */
  extraChildren?: NavItem[]
  /** Whole zone route family (L1 activation). */
  familyActive: (loc: Location) => boolean
  createAction?: ConditionsPanelSpec['createAction']
}

/** "/notebooks" → "notebooks" — the zone id is the route's bare name. */
const listRouteId = (route: string): string => route.replace(/^\//, '').replace(/\/$/, '')

/** "/notebooks" → "Notebooks" — the L1 label IS the list route's name. */
const listRouteLabel = (route: string): string => {
  const id = listRouteId(route)
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** Route-family test shared by the zone specs and the notebooks-zone panels. */
export const startsWithAny = (pathname: string, ...prefixes: string[]): boolean =>
  prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

function listingZone(spec: ListingZoneSpec): NavItem {
  return {
    id: listRouteId(spec.route),
    label: listRouteLabel(spec.route),
    level: 1,
    icon: spec.icon,
    action: { type: 'route', to: spec.route },
    isActive: (loc: Location) => spec.familyActive(loc),
    applyFooter: true,
    panel: createConditionsNavPanel({
      landingLabel: spec.landingLabel,
      icon: spec.icon,
      route: spec.route,
      profile: spec.profile,
      extraChildren: spec.extraChildren,
      familyActive: spec.familyActive,
      createAction: spec.createAction,
    }),
  }
}


// ─── App nav tree ─────────────────────────────────────────────────────────────

/**
 * @param _openSearch - retained for the global keyboard shortcut (Ctrl+/)
 *   but Search is no longer an L1 sidebar item — it lives in the top app-bar.
 * @param canvasRoutes - the seeded canvas route table (hydrated from
 *   IndexedDB); the guide children derive from it.
 */
export function buildAppNavTree(_openSearch: () => void, canvasRoutes: CanvasRoute[] = []): NavItem[] {
  const homeChildren = buildHomeChildren(canvasRoutes)
  const pagesPanel = createPagesZonePanel(canvasRoutes)
  return [
    {
      id: 'home',
      label: 'Home',
      level: 1,
      icon: HomeIcon,
      action: { type: 'route', to: ROUTE_PATTERNS.home },
      isActive: (loc) =>
        loc.pathname === '/' ||
        loc.pathname === '' ||
        loc.pathname === ROUTE_PATTERNS.home ||
        loc.pathname === ROUTE_PATTERNS.aiFirst ||
        loc.pathname.startsWith('/ai-first/'),
      children: homeChildren,
    },

    {
      id: listRouteId(ROUTE_PATTERNS.notebooks),
      label: listRouteLabel(ROUTE_PATTERNS.notebooks),
      level: 1,
      icon: Library,
      action: { type: 'route', to: ROUTE_PATTERNS.notebooks },
      isActive: (loc: Location) =>
        startsWithAny(loc.pathname, '/notebooks', '/notebook', '/playgrounds', '/playground'),
      applyFooter: true,
      panel: NotebookZonePanel,
    },

    {
      id: listRouteId(ROUTE_PATTERNS.journal),
      label: listRouteLabel(ROUTE_PATTERNS.journal),
      level: 1,
      icon: Calendar,
      action: { type: 'route', to: ROUTE_PATTERNS.journal },
      isActive: (loc: Location) => startsWithAny(loc.pathname, '/journal', '/day'),
      applyFooter: true,
      panel: JournalViewConditionsPanel,
    },

    {
      id: listRouteId(ROUTE_PATTERNS.pages),
      label: listRouteLabel(ROUTE_PATTERNS.pages),
      level: 1,
      icon: File,
      action: { type: 'route', to: ROUTE_PATTERNS.pages },
      isActive: (loc: Location) =>
        startsWithAny(
          loc.pathname,
          '/pages',
          '/page',
          '/canvas',
          '/notes',
          '/note',
          '/sessions',
          '/session',
          '/results',
          '/efforts',
          '/effort',
          '/e',
          '/equipment',
          '/tags',
          '/t',
        ),
      applyFooter: true,
      panel: pagesPanel,
    },

    {
      id: listRouteId(ROUTE_PATTERNS.dashboards),
      label: listRouteLabel(ROUTE_PATTERNS.dashboards),
      level: 1,
      icon: ChartBarIcon,
      action: { type: 'route', to: ROUTE_PATTERNS.dashboards },
      isActive: (loc: Location) =>
        loc.pathname === ROUTE_PATTERNS.dashboards || loc.pathname.startsWith('/dashboard/'),
      panel: DashboardsNavPanel,
    },
    {
      id: 'settings',
      label: 'Settings',
      level: 1,
      icon: Settings,
      action: { type: 'route', to: ROUTE_PATTERNS.settingsAppearance },
      isActive: (loc: Location) => startsWithAny(loc.pathname, '/settings', '/feeds', '/feed'),
      children: [
        {
          id: 'settings-profile',
          label: 'Profile',
          level: 2,
          icon: UserRound,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsProfile },
          isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.settingsProfile,
        },
        {
          id: 'settings-feeds',
          label: 'Feeds & Sources',
          level: 2,
          icon: Rss,
          action: { type: 'route', to: ROUTE_PATTERNS.feeds },
          isActive: (loc: Location) => startsWithAny(loc.pathname, '/feeds', '/feed'),
        },
        {
          id: 'settings-appearance',
          label: 'Appearance',
          level: 2,
          icon: Paintbrush,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsAppearance },
          isActive: (loc: Location) =>
            loc.pathname === ROUTE_PATTERNS.settings ||
            loc.pathname === ROUTE_PATTERNS.settingsAppearance,
        },
        {
          id: 'settings-tags',
          label: 'Tag Types',
          level: 2,
          icon: Tag,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsTags },
          isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.settingsTags,
        },
        {
          id: 'settings-sound-profiles',
          label: 'Sound Profiles',
          level: 2,
          icon: Volume2,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsSoundProfiles },
          isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.settingsSoundProfiles,
        },
        {
          id: 'settings-sync',
          label: 'Sync',
          level: 2,
          icon: CloudDownload,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsSync },
          isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.settingsSync,
        },
        {
          id: 'settings-storage',
          label: 'Storage',
          level: 2,
          icon: Database,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsStorage },
          isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.settingsStorage,
        },
        {
          id: 'settings-system',
          label: 'System',
          level: 2,
          icon: Sliders,
          action: { type: 'route', to: ROUTE_PATTERNS.settingsSystem },
          isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.settingsSystem,
        },
      ],
    },
    // Support link — external action (new tab); rendered as the trailing icon
    // button on the L1 rail (AppRail excludes it from the L1 loop).
    {
      id: 'buy-me-a-coffee',
      label: 'Buy Me a Coffee',
      level: 1,
      icon: BuyMeACoffeeIcon,
      action: { type: 'external', href: BUY_ME_A_COFFEE_URL },
    },
  ]
}

/** Static default tree (no search handler, no canvas children) — kept for tests / storybook. */
export const appNavTree: NavItem[] = buildAppNavTree(() => {})
