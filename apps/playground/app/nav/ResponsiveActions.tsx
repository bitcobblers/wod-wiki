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
  Children,
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
import { TEST_IDS } from '@/lib/testIds'
import { useIsMobile } from '../hooks/useIsMobile'
import { useVisualViewportRect } from '@bitcobblers/wod-wiki-ui';
import { useFabAlignment } from '../lib/fabAlignment'
import { NavigationDrawerProvider } from './NavigationDrawerContext'
import { SearchFab } from './SearchFab'

// ── Registration ─────────────────────────────────────────────────────────────

interface ActionsRegistration {
  id: string
  primary?: ReactNode
  navbar?: ReactNode
  children?: ReactNode
  hasContent: boolean
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

  const hasContent = Children.toArray(children).length > 0
  const registeredChildren = useMemo(() => (
    <InsideActionsContext.Provider value={true}>
      {children}
    </InsideActionsContext.Provider>
  ), [children])
  const canRegister = registers || fallbackRegisters
  const entryRef = useRef<ActionsRegistration | null>(null)
  entryRef.current = { id, primary, navbar, children: registeredChildren, hasContent, label: label ?? 'Page options', fallback }

  // Ownership changes only on mount/unmount or breakpoint transitions. Content
  // updates must not unregister first: that provider update used to retrigger
  // this effect until React hit its maximum update depth.
  useEffect(() => {
    if (!canRegister) return
    registry!.register(entryRef.current!)
    return () => registry!.unregister(id)
  }, [canRegister, registry, id])

  useEffect(() => {
    if (canRegister) registry!.register(entryRef.current!)
  }, [canRegister, registry, primary, navbar, registeredChildren, hasContent, label, fallback])

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
      setRegistrations(prev => {
        const idx = prev.findIndex(r => r.id === entry.id)
        if (idx === -1) {
          return [...prev, entry]
        }
        const existing = prev[idx]
        if (
          existing.primary === entry.primary &&
          existing.navbar === entry.navbar &&
          existing.children === entry.children &&
          existing.hasContent === entry.hasContent &&
          existing.label === entry.label &&
          existing.fallback === entry.fallback
        ) {
          return prev
        }
        const next = [...prev]
        next[idx] = entry
        return next
      }),
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
 * The single mounted mobile dock. Fixed thumb-zone cluster anchored to the
 * fabAlignment corner; lifts above MobileQueryFooter via `--thumb-dock-lift`
 * and respects bottom safe-area insets. Renders nothing on desktop — page
 * headers own actions there. Auto-yields (`invisible pointer-events-none`)
 * whenever mobile editor decks, `results-mobile-bar`, or visible
 * `.cm-frontmatter-preview` inputs occupy its corner footprint. Stack, top to
 * bottom: overflow sheet (expands upward above the controls), search FAB,
 * page primary, ⋮ trigger at the corner. The ⋮ renders only when registered
 * page/fallback children exist.
 */

function testIdSelector(testId: string): string {
  return `[${'data-testid'}="${testId}"]`
}

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
  const [yieldToOverlay, setYieldToOverlay] = useState(false)
  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const sheetId = useId()
  const dockRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const activeContentRef = useRef<HTMLDivElement>(null)
  const globalContentRef = useRef<HTMLDivElement>(null)
  const sheetOpenRef = useRef(sheetOpen)
  sheetOpenRef.current = sheetOpen
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

  const evaluateYield = useCallback(() => {
    if (typeof document === 'undefined' || !isMobile) {
      setYieldToOverlay((prev) => (prev ? false : prev))
      return
    }
    const hasEditorOverlay = Boolean(
      document.querySelector(
        `${testIdSelector(TEST_IDS.MOBILE_WHEEL_COMPOSER)}, ${testIdSelector(TEST_IDS.MOBILE_TYPING_BAR)}`,
      ),
    )
    if (hasEditorOverlay) {
      setSheetOpen((open) => (open ? false : open))
      setYieldToOverlay((prev) => (prev ? prev : true))
      return
    }
    const resultsBar = document.querySelector<HTMLElement>(testIdSelector(TEST_IDS.RESULTS_MOBILE_BAR))
    if (resultsBar && !resultsBar.hidden) {
      const rcs = window.getComputedStyle(resultsBar)
      if (rcs.display !== 'none' && rcs.visibility !== 'hidden') {
        setSheetOpen((open) => (open ? false : open))
        setYieldToOverlay((prev) => (prev ? prev : true))
        return
      }
    }
    if (!sheetOpenRef.current && dockRef.current) {
      const dr = dockRef.current.getBoundingClientRect()
      if (dr.width > 0 && dr.height > 0) {
        const inputs = document.querySelectorAll<HTMLInputElement>('.cm-frontmatter-preview input')
        for (const input of inputs) {
          const ir = input.getBoundingClientRect()
          if (ir.width <= 4 || ir.height <= 4) continue
          if (
            ir.bottom <= 0 ||
            ir.top >= window.innerHeight ||
            ir.right <= 0 ||
            ir.left >= window.innerWidth
          ) {
            continue
          }
          const ics = window.getComputedStyle(input)
          if (ics.display === 'none' || ics.visibility === 'hidden') continue
          const overlaps =
            ir.left < dr.right + 4 &&
            dr.left - 4 < ir.right &&
            ir.top < dr.bottom + 4 &&
            dr.top - 4 < ir.bottom
          if (overlaps) {
            setYieldToOverlay((prev) => (prev ? prev : true))
            return
          }
        }
      }
    }
    setYieldToOverlay((prev) => (prev ? false : prev))
  }, [isMobile])

