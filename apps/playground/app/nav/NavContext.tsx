/**
 * NavContext — global navigation state shared across all zones.
 *
 * Provides:
 *   navState  — selection, filter, drawer open/close
 *   dispatch  — typed action dispatcher
 *   l3Items   — current page's scroll-anchor index (injected by route components)
 *   setL3Items — called by AppContent (or future per-page hooks) to update L3
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
} from 'react'
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import type {
  NavItem,
  NavItemL3,
  NavState,
  NavStateAction,
  NavDispatch,
} from './navTypes'
import type { MenuSpec } from './menuModel'
import type { EntityLevel } from '../lib/fieldProjection'
import type { LayoutMode, ViewSettings } from '../lib/viewSettingsStorage'

// ─── Initial State ────────────────────────────────────────────────────────────

export const initialNavState: NavState = {
  activeL1Id: null,
  activeL2Id: null,
  activeL3Id: null,
  leftDrawerOpen: false,
  rightDrawerOpen: false,
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
    case 'SET_RIGHT_DRAWER': return state.rightDrawerOpen === action.open ? state : { ...state, rightDrawerOpen: action.open }
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

export interface StreamNavControls {
  query: string
  onQueryChange: (wql: string) => void
  groupDims: string[]
  onToggleGroupDim: (dim: string) => void
  availableGroupDims: { id: string; label: string }[]
  /** Per-route view settings (layout + visible fields), published so the
   *  L3 rail and ⋯ fallbacks carry view controls (plus the where-filter
   *  accordion via FacetProperties). Cast stays header-only chrome. */
  settings: ViewSettings
  onLayoutChange: (layout: LayoutMode) => void
  onToggleField: (fieldId: string) => void
  level: EntityLevel
  /**
   * The layouts this surface can actually render, in picker order. Absent =
   * every layout. The calendar layouts (Agenda / Planner) are offered only
   * where the entries carry dates — a picker that offers a layout the page
   * cannot render is a dead button.
   */
  availableLayouts?: readonly LayoutMode[]
  /** Open this surface's query settings (landing default, scope and Group-By
   *  favorites, saved shortcuts). Published only by surfaces that HAVE a
   *  configurable surface — absent means the page offers none. */
  onOpenQuerySettings?: () => void
}

/** Route-scoped static L2 content registered by a page (e.g. note
 *  relationships). The sidebar renders it instead of the active L1's panel
 *  while `pathname` matches the current location. */
export interface ContextNav {
  pathname: string
  spec: MenuSpec
}

export interface NavContextValue {
  tree: NavItem[]
  navState: NavState
  dispatch: NavDispatch
  l3Items: NavItemL3[]
  setL3Items: (items: NavItemL3[]) => void
  secondarySpec?: MenuSpec
  setSecondarySpec: (spec?: MenuSpec) => void
  contextNav?: ContextNav
  setContextNav: (nav?: ContextNav | ((prev?: ContextNav) => ContextNav | undefined)) => void
  streamControls?: StreamNavControls | null
  setStreamControls: (controls: StreamNavControls | null) => void
  scrollToSection: (id: string) => void
  /**
   * Register a custom scroll-to handler. Called by AppContent so the sidebar
   * can scroll into editor (CodeMirror) content that lives outside the DOM.
   * Falls back to standard DOM getBoundingClientRect scroll.
   */
  registerScrollFn: (fn: (id: string) => void) => void
  openCreateJournal: (opts?: { mode?: 'blank' | 'notebook' | 'source' }) => void
  registerCreateJournal: (fn: (opts?: { mode?: 'blank' | 'notebook' | 'source' }) => void) => void
}

const defaultScroll = (id: string) => {
  const el = document.getElementById(id)
  if (el) {
    const y = el.getBoundingClientRect().top + window.scrollY - 80
    window.scrollTo({ top: y, behavior: 'smooth' })
  }
}

export const NavContext = createContext<NavContextValue>({
  tree: [],
  navState: initialNavState,
  dispatch: () => {},
  l3Items: [],
  setL3Items: () => {},
  secondarySpec: undefined,
  setSecondarySpec: () => {},
  contextNav: undefined,
  setContextNav: () => {},
  streamControls: null,
  setStreamControls: () => {},
  scrollToSection: defaultScroll,
  registerScrollFn: () => {},
  openCreateJournal: () => {},
  registerCreateJournal: () => {},
})

export function useNav() {
  return useContext(NavContext)
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

export function NavProvider({ tree, children }: NavProviderProps) {
  const [navState, dispatch] = useReducer(navReducer, initialNavState)
  const [l3Items, setL3ItemsInternal] = useState<NavItemL3[]>([])
  const [secondarySpec, setSecondarySpecInternal] = useState<MenuSpec | undefined>(undefined)
  const [contextNav, setContextNavInternal] = useState<ContextNav | undefined>(undefined)
  const [streamControls, setStreamControlsInternal] = useState<StreamNavControls | null>(null)

  const setSecondarySpec = useCallback((next?: MenuSpec) => {
    setSecondarySpecInternal(prev => (prev === next ? prev : next))
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
  const location = useLocation()

  // Mutable ref so AppContent can override scroll behaviour without re-rendering
  const scrollFnRef = useRef<(id: string) => void>(defaultScroll)
  const createJournalFnRef = useRef<((opts?: { mode?: 'blank' | 'notebook' | 'source' }) => void) | null>(null)
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

  // Close left drawer on route change. Stream controls are NOT cleared here:
  // this effect fires after children on mount/update, which would wipe the
  // stream view's just-published controls (child effects run first, so the
  // pathname clear always won the race). The stream view's own unmount
  // cleanup clears them when the route actually leaves the stream.
  useEffect(() => {
    dispatch({ type: 'SET_LEFT_DRAWER', open: false })
  }, [location.pathname])
  const setL3Items = useCallback((items: NavItemL3[]) => {
    setL3ItemsInternal((prev) => {
      if (
        prev.length === items.length &&
        prev.every(
          (item, i) =>
            item.id === items[i]?.id &&
            item.label === items[i]?.label &&
            item.secondaryAction?.id === items[i]?.secondaryAction?.id &&
            item.secondaryRunIcon === items[i]?.secondaryRunIcon,
        )
      ) {
        return prev
      }
      return items
    })
  }, [])
  const scrollToSection = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_L3', id })
    scrollFnRef.current(id)
  }, [])

  const registerScrollFn = useCallback((fn: (id: string) => void) => {
    scrollFnRef.current = fn
  }, [])

  const openCreateJournal = useCallback((opts?: { mode?: 'blank' | 'notebook' | 'source' }) => {
    createJournalFnRef.current?.(opts)
  }, [])

  const registerCreateJournal = useCallback((fn: (opts?: { mode?: 'blank' | 'notebook' | 'source' }) => void) => {
    createJournalFnRef.current = fn
  }, [])
  const value: NavContextValue = useMemo(
    () => ({
      tree,
      navState,
      dispatch,
      l3Items,
      setL3Items,
      secondarySpec,
      setSecondarySpec,
      contextNav,
      setContextNav,
      streamControls,
      setStreamControls,
      scrollToSection,
      registerScrollFn,
      openCreateJournal,
      registerCreateJournal,
    }),
    [tree, navState, l3Items, setL3Items, secondarySpec, setSecondarySpec, contextNav, setContextNav, streamControls, setStreamControls, scrollToSection, registerScrollFn, openCreateJournal, registerCreateJournal],
  )
  return (
    <NavContext.Provider value={value}>
      {children}
    </NavContext.Provider>
  )
}
