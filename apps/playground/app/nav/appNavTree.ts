/**
 * appNavTree — the authoritative L1 + L2 navigation tree for the app.
 *
 * L3 (page-index / scroll anchors) is injected dynamically by each route
 * component via useSetNavL3() or AppContent's setL3Items() call.
 *
 * Structure:
 *   L1: Home, Journal, Notebooks, Notes, Feeds, Pages, Playgrounds,
 *       Dashboard, Efforts, Equipment, Sessions, Tags, Settings
 *   L2 of Home:        the consolidated Guide chapters (markdown/canvas/guide/**;
 *                      the old syntax/behaviors/analytics pillars are folded in)
 *   L2 of the stream routes (Journal/Notebooks/Notes/Feeds/Pages/
 *                      Playgrounds/Efforts/Equipment/Sessions): the shared
 *                      ConditionsNavPanel — current-result `{}` condition
 *                      accordion plus grouping presets over the CURRENT query
 *   L2 of Dashboards:  dynamic panel (vault/runtime data)
 *   Search has moved out of the L1 sidebar and into the top app-bar.
 *
 * The canvas-guide children derive from the seeded canvas routes passed by
 * the caller (App.tsx hydrates them from IndexedDB); tests/storybook use the
 * static `appNavTree` export, which carries no canvas children.
 */

import { HomeIcon, CodeBracketIcon } from '@heroicons/react/20/solid'
import { ChartBarIcon, Dumbbell, Rss, Calendar, Settings, Paintbrush, Sliders, FlaskConical, ClipboardList, File, Layers, Tag, Library, Plus, CalendarPlus, UserRound, Database, CloudDownload, Wrench, Volume2 } from 'lucide-react'
import type { NavItem } from './navTypes'
import type { Location } from 'react-router-dom'
import { JOURNAL_STREAM_PROFILE, NOTEBOOKS_STREAM_PROFILE, NOTES_STREAM_PROFILE, FEEDS_STREAM_PROFILE, PAGES_STREAM_PROFILE, PLAYGROUNDS_STREAM_PROFILE, EFFORTS_STREAM_PROFILE, EQUIPMENT_STREAM_PROFILE, SESSIONS_STREAM_PROFILE, type StreamProfile } from '../views/stream/streamProfile'
import { ROUTE_PATTERNS, isEffortsPath, isEquipmentPath } from '../lib/routes'

import { DashboardsNavPanel } from './panels/DashboardsNavPanel'
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
 * The library concepts are top-level L1 rows — one zone per concept, each on
 * its own canonical list route. Every zone's L2 is the shared
 * ConditionsNavPanel; there are no static preset children to keep in sync.
 */
interface ListingZoneSpec {
  id: string
  label: string
  landingLabel: string
  icon: NavItem['icon']
  route: string
  profile: StreamProfile
  /** Extra panel rows appended after the presets (e.g. All, catalog crosswalk). */
  extraChildren?: NavItem[]
  /** Whole zone route family (L1 activation). */
  familyActive: (loc: Location) => boolean
  createAction?: ConditionsPanelSpec['createAction']
}

const startsWithAny = (pathname: string, ...prefixes: string[]): boolean =>
  prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

/**
 * The inclusive All listing — every note kind and source except playground,
 * resolved as a query view on the journal surface (`/journal?q=…`), not a
 * route of its own. The exclusion is editable: removing the
 * `!source:playground` filter in the stream composer includes playground.
 */
export const ALL_NOTES_WQL = ':note{!source:playground}'

const allNotesChild: NavItem = {
  id: 'journal-all-notes',
  label: 'All',
  level: 2,
  icon: Layers,
  action: { type: 'route', to: `/journal?q=${encodeURIComponent(ALL_NOTES_WQL)}` },
  isActive: (loc: Location) =>
    loc.pathname === ROUTE_PATTERNS.journal &&
    new URLSearchParams(loc.search).get('q') === ALL_NOTES_WQL,
}

function listingZone(spec: ListingZoneSpec): NavItem {
  return {
    id: spec.id,
    label: spec.label,
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
    id: 'journal',
    label: 'Journal',
    landingLabel: 'All entries',
    icon: Calendar,
    route: ROUTE_PATTERNS.journal,
    profile: JOURNAL_STREAM_PROFILE,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/journal', '/day'),
    extraChildren: [allNotesChild],
    createAction: {
      label: 'New journal entry',
      icon: CalendarPlus,
      testId: 'journal-create-entry',
      onClick: ({ openCreateJournal, navigate }) => {
        if (openCreateJournal) openCreateJournal({ mode: 'blank' })
        else navigate('/journal?create=1')
      },
    },
  },
  {
    id: 'notebooks',
    label: 'Notebooks',
    landingLabel: 'All notebooks',
    icon: Library,
    route: ROUTE_PATTERNS.notebooks,
    profile: NOTEBOOKS_STREAM_PROFILE,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/notebooks', '/notebook'),
  },
  {
    id: 'notes',
    label: 'Notes',
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
    id: 'feeds',
    label: 'Feeds',
    landingLabel: 'All feeds',
    icon: Rss,
    route: ROUTE_PATTERNS.feeds,
    profile: FEEDS_STREAM_PROFILE,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/feeds', '/feed'),
  },
  {
    id: 'pages',
    label: 'Pages',
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
  {
    id: 'playgrounds',
    label: 'Playgrounds',
    landingLabel: 'All playgrounds',
    icon: FlaskConical,
    route: ROUTE_PATTERNS.playgrounds,
    profile: PLAYGROUNDS_STREAM_PROFILE,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/playgrounds', '/playground'),
    createAction: {
      label: 'New playground',
      testId: 'playgrounds-create-playground',
      onClick: ({ navigate }) => {
        navigate('/playground')
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

    ...listingZones.map(listingZone),

    {
      id: 'dashboards',
      label: 'Dashboard',
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
      id: 'efforts',
      label: 'Efforts',
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
      id: 'equipment',
      label: 'Equipment',
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
      id: 'sessions',
      label: 'Sessions',
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
      id: 'tags',
      label: 'Tags',
      level: 1,
      icon: Tag,
      action: { type: 'route', to: ROUTE_PATTERNS.tags },
      isActive: (loc: Location) => loc.pathname.startsWith('/tags') || loc.pathname.startsWith('/t/'),
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
