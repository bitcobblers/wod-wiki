/**
 * NavContext — global navigation state shared across all zones.
 *
 * Provides:
 *   navState       — selection, filter, drawer open/close, right-edge coordination
 *   dispatch       — typed action dispatcher
 *   peekTarget     — active 340px right-edge Entity/Schedule Peek target (mutually
 *                    exclusive with rightDrawerOpen and WhiteboardInspectorDrawer)
 *   openPeek       — open a 340px peek target (sets inspectorDrawerOpen: true,
 *                    closes rightDrawerOpen)
 *   closePeek      — dismiss the active peek target
 *   l3Items        — current page's scroll-anchor index (injected by route components)
 *   setL3Items     — called by AppContent / per-page hooks to update L3 outline
 *   l3Connections  — current detail page's relationship MenuSpec (rendered in L3
 *                    beside "On this page" so L2 stays steady across all routes)
 *   setL3Connections — register/clear L3 connections for the active detail route
 *   l3Actions      — grouped L3 context actions (primary / author / organize /
 *                    share / danger)
 *   scrollToSection — single scroll handler; falls back to DOM; can be
 *                     overridden by page components via registerScrollFn()
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ComponentType,
} from 'react'
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import type {
  EntityPeekTarget,
  L3ActionGroup,
  NavItem,
  NavItemL3,
  NavState,
  NavStateAction,
  NavDispatch,
} from './navTypes'
import type { MenuEntry, MenuSpec } from './menuModel'
import type { EntityLevel } from '../lib/fieldProjection'
import type { LayoutMode, ViewSettings } from '../lib/viewSettingsStorage'
import type { ExplorerRangeWeeks } from '../hooks/useExplorerQueryState'

export type { EntityPeekTarget, L3ActionGroup } from './navTypes'

// ─── Initial State ────────────────────────────────────────────────────────────

export const initialNavState: NavState = {
  activeL1Id: null,
  activeL2Id: null,
  activeL3Id: null,
  leftDrawerOpen: false,
  rightDrawerOpen: false,
  inspectorDrawerOpen: false,
  peekTarget: null,
  expandedIds: new Set(),
  journalFilter: { selectedDate: null, selectedTags: [] },
  searchFilter: { scope: 'all' },
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function navReducer(state: NavState, action: NavStateAction): NavState {
  switch (action.type) {
    // ponytail: equality guards — dispatching the current value must return the
    // same state object, or every dispatch forces a provider re-render (and any
    // per-render dispatch becomes an infinite loop).
    case 'SET_ACTIVE_L1': return state.activeL1Id === action.id ? state : { ...state, activeL1Id: action.id }
    case 'SET_ACTIVE_L2': return state.activeL2Id === action.id ? state : { ...state, activeL2Id: action.id }
    case 'SET_ACTIVE_L3': return state.activeL3Id === action.id ? state : { ...state, activeL3Id: action.id }
    case 'SET_LEFT_DRAWER':  return state.leftDrawerOpen === action.open ? state : { ...state, leftDrawerOpen: action.open }
    case 'SET_RIGHT_DRAWER':
      if (action.open) {
        return state.rightDrawerOpen && !state.inspectorDrawerOpen && (state.peekTarget ?? null) === null
          ? state
          : { ...state, rightDrawerOpen: true, inspectorDrawerOpen: false, peekTarget: null }
      }
      return !state.rightDrawerOpen ? state : { ...state, rightDrawerOpen: false }
    case 'SET_INSPECTOR_DRAWER':
      if (action.open) {
        return state.inspectorDrawerOpen && !state.rightDrawerOpen && (state.peekTarget ?? null) === null
          ? state
          : { ...state, inspectorDrawerOpen: true, rightDrawerOpen: false, peekTarget: null }
      }
      return !state.inspectorDrawerOpen && (state.peekTarget ?? null) === null
        ? state
        : { ...state, inspectorDrawerOpen: false, peekTarget: null }
    case 'OPEN_PEEK':
      return state.peekTarget === action.target && state.inspectorDrawerOpen && !state.rightDrawerOpen
        ? state
        : { ...state, peekTarget: action.target, inspectorDrawerOpen: true, rightDrawerOpen: false }
    case 'CLOSE_PEEK':
      return (state.peekTarget ?? null) === null
        ? state
        : { ...state, peekTarget: null, inspectorDrawerOpen: false }
    case 'TOGGLE_EXPANDED': {
      const next = new Set(state.expandedIds)
      if (next.has(action.id)) {
        next.delete(action.id)
      } else {
        next.add(action.id)
      }
      return { ...state, expandedIds: next }
    }
    case 'SET_JOURNAL_DATE':
      return { ...state, journalFilter: { ...state.journalFilter, selectedDate: action.date } }
    case 'SET_JOURNAL_TAGS':
      return { ...state, journalFilter: { ...state.journalFilter, selectedTags: action.tags } }
    case 'SET_SEARCH_SCOPE':
      return { ...state, searchFilter: { scope: action.scope } }
    default:
      return state
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * @deprecated Stream controls moved to StreamQueryBar (+ Filter) and the
 * compact header View popover; resting L3 is 0px on stream routes. Retained
 * temporarily so unmigrated callers compile cleanly during rollout.
 */
