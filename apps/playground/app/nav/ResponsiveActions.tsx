/**
 * ResponsiveActions — declare a page's actions once; render them inline on
 * desktop (lg+) and in the shared mobile thumb dock below lg.
 *
 * Composition model:
 *   - `ResponsiveActionsProvider` mounts once in SidebarLayout and owns the
 *     single mobile dock (fixed thumb-zone cluster: overflow sheet trigger +
 *     page primary + the search FAB, positioned per the fabAlignment
 *     preference). Pages never portal and never mount duplicate controls.
 *   - `<ResponsiveActions primary={…} label={…}>{actions}</ResponsiveActions>`
 *     in a page header renders inline on desktop and REGISTERS with the dock
 *     on mobile, where its children surface in the dock's overflow sheet
 *     (mounted lazily, only while the sheet is open). Page-only: the sheet
 *     never carries global chrome.
 *   - `navbar={…}` pins an action to the app navbar on mobile (beside the
 *     cast button, surfaced via `<NavbarActions />`); it still renders
 *     inline on desktop. For mode toggles that must never hide in the dock.
 *   - GLOBAL chrome (cast, page options with the L3 index) does NOT ride the
 *     dock — it lives in the header at every breakpoint: the page's
 *     PageActions bar on desktop, the app navbar cluster on mobile (see
 *     App.tsx Navbar).
 *   - Nesting: an inner ResponsiveActions inside an outer one renders inline
 *     only and never registers — a page's outer wrapper is the single
 *     registration point.
 *   - Standalone (no provider, e.g. Storybook/tests): renders inline on all
 *     viewports.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { EllipsisVerticalIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { cn } from '@/lib/utils'
import { useIsMobile } from '../hooks/useIsMobile'
import { useVisualViewportRect } from '@bitcobblers/wod-wiki-ui';
import { useFabAlignment } from '../lib/fabAlignment'
import { SearchFab } from './SearchFab'

// ── Registration ─────────────────────────────────────────────────────────────

interface ActionsRegistration {
  id: string
  primary?: ReactNode
  navbar?: ReactNode
  children?: ReactNode
  label: string
  fallback: boolean
}

interface ActionsRegistry {
  register: (entry: ActionsRegistration) => void
  unregister: (id: string) => void
}

const RegistryContext = createContext<ActionsRegistry | null>(null)
const InsideActionsContext = createContext(false)
/** The active page's navbar-pinned action, rendered by `<NavbarActions />`. */
const NavbarActionsContext = createContext<ReactNode>(null)

/** True when rendered inside a ResponsiveActionsProvider (app shell). */
export function useInResponsiveActionsProvider(): boolean {
  return useContext(RegistryContext) !== null
}

export interface ResponsiveActionsProps {
  /** The page's single primary action — dock FAB on mobile, inline on desktop. */
  primary?: ReactNode
  /** Action pinned to the app navbar on mobile (beside cast) instead of
   *  the thumb dock; renders inline on desktop. */
  navbar?: ReactNode
  /** Remaining page actions — dock overflow sheet on mobile, inline on desktop. */
  children?: ReactNode
  /** Accessible name for the mobile overflow group (defaults to 'Page options'). */
  label?: string
  /**
   * Global Page options: renders nothing inline; its children merge into
   * every page's dock sheet (below the page rows, under a rule) and serve
   * as the sheet's sole contents on pages that declare no actions. Mount
   * once inside the provider, near the app root.
   */
  fallback?: boolean
}
export function ResponsiveActions({
  primary,
  navbar,
  children,
  label,
  fallback = false,
}: ResponsiveActionsProps) {
  const registry = useContext(RegistryContext)
  const nested = useContext(InsideActionsContext)
  const isMobile = useIsMobile()
  const id = useId()

  const registers = registry !== null && !nested && isMobile && !fallback
  const fallbackRegisters = registry !== null && fallback

  // Registered children carry the nesting marker so a ResponsiveActions
  // declared INSIDE another's children renders inline (within the sheet)
  // and never registers — the outer wrapper stays the single owner.
  const registeredChildren = (
    <InsideActionsContext.Provider value={true}>
      {children}
    </InsideActionsContext.Provider>
  )

  useEffect(() => {
    if (!registers && !fallbackRegisters) return
    registry!.register({ id, primary, navbar, children: registeredChildren, label: label ?? 'Page options', fallback })
    return () => registry!.unregister(id)
  }, [registers, fallbackRegisters, registry, id, primary, registeredChildren, label, fallback])

  // Fallback never renders inline (desktop keeps its existing header
  // affordances); below lg the dock owns the surface.
  if (fallback) return null
  // Inside the provider on mobile the dock owns rendering; standalone (no
  // provider) always renders inline so Storybook/tests keep working.
  if (registry && isMobile && !nested) return null
  return (
    <InsideActionsContext.Provider value={true}>
      <div className="flex items-center gap-2">
        {navbar}
        {primary}
        {children}
      </div>
    </InsideActionsContext.Provider>
  )
}