  useLayoutEffect(() => {
    evaluateYield()
  }, [evaluateYield, alignment, sheetOpen, active, globalActions, onSearch, viewport.height])

  useEffect(() => {
    if (!isMobile || typeof document === 'undefined' || !document.body) return
    evaluateYield()
    const observer = new MutationObserver((mutations) => {
      if (dockRef.current && mutations.every((m) => dockRef.current!.contains(m.target))) {
        return
      }
      evaluateYield()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
    })
    const rootObserver = new MutationObserver(() => {
      evaluateYield()
    })
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })
    window.addEventListener('scroll', evaluateYield, { passive: true, capture: true })
    window.addEventListener('resize', evaluateYield, { passive: true })
    const vv = window.visualViewport
    vv?.addEventListener('resize', evaluateYield)
    vv?.addEventListener('scroll', evaluateYield)
    return () => {
      observer.disconnect()
      rootObserver.disconnect()
      window.removeEventListener('scroll', evaluateYield, { capture: true })
      window.removeEventListener('resize', evaluateYield)
      vv?.removeEventListener('resize', evaluateYield)
      vv?.removeEventListener('scroll', evaluateYield)
    }
  }, [isMobile, evaluateYield])

  // Focus the sheet when it opens so keyboard users land inside it.
  useLayoutEffect(() => {
    if (sheetOpen) sheetRef.current?.focus({ preventScroll: true })
  }, [sheetOpen])

  // Registration is the overflow contract: libraries publish stream controls,
  // other routes publish page options. Do not measure live DOM rows here —
  // asynchronous L2/L3 content can otherwise retrigger registration endlessly.
  const showOverflow = Boolean(active?.hasContent || globalActions?.hasContent)

  if (!isMobile) return null
  if (!onSearch && !active && !globalActions) return null

  const viewportHeightCss = viewport.height === null ? '100dvh' : `${viewport.height}px`

  return (
    <div
      ref={dockRef}
      data-testid="actions-dock"
      aria-hidden={yieldToOverlay || undefined}
      className={cn(
        'fixed z-30 lg:hidden flex flex-col gap-2 w-auto',
        'transition-opacity duration-150 ease-out',
        alignment === 'left' ? 'left-4 items-start' : 'right-4 items-end',
        yieldToOverlay && 'invisible pointer-events-none',
      )}
      style={{
        bottom: 'calc(1rem + var(--thumb-dock-lift, 0px) + env(safe-area-inset-bottom, 0px))',
        maxHeight: `calc(${viewportHeightCss} - 2rem - var(--thumb-dock-lift, 0px) - env(safe-area-inset-bottom, 0px))`,
      }}
    >
      {/* Overflow sheet expands upward above the primary/search/trigger stack.
          Always mounted (hidden while closed) without exposing role="dialog"
          until open (WW-087). Page rows stack first at ≥44px touch targets;
          global Page options rows follow under a rule. */}
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
        id={sheetId}
        ref={sheetRef}
        role={sheetOpen && showOverflow ? 'dialog' : undefined}
        aria-modal={sheetOpen && showOverflow ? true : undefined}
        aria-label={sheetOpen && showOverflow ? (active?.label ?? globalActions?.label ?? 'Page options') : undefined}
        tabIndex={-1}
        hidden={!sheetOpen || !showOverflow}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setSheetOpen(false)
          }
        }}
        className={cn(
          sheetOpen && showOverflow ? 'flex' : 'hidden',
          'relative z-40 min-h-0 w-60 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-2xl bg-card p-3 shadow-xl ring-1 ring-foreground/5 outline-none',
          '[&_button]:min-h-11 [&_button]:min-w-11',
        )}
        style={{
          maxHeight: `calc(${viewportHeightCss} - 8rem - var(--thumb-dock-lift, 0px) - env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <NavigationDrawerProvider close={closeSheet}>
          <div ref={activeContentRef} className="contents">
            {active?.children}
          </div>
          {active?.children && globalActions?.children && (
            <div className="my-1 border-t border-border/60" aria-hidden="true" />
          )}
          <div ref={globalContentRef} className="contents">
            {globalActions?.children}
          </div>
        </NavigationDrawerProvider>
      </div>

      {/* Bottom-up: Search, contextual primary, then the ⋮ trigger at the corner. */}
      {(onSearch || active?.primary) && (
        <div
          className={cn(
            'relative z-40 flex shrink-0 flex-col gap-2',
            alignment === 'left' ? 'items-start' : 'items-end',
          )}
        >
          {onSearch && <SearchFab onOpen={() => { setSheetOpen(false); onSearch() }} />}
          {active?.primary && (
            <div className="[&_button]:min-h-11 [&_button]:min-w-11">{active.primary}</div>
          )}
        </div>
      )}

      {showOverflow && (
        <button
          type="button"
          onClick={() => setSheetOpen(open => !open)}
          aria-label={active?.label ?? globalActions?.label ?? 'Page options'}
          title={active?.label ?? globalActions?.label ?? 'Page options'}
          aria-expanded={sheetOpen}
          aria-controls={sheetId}
          data-testid="actions-overflow"
          className={cn(
            'relative z-40 flex size-12 shrink-0 items-center justify-center rounded-full',
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