export interface StreamNavControls {
  query: string
  onQueryChange: (wql: string) => void
  groupDims: string[]
  onToggleGroupDim: (dim: string) => void
  availableGroupDims: { id: string; label: string }[]
  settings: ViewSettings
  onLayoutChange: (layout: LayoutMode) => void
  onToggleField: (fieldId: string) => void
  level: EntityLevel
  availableLayouts?: readonly LayoutMode[]
  onOpenQuerySettings?: () => void
}

/**
 * L3 Slot 1 modifier controls for analytics & query-widget surfaces
 * (Dashboard boards and Note pages carrying embedded `query` blocks).
 */
export interface AnalyticsNavControls {
  /** Controlled week window. Omit to use global RangeSelector. */
  weeks?: ExplorerRangeWeeks
  onWeeksChange?: (weeks: ExplorerRangeWeeks) => void
  /** Show the Date range section (default: true). */
  showRange?: boolean
  /** Show the Units (kg/lb) toggle section (default: true). */
  showUnits?: boolean
  /** When true, the query pins its own `in <unit>` clause and locks the toggle. */
  unitForced?: boolean
  /** Open the surface's query settings modal. */
  onOpenQuerySettings?: () => void
  /** Reset live-applied L3 modifiers back to route defaults. */
  onReset?: () => void
}

/**
 * L3 Slot 3 context action row — shortcuts acting on the current entity or
 * board (e.g. Run Workout, Add timer, Add widget, Clone to vault, Note
 * placements, Copy link, Delete). Grouped inside SecondaryNav rather than
 * duplicated in StickyPageHeader.
 */
export interface L3ActionItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  onRun: () => void
  disabled?: boolean
  testId?: string
  group?: L3ActionGroup
}

/**
 * @deprecated Detail pages publish relationships into L3 via `setL3Connections`
 * so L2 stays steady as Zone Places + Saved Views. Retained as a bridge so
 * callers still invoking `setContextNav` route their spec into L3 instead of
 * replacing L2.
 */
export interface ContextNav {
  pathname: string
  spec: MenuSpec
}

export interface NavContextValue {
  tree: NavItem[]
  navState: NavState
  dispatch: NavDispatch
  peekTarget?: EntityPeekTarget | null
  openPeek?: (target: EntityPeekTarget) => void
  closePeek?: () => void
  l3Items: NavItemL3[]
  setL3Items: (items: NavItemL3[]) => void
  l3Connections?: MenuSpec
  setL3Connections?: (spec?: MenuSpec) => void
  l3Actions?: L3ActionItem[]
  setL3Actions?: (actions: L3ActionItem[]) => void
  secondarySpec?: MenuSpec
  setSecondarySpec: (spec?: MenuSpec) => void
  /** @deprecated Use `l3Connections` / `setL3Connections`. */
  contextNav?: ContextNav
  /** @deprecated Bridges to `l3Connections` so L2 is never wiped. */
  setContextNav: (nav?: ContextNav | ((prev?: ContextNav) => ContextNav | undefined)) => void
  /** @deprecated Stream controls are retired from L3 (resting L3 = 0px on streams). */
  streamControls?: StreamNavControls | null
  /** @deprecated Stream controls are retired from L3 (resting L3 = 0px on streams). */
  setStreamControls: (controls: StreamNavControls | null) => void
  analyticsControls?: AnalyticsNavControls | null
  setAnalyticsControls?: (controls: AnalyticsNavControls | null) => void
  scrollToSection: (id: string) => void
  /**
   * Register a custom scroll-to handler. Called by AppContent so the sidebar
   * can scroll into editor (CodeMirror) content that lives outside the DOM.
   * Falls back to standard DOM getBoundingClientRect scroll.
   */
  registerScrollFn: (fn: (id: string) => void) => void
  openCreateJournal: (opts?: CreateWizardOptions) => void
  registerCreateJournal: (fn: (opts?: CreateWizardOptions) => void) => void
}

