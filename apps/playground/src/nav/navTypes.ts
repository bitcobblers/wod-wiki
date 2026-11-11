/**
 * navTypes.ts — Unified navigation type contract
 */

import type React from 'react'
import type { Location } from 'react-router-dom'

// ─── Canvas pipeline primitives ───────────────────────────────────────────────

/** Where the runtime opens when set-state: track fires. */
export type OpenMode = 'view' | 'dialog' | 'route'

export interface PipelineStep {
  action: string
  value: string
}

// ─── INavAction — discriminated union of all action types ────────────────────

/** Navigate to a new route. */
export interface RouteChangeAction {
  type: 'route'
  to: string
  pushHistory?: boolean
}

/** Update URL query params without a route change. */
export interface RouteQueryAction {
  type: 'query'
  params: Record<string, string | null>
  pushHistory?: boolean
}

/** Scroll the page to a named anchor. */
export interface ScrollAction {
  type: 'scroll'
  sectionId: string
}

/** Swap the sticky view panel's editor source content. */
export interface ViewSourceAction {
  type: 'view-source'
  source: string
}

/** Transition the view panel state machine. */
export interface ViewStateAction {
  type: 'view-state'
  state: 'note' | 'track' | 'review'
  open?: OpenMode
}

/** Execute a sequence of actions in order. */
export interface PipelineAction {
  type: 'pipeline'
  steps: INavAction[]
}

/** Invoke an arbitrary handler. */
export interface CallAction {
  type: 'call'
  handler: () => void
  label?: string
}

/** Open an external URL in a new tab. */
export interface ExternalLinkAction {
  type: 'external'
  href: string
}

/** No-op — for group headers. */
export interface NoneAction {
  type: 'none'
}

export type INavAction =
  | RouteChangeAction
  | RouteQueryAction
  | ScrollAction
  | ViewSourceAction
  | ViewStateAction
  | PipelineAction
  | CallAction
  | ExternalLinkAction
  | NoneAction

/** Legacy alias kept for existing NavItem/NavItemL3 usage. */
export type NavAction = INavAction

// ─── INavActivation — base interface for every activatable UI element ─────────

export interface INavActivation {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string; 'data-slot'?: string }>
  /** Absent on group nodes — an L1 section with children but no page of its own. */
  action?: INavAction
}

// ─── NavActionDeps — injected by each rendering surface ──────────────────────

export interface NavActionDeps {
  navigate:         (to: string, opts?: { replace?: boolean }) => void
  setQueryParam:    (params: Record<string, string | null>, replace?: boolean) => void
  scrollToSection?: (id: string) => void
  swapSource?:      (source: string) => void
  setPanelState?:   (state: 'note' | 'track' | 'review', open?: OpenMode) => void
}

/**
 * executeNavAction — single dispatch function for all rendering surfaces.
 */
export function executeNavAction(action: INavAction | undefined, deps: NavActionDeps): void {
  if (!action) return
  switch (action.type) {
    case 'route':
      deps.navigate(action.to, { replace: !(action.pushHistory ?? true) })
      break
    case 'query':
      deps.setQueryParam(action.params, !(action.pushHistory ?? false))
      break
    case 'scroll':
      deps.scrollToSection?.(action.sectionId)
      break
    case 'view-source':
      deps.swapSource?.(action.source)
      break
    case 'view-state':
      deps.setPanelState?.(action.state, action.open)
      break
    case 'pipeline': {
      const scrollSteps = action.steps.filter(step => step.type === 'scroll')
      const otherSteps = action.steps.filter(step => step.type !== 'scroll')
      otherSteps.forEach(step => executeNavAction(step, deps))
      if (scrollSteps.length > 0) {
        if (otherSteps.length > 0) {
          setTimeout(() => {
            scrollSteps.forEach(step => executeNavAction(step, deps))
          }, 0)
        } else {
          scrollSteps.forEach(step => executeNavAction(step, deps))
        }
      }
      break
    }
    case 'call':
      action.handler()
      break
    case 'external':
      window.open(action.href, '_blank', 'noopener,noreferrer')
      break
    case 'none':
      break
  }
}

// ─── Zone ────────────────────────────────────────────────────────────────────

export type NavZone =
  | 'mobile-bar'
  | 'sidebar'
  | 'page-header'
  | 'right-index'

