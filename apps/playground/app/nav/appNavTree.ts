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
import { ChartBarIcon, Dumbbell, Rss, Settings, Paintbrush, Sliders, ClipboardList, File, Tag, Library, CalendarPlus, UserRound, Database, CloudDownload, Wrench, Volume2 } from 'lucide-react'
import type { NavItem } from './navTypes'
import type { Location } from 'react-router-dom'
import { NOTES_STREAM_PROFILE, FEEDS_STREAM_PROFILE, PAGES_STREAM_PROFILE, EFFORTS_STREAM_PROFILE, EQUIPMENT_STREAM_PROFILE, SESSIONS_STREAM_PROFILE, TAGS_STREAM_PROFILE, type StreamProfile } from '../views/stream/streamProfile'
import { ROUTE_PATTERNS, isEffortsPath, isEquipmentPath } from '../lib/routes'

import { DashboardsNavPanel } from './panels/DashboardsNavPanel'
import { NotebookZonePanel } from './panels/NotebookZonePanel'
import { createConditionsNavPanel, type ConditionsPanelSpec } from './panels/ConditionsNavPanel'
import type { CanvasRoute } from '../canvas/canvasRoutes'

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
    .sort((a, b) => (guideOrder[a.route] ?? 99) - (guideOrder[b.route] ?? 99))
    .map(r => ({
      id: `guide-${r.route}`,
      label: r.page.sections[0]?.heading ?? 'Untitled',
      level: 2 as const,
      icon: CodeBracketIcon,
      action: { type: 'route' as const, to: r.route },
      isActive: (loc: Location) => loc.pathname === r.route,
    }))
}