export interface CreateWizardOptions {
  kind?: 'journal' | 'note' | 'playground' | 'notebook' | 'page' | 'effort' | 'equipment' | 'tag'
  mode?: 'blank' | 'notebook' | 'source'
  date?: string
  notebookSlug?: string
}

const defaultScroll = (id: string) => {
  const el = document.getElementById(id)
  if (el) {
    const y = el.getBoundingClientRect().top + window.scrollY - 80
    window.scrollTo({ top: y, behavior: 'smooth' })
  }
}

const DEFAULT_NAV_CONTEXT: NavContextValue = {
  tree: [],
  navState: initialNavState,
  dispatch: () => {},
  peekTarget: null,
  openPeek: () => {},
  closePeek: () => {},
  l3Items: [],
  setL3Items: () => {},
  l3Connections: undefined,
  setL3Connections: () => {},
  l3Actions: [],
  setL3Actions: () => {},
  secondarySpec: undefined,
  setSecondarySpec: () => {},
  contextNav: undefined,
  setContextNav: () => {},
  streamControls: null,
  setStreamControls: () => {},
  analyticsControls: null,
  setAnalyticsControls: () => {},
  scrollToSection: defaultScroll,
  registerScrollFn: () => {},
  openCreateJournal: () => {},
  registerCreateJournal: () => {},
}

export const NavContext = createContext<NavContextValue>(DEFAULT_NAV_CONTEXT)

export function useNav() {
  return useContext(NavContext)
}

/**
 * Returns the nearest NavContext value, or `null` when rendered outside
 * `NavProvider` (e.g. standalone Storybook stories or isolated editor tests).
 */
export function useOptionalNav(): NavContextValue | null {
  const ctx = useContext(NavContext)
  return ctx === DEFAULT_NAV_CONTEXT ? null : ctx
}

/**
 * Light an L1 zone by id for routes no tree `isActive` predicate matches
 * (e.g. the source-agnostic /notes/:noteId page). Guarded: no-op when the id
 * is absent from the tree, and only dispatched after the auto pathname sync
 * has settled (entry loads are async, so this runs later in the commit cycle).
 */
export function useNoteL1Zone(zoneId: string | null): void {
  const { tree, dispatch } = useNav()
  useEffect(() => {
    if (!zoneId) return
    if (!tree.some(item => item.id === zoneId)) return
    dispatch({ type: 'SET_ACTIVE_L1', id: zoneId })
  }, [zoneId, tree, dispatch])
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface NavProviderProps {
  tree: NavItem[]
  children: React.ReactNode
}

function menuEntryEqual(a: MenuEntry, b: MenuEntry): boolean {
  if (a === b) return true
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === 'link' && b.kind === 'link') {
    return (
      a.label === b.label &&
      a.to === b.to &&
      a.sectionId === b.sectionId &&
      a.onSelect === b.onSelect &&
      a.onRun === b.onRun &&
      a.runIcon === b.runIcon &&
      a.filterTo === b.filterTo &&
      a.filterLabel === b.filterLabel &&
      a.timestamp === b.timestamp &&
      a.badge === b.badge &&
      a.muted === b.muted &&
      a.icon === b.icon
    )
  }
  if (a.kind === 'section' && b.kind === 'section') {
    return (
      a.label === b.label &&
      a.entries.length === b.entries.length &&
      a.entries.every((entry, i) => menuEntryEqual(entry, b.entries[i]!))
    )
  }
  if (a.kind === 'wql' && b.kind === 'wql') {
    return a.label === b.label && a.query === b.query && a.limit === b.limit
  }
  if (a.kind === 'widget' && b.kind === 'widget') {
    return a.render === b.render
  }
  return false
}