// ── Provider + dock ──────────────────────────────────────────────────────────

export interface ResponsiveActionsProviderProps {
  /** Opens the global search palette — integrated into the dock's search FAB. */
  onSearch?: () => void
  children?: ReactNode
}

export function ResponsiveActionsProvider({ onSearch, children }: ResponsiveActionsProviderProps) {
  const [registrations, setRegistrations] = useState<ActionsRegistration[]>([])
  const register = useCallback(
    (entry: ActionsRegistration) =>
      setRegistrations(prev => [...prev.filter(r => r.id !== entry.id), entry]),
    [],
  )
  const unregister = useCallback(
    (id: string) => setRegistrations(prev => prev.filter(r => r.id !== id)),
    [],
  )
  const registry = useMemo(() => ({ register, unregister }), [register, unregister])

  // Most recent page registration wins (mirrors the dock's `active` rule).
  const activeNav = useMemo(() => {
    for (let i = registrations.length - 1; i >= 0; i -= 1) {
      if (!registrations[i].fallback) return registrations[i].navbar ?? null
    }
    return null
  }, [registrations])

  return (
    <RegistryContext.Provider value={registry}>
      <NavbarActionsContext.Provider value={activeNav}>
        {children}
        <ResponsiveActionsDock registrations={registrations} onSearch={onSearch} />
      </NavbarActionsContext.Provider>
    </RegistryContext.Provider>
  )
}

/**
 * Navbar mount point for page-pinned actions — render beside the cast
 * button in the app header. Surfaces the active page's `navbar` action
 * below lg; renders nothing on desktop, where page headers own actions.
 */
export function NavbarActions() {
  const action = useContext(NavbarActionsContext)
  return action ? <>{action}</> : null
}

/**
 * The single mounted mobile action row. Stays within document flow so it
 * cannot cover or intercept editable fields; sticky bottom alignment keeps
 * it reachable without a fixed overlay. Renders nothing on desktop — page
 * headers own actions there. Stack, top to bottom: page primary, search FAB,
 * overflow sheet (slides up from the ⋮), ⋮ trigger at the corner. The ⋮
 * renders only when the sheet has real rows — measured live from the
 * always-mounted (hidden while closed) sheet — so empty pages never show it.
 */

