/**
 * PagesZonePanel — the L2 panel for the Pages zone.
 *
 * Pages rolls up Notes, Sessions, Efforts, Equipment, Tags, and Guides as
 * L2 subsections/variations over the unified slugged content model.
 *
 * When navigated into a specific variation route (e.g. /sessions, /efforts),
 * the panel renders that concept's ConditionsNavPanel with the shared
 * Pages variation links as extraChildren, ensuring lateral movement remains
 * one click away.
 */
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import {
  File,
  Rss,
  ClipboardList,
  Dumbbell,
  Wrench,
  Tag,
} from 'lucide-react'
import { ROUTE_PATTERNS, isEffortsPath, isEquipmentPath } from '../../lib/routes'
import {
  PAGES_STREAM_PROFILE,
  NOTES_STREAM_PROFILE,
  SESSIONS_STREAM_PROFILE,
  EFFORTS_STREAM_PROFILE,
  EQUIPMENT_STREAM_PROFILE,
  TAGS_STREAM_PROFILE,
} from '../../views/stream/streamProfile'
import type { NavItem, NavPanelProps } from '../navTypes'
import { startsWithAny, guideChildrenFrom } from '../appNavTree'
import { createConditionsNavPanel } from './ConditionsNavPanel'
import type { CanvasRoute } from '../../canvas/canvasRoutes'

export function pagesVariationChildren(canvasRoutes: CanvasRoute[] = []): NavItem[] {
  return [
    {
      id: 'pages-sub-all',
      label: 'All Pages',
      level: 2,
      icon: File,
      action: { type: 'route', to: ROUTE_PATTERNS.pages },
      isActive: (loc: Location) => loc.pathname === ROUTE_PATTERNS.pages,
    },
    {
      id: 'pages-sub-notes',
      label: 'Notes',
      level: 2,
      icon: Rss,
      action: { type: 'route', to: ROUTE_PATTERNS.notes },
      isActive: (loc: Location) =>
        loc.pathname === '/notes' || (loc.pathname.startsWith('/note/') && !loc.pathname.startsWith('/notebook')),
    },
    {
      id: 'pages-sub-sessions',
      label: 'Sessions',
      level: 2,
      icon: ClipboardList,
      action: { type: 'route', to: ROUTE_PATTERNS.sessions },
      isActive: (loc: Location) =>
        loc.pathname.startsWith('/sessions') ||
        loc.pathname.startsWith('/session/') ||
        loc.pathname.startsWith('/results'),
    },
    {
      id: 'pages-sub-efforts',
      label: 'Efforts',
      level: 2,
      icon: Dumbbell,
      action: { type: 'route', to: ROUTE_PATTERNS.efforts },
      isActive: (loc: Location) => isEffortsPath(loc.pathname),
    },
    {
      id: 'pages-sub-equipment',
      label: 'Equipment',
      level: 2,
      icon: Wrench,
      action: { type: 'route', to: ROUTE_PATTERNS.equipment },
      isActive: (loc: Location) => isEquipmentPath(loc.pathname),
    },
    {
      id: 'pages-sub-tags',
      label: 'Tags',
      level: 2,
      icon: Tag,
      action: { type: 'route', to: ROUTE_PATTERNS.tags },
      isActive: (loc: Location) => loc.pathname.startsWith('/tags') || loc.pathname.startsWith('/t/'),
    },
    ...guideChildrenFrom(canvasRoutes),
  ]
}

export function createPagesZonePanel(canvasRoutes: CanvasRoute[] = []) {
  const variations = pagesVariationChildren(canvasRoutes)

  const PagesConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All pages',
    icon: File,
    route: ROUTE_PATTERNS.pages,
    profile: PAGES_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) => startsWithAny(loc.pathname, '/pages', '/page'),
    createAction: {
      label: 'New page',
      testId: 'pages-create-page',
      onClick: ({ navigate }) => {
        navigate('/page/new?mode=create')
      },
    },
  })

  const NotesConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All notes',
    icon: Rss,
    route: ROUTE_PATTERNS.notes,
    profile: NOTES_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) =>
      loc.pathname === '/notes' || (loc.pathname.startsWith('/note/') && !loc.pathname.startsWith('/notebook')),
    createAction: {
      label: 'New note',
      testId: 'notes-create-note',
      onClick: ({ openCreateJournal, navigate }) => {
        if (openCreateJournal) openCreateJournal({ mode: 'source' })
        else navigate('/notes?create=1&mode=source')
      },
    },
  })

  const SessionsConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All Sessions',
    icon: ClipboardList,
    route: ROUTE_PATTERNS.sessions,
    profile: SESSIONS_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) =>
      loc.pathname.startsWith('/sessions') ||
      loc.pathname.startsWith('/session/') ||
      loc.pathname.startsWith('/results'),
  })

  const EffortsConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All Efforts',
    icon: Dumbbell,
    route: ROUTE_PATTERNS.efforts,
    profile: EFFORTS_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) => isEffortsPath(loc.pathname),
    createAction: {
      label: 'New effort',
      testId: 'efforts-create-effort',
      onClick: ({ navigate }) => {
        navigate('/effort/new?mode=create')
      },
    },
  })

  const EquipmentConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All Equipment',
    icon: Wrench,
    route: ROUTE_PATTERNS.equipment,
    profile: EQUIPMENT_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) => isEquipmentPath(loc.pathname),
    createAction: {
      label: 'New equipment',
      testId: 'equipment-create-equipment',
      onClick: ({ navigate }) => {
        navigate('/equipment/new?mode=create')
      },
    },
  })

  const TagsConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All Tags',
    icon: Tag,
    route: ROUTE_PATTERNS.tags,
    profile: TAGS_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) => loc.pathname.startsWith('/tags') || loc.pathname.startsWith('/t/'),
  })

  return function PagesZonePanel(props: NavPanelProps) {
    const location = useLocation()
    if (
      location.pathname === '/notes' ||
      (location.pathname.startsWith('/note/') && !location.pathname.startsWith('/notebook'))
    ) {
      return <NotesConditionsPanel {...props} />
    }
    if (
      location.pathname.startsWith('/sessions') ||
      location.pathname.startsWith('/session/') ||
      location.pathname.startsWith('/results')
    ) {
      return <SessionsConditionsPanel {...props} />
    }
    if (isEffortsPath(location.pathname)) {
      return <EffortsConditionsPanel {...props} />
    }
    if (isEquipmentPath(location.pathname)) {
      return <EquipmentConditionsPanel {...props} />
    }
    if (location.pathname.startsWith('/tags') || location.pathname.startsWith('/t/')) {
      return <TagsConditionsPanel {...props} />
    }
    return <PagesConditionsPanel {...props} />
  }
}
