/**
 * PagesZonePanel — the L2 panel for the Pages zone.
 *
 * Pages rolls up Notes and Guides as L2 variations over the unified slugged
 * content model. Efforts, Equipment, Tags, and Sessions are L1 zones.
 *
 * Notes renders its own route-keyed ConditionsNavPanel with the shared Pages
 * variation links.
 */
import type React from 'react'
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import {
  File,
  Rss,
} from 'lucide-react'
import { ROUTE_PATTERNS } from '../../lib/routes'
import {
  PAGES_STREAM_PROFILE,
  NOTES_STREAM_PROFILE,
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
  })

  const NotesConditionsPanel = createConditionsNavPanel({
    landingLabel: 'All notes',
    icon: Rss,
    route: ROUTE_PATTERNS.notes,
    profile: NOTES_STREAM_PROFILE,
    extraChildren: variations,
    familyActive: (loc: Location) =>
      loc.pathname === '/notes' || (loc.pathname.startsWith('/note/') && !loc.pathname.startsWith('/notebook')),
  })

  return function PagesZonePanel(props: NavPanelProps) {
    const location = useLocation()
    if (
      location.pathname === '/notes' ||
      (location.pathname.startsWith('/note/') && !location.pathname.startsWith('/notebook'))
    ) {
      return <NotesConditionsPanel {...props} />
    }
    return <PagesConditionsPanel {...props} />
  }
}