// ─── Filter state slices ──────────────────────────────────────────────────────

export interface JournalFilterState {
  date: string | null
  tags: string[]
}

export interface SearchFilterState {
  scope: 'all' | 'feeds' | 'notes' | 'results'
}

// ─── Global nav state ─────────────────────────────────────────────────────────

export interface NavState {
  activeL1: string | null
  activeL2: string | null
  activeL3: string | null
  expanded: Set<string>
  leftDrawerOpen: boolean
  rightDrawerOpen: boolean
  journalFilter: JournalFilterState
  searchScope: SearchFilterState['scope']
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export type NavStateAction =
  | { type: 'SET_ACTIVE_L1';               id: string | null }
  | { type: 'SET_ACTIVE_L2';               id: string | null }
  | { type: 'SET_ACTIVE_L3';               id: string | null }
  | { type: 'TOGGLE_EXPANDED';             id: string }
  | { type: 'SET_LEFT_DRAWER';             open: boolean }
  | { type: 'SET_RIGHT_DRAWER';            open: boolean }
  | { type: 'SET_JOURNAL_DATE';            date: string | null }
  | { type: 'SET_JOURNAL_TAGS';            tags: string[] }
  | { type: 'SET_SEARCH_SCOPE';            scope: SearchFilterState['scope'] }

export type NavDispatch = React.Dispatch<NavStateAction>

// ─── Custom component props ───────────────────────────────────────────────────

export interface NavPanelProps {
  currentPath: string
  location: Location
}

export interface NavItemRenderProps {
  item: NavItem
  depth: number
  isActive: boolean
  isExpanded: boolean
  onClick: () => void
}

// ─── NavItem — universal link/node interface ──────────────────────────────────

export interface NavItem extends Omit<INavActivation, 'icon'> {
  id: string
  label: string
  children?: NavItem[]
  level?: number
  icon?: string | React.ComponentType<{ className?: string; 'data-slot'?: string }>
  isActive?: (loc: Location) => boolean
  badge?: string | number
  href?: string
  panel?: React.ComponentType<NavPanelProps>
  applyFooter?: boolean
  to?: string
  disabled?: boolean
  meta?: Record<string, unknown>
  pinned?: boolean
  onTogglePin?: () => void
}

// ─── L3 page-index item ───────────────────────────────────────────────────────

export interface NavItemL3 extends NavItem {
  isSection?: boolean
  level?: 3
  secondaryAction?: INavActivation
  secondaryRunIcon?: 'play' | 'stop' | 'link' | 'edit'
}

// ─── Canvas navigation helpers ─────────────────────────────────────────────────

/** Convert a single stringly-typed PipelineStep to a typed INavAction. */
export function pipelineStepToNavAction(step: PipelineStep, open: OpenMode = 'dialog'): INavAction {
  if (step.action === 'set-source') return { type: 'view-source', source: step.value }
  if (step.action === 'navigate') {
    if (/^https?:\/\//.test(step.value)) {
      return { type: 'external', href: step.value }
    }
    return { type: 'route', to: step.value }
  }
  if (step.action === 'set-state') {
    if (step.value === 'note')   return { type: 'view-state', state: 'note' }
    if (step.value === 'review') return { type: 'view-state', state: 'review' }
    if (step.value === 'track')  return { type: 'view-state', state: 'track', open }
  }
  return { type: 'none' }
}

/** Build an INavActivation from a canvas ButtonBlock or ViewButton. */
export function buttonToActivation(
  btn: { label: string; pipeline: PipelineStep[]; open?: OpenMode },
  idx: number,
): INavActivation {
  const steps = btn.pipeline.map(s => pipelineStepToNavAction(s, btn.open))
  return {
    id: `btn-${idx}`,
    label: btn.label,
    action: steps.length === 1 ? steps[0] : { type: 'pipeline', steps },
  }
}

/** True when an activation's action will launch the workout tracker. */
export function isRunActivation(activation: INavActivation): boolean {
  const { action } = activation
  if (!action) return false
  if (action.type === 'view-state') return action.state === 'track'
  if (action.type === 'pipeline') return action.steps.some(s => s.type === 'view-state' && (s as { state?: string }).state === 'track')
  return false
}