function menuSpecEqual(a?: MenuSpec, b?: MenuSpec): boolean {
  if (a === b) return true
  if ((!a || a.length === 0) && (!b || b.length === 0)) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((entry, i) => menuEntryEqual(entry, b[i]!))
}

export function NavProvider({ tree, children }: NavProviderProps) {
  const [navState, dispatch] = useReducer(navReducer, initialNavState)
  const [l3Items, setL3ItemsInternal] = useState<NavItemL3[]>([])
  const [l3ConnectionsState, setL3ConnectionsInternal] = useState<MenuSpec | undefined>(undefined)
  const [l3Actions, setL3ActionsInternal] = useState<L3ActionItem[]>([])
  const [secondarySpec, setSecondarySpecInternal] = useState<MenuSpec | undefined>(undefined)
  const [contextNav, setContextNavInternal] = useState<ContextNav | undefined>(undefined)
  const [streamControls, setStreamControlsInternal] = useState<StreamNavControls | null>(null)
  const [analyticsControls, setAnalyticsControlsInternal] = useState<AnalyticsNavControls | null>(null)

  const openPeek = useCallback((target: EntityPeekTarget) => {
    dispatch({ type: 'OPEN_PEEK', target })
  }, [])

  const closePeek = useCallback(() => {
    dispatch({ type: 'CLOSE_PEEK' })
  }, [])

  const setSecondarySpec = useCallback((next?: MenuSpec) => {
    setSecondarySpecInternal(prev => (prev === next ? prev : next))
  }, [])

  const setL3Connections = useCallback((next?: MenuSpec) => {
    setL3ConnectionsInternal(prev => (menuSpecEqual(prev, next) ? prev : next))
  }, [])

  const setContextNav = useCallback(
    (next: ContextNav | undefined | ((prev: ContextNav | undefined) => ContextNav | undefined)) => {
      setContextNavInternal(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (prev === resolved) return prev
        if (!prev && !resolved) return prev
        if (
          prev &&
          resolved &&
          prev.pathname === resolved.pathname &&
          prev.spec === resolved.spec
        ) {
          return prev
        }
        return resolved
      })
    },
    [],
  )

  const setStreamControls = useCallback((next: StreamNavControls | null) => {
    setStreamControlsInternal(prev => (prev === next ? prev : next))
  }, [])

  const setAnalyticsControls = useCallback((next: AnalyticsNavControls | null) => {
    setAnalyticsControlsInternal(prev => {
      if (prev === next) return prev
      if (!prev && !next) return prev
      if (
        prev &&
        next &&
        prev.weeks === next.weeks &&
        prev.onWeeksChange === next.onWeeksChange &&
        prev.showRange === next.showRange &&
        prev.showUnits === next.showUnits &&
        prev.unitForced === next.unitForced &&
        prev.onOpenQuerySettings === next.onOpenQuerySettings &&
        prev.onReset === next.onReset
      ) {
        return prev
      }
      return next
    })
  }, [])

  const setL3Actions = useCallback((actions: L3ActionItem[]) => {
    setL3ActionsInternal(prev => {
      if (
        prev.length === actions.length &&
        prev.every(
          (item, i) =>
            item.id === actions[i]?.id &&
            item.label === actions[i]?.label &&
            item.icon === actions[i]?.icon &&
            item.disabled === actions[i]?.disabled &&
            item.testId === actions[i]?.testId &&
            item.group === actions[i]?.group &&
            item.onRun === actions[i]?.onRun,
        )
      ) {
        return prev
      }
      return actions
    })
  }, [])

  const location = useLocation()

  // Bridge deprecated `setContextNav` into `l3Connections` for callers not yet
  // migrated to `setL3Connections`, ensuring L2 stays steady while relationships
  // still surface in L3.
  const l3Connections = useMemo<MenuSpec | undefined>(() => {
    if (l3ConnectionsState !== undefined) return l3ConnectionsState
    if (contextNav && contextNav.pathname === location.pathname && contextNav.spec.length > 0) {
      return contextNav.spec
    }
    return undefined
  }, [l3ConnectionsState, contextNav, location.pathname])

  // Mutable ref so AppContent can override scroll behaviour without re-rendering
  const scrollFnRef = useRef<(id: string) => void>(defaultScroll)
  const createJournalFnRef = useRef<((opts?: CreateWizardOptions) => void) | null>(null)
  // Auto-sync activeL1Id from current pathname
  useEffect(() => {
    const match = tree.find(item => {
      if (item.isActive) return item.isActive(location as unknown as Location, navState)
      if (item.action.type === 'route') {
        return item.action.to === '/'
          ? location.pathname === '/' || location.pathname === ''
          : location.pathname.startsWith(item.action.to)
      }
      return false
    })
    dispatch({ type: 'SET_ACTIVE_L1', id: match?.id ?? null })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Close drawers & active peek on route change. Analytics controls and
  // connections are NOT cleared here: this effect fires after children on
  // mount/update, which would wipe a view's just-published state. Each view's
  // unmount cleanup clears them.
  useEffect(() => {
    dispatch({ type: 'SET_LEFT_DRAWER', open: false })
    dispatch({ type: 'SET_RIGHT_DRAWER', open: false })
    dispatch({ type: 'SET_INSPECTOR_DRAWER', open: false })
  }, [location.pathname])

  const l3CallHandlersRef = useRef<Map<string, () => void>>(new Map())
  const setL3Items = useCallback((items: NavItemL3[]) => {
    const nextHandlers = new Map<string, () => void>()
    const wrapped = items.map((item) => {
      const sec = item.secondaryAction
      if (sec?.action.type !== 'call') return item
      const key = `${item.id}:${sec.id}`
      const handler = sec.action.handler
      nextHandlers.set(key, handler)
      return {
        ...item,
        secondaryAction: {
          ...sec,
          action: {
            type: 'call' as const,
            handler: () => {
              const latest = l3CallHandlersRef.current.get(key)
              if (latest) latest()
              else handler()
            },
          },
        },
      }
    })
    l3CallHandlersRef.current = nextHandlers
    setL3ItemsInternal((prev) => {
      if (
        prev.length === wrapped.length &&
        prev.every(
          (item, i) =>
            item.id === wrapped[i]?.id &&
            item.label === wrapped[i]?.label &&
            item.secondaryAction?.id === wrapped[i]?.secondaryAction?.id &&
            item.secondaryAction?.label === wrapped[i]?.secondaryAction?.label &&
            item.secondaryRunIcon === wrapped[i]?.secondaryRunIcon,
        )
      ) {
        return prev
      }
      return wrapped
    })
  }, [])

  const scrollToSection = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_L3', id })
    scrollFnRef.current(id)
  }, [])

  const registerScrollFn = useCallback((fn: (id: string) => void) => {
    scrollFnRef.current = fn
  }, [])

  const openCreateJournal = useCallback((opts?: CreateWizardOptions) => {
    createJournalFnRef.current?.(opts)
  }, [])

  const registerCreateJournal = useCallback((fn: (opts?: CreateWizardOptions) => void) => {
    createJournalFnRef.current = fn
  }, [])

  const peekTarget = navState.peekTarget ?? null

  const value: NavContextValue = useMemo(
    () => ({
      tree,
      navState,
      dispatch,
      peekTarget,
      openPeek,
      closePeek,
      l3Items,
      setL3Items,
      l3Connections,
      setL3Connections,
      l3Actions,
      setL3Actions,
      secondarySpec,
      setSecondarySpec,
      contextNav,
      setContextNav,
      streamControls,
      setStreamControls,
      analyticsControls,
      setAnalyticsControls,
      scrollToSection,
      registerScrollFn,
      openCreateJournal,
      registerCreateJournal,
    }),
    [
      tree,
      navState,
      peekTarget,
      openPeek,
      closePeek,
      l3Items,
      setL3Items,
      l3Connections,
      setL3Connections,
      l3Actions,
      setL3Actions,
      secondarySpec,
      setSecondarySpec,
      contextNav,
      setContextNav,
      streamControls,
      setStreamControls,
      analyticsControls,
      setAnalyticsControls,
      scrollToSection,
      registerScrollFn,
      openCreateJournal,
      registerCreateJournal,
    ],
  )
  return (
    <NavContext.Provider value={value}>
      {children}
    </NavContext.Provider>
  )
}