function buildHomeChildren(routes: CanvasRoute[]): NavItem[] {
  return [
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

const listingZones: ListingZoneSpec[] = [
  {
    landingLabel: 'All notes',
    icon: Rss,
    route: ROUTE_PATTERNS.notes,
    profile: NOTES_STREAM_PROFILE,
    // '/note/…' without '/notebook…' — one note is the notes concept too.
    familyActive: (loc: Location) =>
      loc.pathname === '/notes'
      || (loc.pathname.startsWith('/note/') && !loc.pathname.startsWith('/notebook')),
    createAction: {
      label: 'New note',
      testId: 'notes-create-note',
      onClick: ({ openCreateJournal, navigate }) => {
        if (openCreateJournal) openCreateJournal({ mode: 'source' })
        else navigate('/notes?create=1&mode=source')
      },
    },
  },
  {
    landingLabel: 'All feeds',
    icon: Rss,
    route: ROUTE_PATTERNS.feeds,
    profile: FEEDS_STREAM_PROFILE,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/feeds', '/feed'),
  },
  {
    landingLabel: 'All pages',
    icon: File,
    route: ROUTE_PATTERNS.pages,
    profile: PAGES_STREAM_PROFILE,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/pages', '/page'),
    createAction: {
      label: 'New page',
      testId: 'pages-create-page',
      onClick: ({ navigate }) => {
        navigate('/page/new?mode=create')
      },
    },
  },
]

// ─── App nav tree ─────────────────────────────────────────────────────────────

/**
 * @param _openSearch - retained for the global keyboard shortcut (Ctrl+/)
 *   but Search is no longer an L1 sidebar item — it lives in the top app-bar.
 * @param canvasRoutes - the seeded canvas route table (hydrated from
 *   IndexedDB); the guide children derive from it.
 */
export function buildAppNavTree(_openSearch: () => void, canvasRoutes: CanvasRoute[] = []): NavItem[] {
  const homeChildren = buildHomeChildren(canvasRoutes)
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
        loc.pathname.startsWith('/page/guide-') ||
        loc.pathname.startsWith('/canvas') ||
        loc.pathname === ROUTE_PATTERNS.home ||
        loc.pathname === ROUTE_PATTERNS.aiFirst ||
        loc.pathname.startsWith('/ai-first/'),
      children: homeChildren,
    },

    // Notebooks leads the library: the journal and playgrounds views live
    // inside this zone, so it precedes the other list routes.
    {
      id: listRouteId(ROUTE_PATTERNS.notebooks),
      label: listRouteLabel(ROUTE_PATTERNS.notebooks),
      level: 1,
      icon: Library,
      action: { type: 'route', to: ROUTE_PATTERNS.notebooks },
      // The whole notebook family: the landing, one notebook, and the
      // journal / playgrounds views (NotebookZonePanel picks the view).
      isActive: (loc: Location) =>
        startsWithAny(loc.pathname, '/notebooks', '/notebook', '/journal', '/day', '/playgrounds', '/playground'),
      applyFooter: true,
      panel: NotebookZonePanel,
    },

    ...listingZones.map(listingZone),

    {
      id: listRouteId(ROUTE_PATTERNS.dashboards),
      label: listRouteLabel(ROUTE_PATTERNS.dashboards),
      level: 1,
      icon: ChartBarIcon,
      action: { type: 'route', to: ROUTE_PATTERNS.dashboards },
      isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.dashboards || loc.pathname.startsWith('/dashboard/'),
      // The L2 list (Explorer + vault-created + prebuilts, plus a New
      // dashboard action) is dynamic — vault dashboards are runtime data —
      // so it lives in the panel, not static children.
      panel: DashboardsNavPanel,
    },

    {
      id: listRouteId(ROUTE_PATTERNS.efforts),
      label: listRouteLabel(ROUTE_PATTERNS.efforts),
      level: 1,
      icon: Dumbbell,
      action: { type: 'route', to: ROUTE_PATTERNS.efforts },
      isActive: (loc: Location) => isEffortsPath(loc.pathname),
      applyFooter: true,
      panel: createConditionsNavPanel({
        landingLabel: 'All Efforts',
        icon: Dumbbell,
        route: ROUTE_PATTERNS.efforts,
        profile: EFFORTS_STREAM_PROFILE,
        familyActive: (loc: Location) => isEffortsPath(loc.pathname),
        createAction: {
          label: 'New effort',
          testId: 'efforts-create-effort',
          onClick: ({ navigate }) => {
            navigate('/effort/new?mode=create')
          },
        },
      }),
    },

    {
      id: listRouteId(ROUTE_PATTERNS.equipment),
      label: listRouteLabel(ROUTE_PATTERNS.equipment),
      level: 1,
      icon: Wrench,
      action: { type: 'route', to: ROUTE_PATTERNS.equipment },
      isActive: (loc: Location) => isEquipmentPath(loc.pathname),
      applyFooter: true,
      panel: createConditionsNavPanel({
        landingLabel: 'All Equipment',
        icon: Wrench,
        route: ROUTE_PATTERNS.equipment,
        profile: EQUIPMENT_STREAM_PROFILE,
        familyActive: (loc: Location) => isEquipmentPath(loc.pathname),
        createAction: {
          label: 'New equipment',
          testId: 'equipment-create-equipment',
          onClick: ({ navigate }) => {
            navigate('/equipment/new?mode=create')
          },
        },
      }),
    },

    {
      id: listRouteId(ROUTE_PATTERNS.sessions),
      label: listRouteLabel(ROUTE_PATTERNS.sessions),
      level: 1,
      icon: ClipboardList,
      action: { type: 'route', to: ROUTE_PATTERNS.sessions },
      isActive: (loc: Location) =>
        loc.pathname.startsWith('/sessions') ||
        loc.pathname.startsWith('/session/') ||
        loc.pathname.startsWith('/results'),
      applyFooter: true,
      panel: createConditionsNavPanel({
        landingLabel: 'All Sessions',
        icon: ClipboardList,
        route: ROUTE_PATTERNS.sessions,
        profile: SESSIONS_STREAM_PROFILE,
        familyActive: (loc: Location) =>
          loc.pathname.startsWith('/sessions') ||
          loc.pathname.startsWith('/session/') ||
          loc.pathname.startsWith('/results'),
      }),
    },
    {
      id: listRouteId(ROUTE_PATTERNS.tags),
      label: listRouteLabel(ROUTE_PATTERNS.tags),
      level: 1,
      icon: Tag,
      action: { type: 'route', to: ROUTE_PATTERNS.tags },
      isActive: (loc: Location) => loc.pathname.startsWith('/tags') || loc.pathname.startsWith('/t/'),
      applyFooter: true,
      panel: createConditionsNavPanel({
        landingLabel: 'All Tags',
        icon: Tag,
        route: ROUTE_PATTERNS.tags,
        profile: TAGS_STREAM_PROFILE,
        familyActive: (loc: Location) => loc.pathname.startsWith('/tags') || loc.pathname.startsWith('/t/'),
      }),
    },
    {
      id: 'settings',
      label: 'Settings',
      level: 1,
      icon: Settings,
      action: { type: 'route', to: ROUTE_PATTERNS.settingsAppearance },
      isActive: (loc: Location) => loc.pathname.startsWith('/settings'),
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