function ResponsiveActionsDock({
  registrations,
  onSearch,
}: {
  registrations: ActionsRegistration[]
  onSearch?: () => void
}) {
  const isMobile = useIsMobile()
  const [alignment] = useFabAlignment()
  const viewport = useVisualViewportRect()
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  const activeContentRef = useRef<HTMLDivElement>(null)
  const globalContentRef = useRef<HTMLDivElement>(null)
  // Most recent page registration wins; the most recent fallback supplies
  // the global Page options rows merged into every page's sheet.
  const active = useMemo(() => {
    for (let i = registrations.length - 1; i >= 0; i -= 1) {
      if (!registrations[i].fallback) return registrations[i]
    }
    return undefined
  }, [registrations])
  const globalActions = useMemo(() => {
    for (let i = registrations.length - 1; i >= 0; i -= 1) {
      if (registrations[i].fallback) return registrations[i]
    }
    return undefined
  }, [registrations])


  // Focus the sheet when it opens so keyboard users land inside it.
  useLayoutEffect(() => {
    if (sheetOpen) sheetRef.current?.focus()
  }, [sheetOpen])

  // The sheet stays mounted (hidden while closed) so its rows are countable
  // live: the ⋮ trigger must never appear for sheets with no rows — same
  // rule as the sticky header's ⋮, without the old open-then-flash
  // measurement. `display:contents` wrappers keep the registrations
  // layout-neutral while making each countable.
  const [rowCounts, setRowCounts] = useState({ active: 0, global: 0 })
  useLayoutEffect(() => {
    const activeRows = activeContentRef.current?.childElementCount ?? 0
    const globalRows = globalContentRef.current?.childElementCount ?? 0
    setRowCounts(prev =>
      prev.active === activeRows && prev.global === globalRows ? prev : { active: activeRows, global: globalRows },
    )
  }, [active, globalActions])
  const showOverflow = rowCounts.active > 0 || rowCounts.global > 0

  if (!isMobile) return null
  if (!onSearch && !active && !globalActions) return null


  return (
    <div
      data-testid="actions-dock"
      className={cn(
        'lg:hidden relative z-40 mt-4 flex flex-col items-center gap-2',
        'transition-[transform,visibility] duration-200 ease-out',
        alignment === 'left' ? 'self-start items-start' : 'self-end items-end',
      )}
    >
      {/* Page primary on top, search FAB under it. */}
      <div className="relative z-40 flex flex-col items-center gap-2">
        {active?.primary && (
          <div className="[&_button]:min-h-11 [&_button]:min-w-11">{active.primary}</div>
        )}
        {onSearch && <SearchFab onOpen={() => { setSheetOpen(false); onSearch() }} />}
      </div>

      {/* Overflow sheet slides up from the ⋮: rows sit underneath the
          buttons, directly above the trigger. Always mounted (hidden while
          closed) so the trigger's visibility is measured live — pages with
          no rows never get a ⋮, matching the sticky header. Page rows stack
          first at ≥44px touch targets; the global Page options rows
          (secondary nav, On this page, download) follow under a rule. Cast
          lives in the navbar, never here. */}
      {sheetOpen && showOverflow && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="fixed inset-0 z-30 cursor-default"
          onClick={() => setSheetOpen(false)}
        />
      )}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={active?.label ?? globalActions?.label ?? 'Page options'}
        tabIndex={-1}
        hidden={!sheetOpen || !showOverflow}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setSheetOpen(false)
          }
        }}
        className={cn(
          'relative z-40 flex w-60 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-2xl bg-card p-3 shadow-xl ring-1 ring-foreground/5 outline-none',
          '[&_button]:min-h-11 [&_button]:min-w-11',
        )}
        style={{ maxHeight: `calc(${viewport.height === null ? '100dvh' : `${viewport.height}px`} - 6rem - env(safe-area-inset-bottom))` }}
      >
        <div ref={activeContentRef} className="contents">
          {active?.children}
        </div>
        {rowCounts.active > 0 && rowCounts.global > 0 && (
          <div className="my-1 border-t border-border/60" aria-hidden="true" />
        )}
        <div ref={globalContentRef} className="contents">
          {globalActions?.children}
        </div>
      </div>

      {showOverflow && (
        <button
          type="button"
          onClick={() => setSheetOpen(open => !open)}
          aria-label={active?.label ?? globalActions?.label ?? 'Page options'}
          title={active?.label ?? globalActions?.label ?? 'Page options'}
          aria-expanded={sheetOpen}
          data-testid="actions-overflow"
          className={cn(
            'relative z-40 flex size-12 items-center justify-center rounded-full',
            'bg-card text-foreground shadow-lg ring-1 ring-foreground/10',
            'hover:bg-muted active:scale-95 transition-all',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          )}
        >
          {sheetOpen ? <XMarkIcon className="size-6" /> : <EllipsisVerticalIcon className="size-6" />}
          <span className="sr-only">{active?.label ?? globalActions?.label ?? 'Page options'}</span>
        </button>
      )}
    </div>
  )
}
