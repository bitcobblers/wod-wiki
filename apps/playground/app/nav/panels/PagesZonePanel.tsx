/**
 * PagesZonePanel — the L2 panel for the Pages zone.
 *
 * Pages rolls up Notes, Sessions, and Guides as L2 variations over the
 * unified slugged content model. Efforts, Equipment, and Tags are L1 zones.
 *
 * Notes and Sessions render their own route-keyed ConditionsNavPanel with
 * the shared Pages variation links.
 */
import type React from 'react'
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import {
  File,
  Rss,
  ClipboardList,
} from 'lucide-react'
import { ROUTE_PATTERNS } from '../../lib/routes'
import {
  PAGES_STREAM_PROFILE,
  NOTES_STREAM_PROFILE,
  SESSIONS_STREAM_PROFILE,
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
    ...guideChildrenFrom(canvasRoutes),
  ]
}

export function createPagesZonePanel(canvasRoutes: CanvasRoute[] = []): (props: NavPanelProps) => React.ReactElement {
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
      onClick: ({ openCreateJournal, navigate }) => {
        if (openCreateJournal) openCreateJournal({ kind: 'page' })
        else navigate('/pages?create=1')
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
    return <PagesConditionsPanel {...props} />
  }
}
