/**
 * NotebookZonePanel — the L2 panel of the notebooks zone.
 *
 * Journal and Playgrounds are not concepts — they are VIEWS within the
 * notebooks zone (the journal is a notebook's days; the playground is a
 * notebook). Each view keeps its own canonical route (/journal, /playgrounds)
 * and its own route-keyed ConditionsNavPanel, so a user's saved per-route
 * query configuration, shortcuts and facets bind to the view's route exactly
 * as before the zones were folded together. The panel selects the view by
 * route identity.
 */
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { Calendar, CalendarPlus, FlaskConical, Layers, Library, Settings } from 'lucide-react'

import { ROUTE_PATTERNS } from '../../lib/routes'
import {
  JOURNAL_STREAM_PROFILE,
  NOTEBOOKS_STREAM_PROFILE,
  PLAYGROUNDS_STREAM_PROFILE,
} from '../../views/stream/streamProfile'
import type { NavItem, NavPanelProps } from '../navTypes'
import { startsWithAny } from '../appNavTree'
import { createConditionsNavPanel } from './ConditionsNavPanel'

const journalViewActive = (loc: Location): boolean =>
  startsWithAny(loc.pathname, '/journal', '/day')

const playgroundsViewActive = (loc: Location): boolean =>
  startsWithAny(loc.pathname, '/playgrounds', '/playground')

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

/** The view-switcher rows every notebooks-zone panel carries — the L2
 * entries of the zone. Labels are the views' route names. */
export const notebookViewChildren: NavItem[] = [
  {
    id: 'notebooks-view-playgrounds',
    label: 'Playgrounds',
    level: 2,
    icon: FlaskConical,
    action: { type: 'route', to: ROUTE_PATTERNS.playgrounds },
    isActive: playgroundsViewActive,
  },
  {
    id: 'notebooks-configure-sources',
    label: 'Configure sources',
    level: 2,
    icon: Settings,
    action: { type: 'route', to: ROUTE_PATTERNS.feeds },
    isActive: (loc: Location) => startsWithAny(loc.pathname, '/feeds', '/feed'),
  },
]
const NotebooksConditionsPanel = createConditionsNavPanel({
  landingLabel: 'Subscribed notebooks',
  icon: Library,
  route: ROUTE_PATTERNS.notebooks,
  profile: NOTEBOOKS_STREAM_PROFILE,
  extraChildren: notebookViewChildren,
  familyActive: (loc: Location) =>
    startsWithAny(loc.pathname, '/notebooks', '/notebook', '/playgrounds', '/playground'),
})

export const JournalViewConditionsPanel = createConditionsNavPanel({
  landingLabel: 'All entries',
  icon: Calendar,
  route: ROUTE_PATTERNS.journal,
  profile: JOURNAL_STREAM_PROFILE,
  extraChildren: [allNotesChild],
  familyActive: journalViewActive,
  createAction: {
    label: 'New journal entry',
    icon: CalendarPlus,
    testId: 'journal-create-entry',
    onClick: ({ openCreateJournal, navigate }) => {
      if (openCreateJournal) openCreateJournal({ mode: 'blank' })
      else navigate('/journal?create=1')
    },
  },
})

const PlaygroundsViewConditionsPanel = createConditionsNavPanel({
  landingLabel: 'All playgrounds',
  icon: FlaskConical,
  route: ROUTE_PATTERNS.playgrounds,
  profile: PLAYGROUNDS_STREAM_PROFILE,
  extraChildren: notebookViewChildren,
  familyActive: playgroundsViewActive,
  createAction: {
    label: 'New playground',
    testId: 'playgrounds-create-playground',
    onClick: ({ navigate }) => {
      navigate('/playground')
    },
  },
})

/**
 * The notebooks-zone L2 panel selects the view by route identity: the
 * journal view's panel on /journal + /day/*, the playgrounds view's panel on
 * /playgrounds + /playground/*, the notebooks landing panel elsewhere in
 * the family.
 */
export function NotebookZonePanel(props: NavPanelProps) {
  const location = useLocation()
  if (journalViewActive(location)) return <JournalViewConditionsPanel {...props} />
  if (playgroundsViewActive(location)) return <PlaygroundsViewConditionsPanel {...props} />
  return <NotebooksConditionsPanel {...props} />
}
