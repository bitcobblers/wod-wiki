/**
 * ResponsiveActions — declare a page's actions once; render them inline on
 * desktop (lg+) and in the shared mobile thumb dock below lg.
 *
 * Composition model:
 *   - `ResponsiveActionsProvider` mounts once in SidebarLayout and owns the
 *     single mobile dock (fixed thumb-zone cluster: unified overflow + L3 sheet
 *     trigger + contextual page primary + SearchFab, positioned per the
 *     fabAlignment preference). Pages never portal and never mount duplicate
 *     controls.
 *   - `<ResponsiveActions primary={…} label={…}>{actions}</ResponsiveActions>`
 *     in a page header renders inline on desktop and REGISTERS with the dock
 *     on mobile, where its children merge with `SecondaryNav` (L3 outline,
 *     connections, grouped actions) inside ONE bottom sheet mounted lazily only
 *     while open.
 *   - `navbar={…}` pins an action to the app navbar on mobile (beside the
 *     cast button, surfaced via `<NavbarActions />`); it still renders
 *     inline on desktop. For mode toggles that must never hide in the dock.
 *   - Stream routes have 0px L3, so no L3 corner trigger appears on streams
 *     unless page/fallback overflow children exist.
 *   - Auto-yields (`invisible pointer-events-none`) whenever mobile editor
 *     decks (`MOBILE_WHEEL_COMPOSER`, `MOBILE_TYPING_BAR`), `RESULTS_MOBILE_BAR`,
 *     virtual keyboard (`>100px`), active mobile peek/inspector drawer, or
 *     overlapping `.cm-frontmatter-preview` inputs occupy its footprint.
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
import { useVisualViewportRect } from '@bitcobblers/wod-wiki-ui'
import { useFabAlignment } from '../lib/fabAlignment'
import type { MenuSpec } from './menuModel'
import { useOptionalNav } from './NavContext'
import { NavigationDrawerProvider } from './NavigationDrawerContext'
import { SearchFab } from './SearchFab'
import { SecondaryNav, useL3HasContent } from './SecondaryNav'

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

interface DockContextValue {
  registrations: ActionsRegistration[]
  onSearch?: () => void
  secondarySpec?: MenuSpec
  pageAction?: ReactNode
}

const RegistryContext = createContext<ActionsRegistry | null>(null)
const InsideActionsContext = createContext(false)
/** The active page's navbar-pinned action, rendered by `<NavbarActions />`. */
const NavbarActionsContext = createContext<ReactNode>(null)
const DockContext = createContext<DockContextValue | null>(null)

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
  /** Whether the provider renders the dock directly (default true). Set false
   *  when the layout shell mounts `<ResponsiveActionsDockPort />` inside `<main>`. */
  renderDock?: boolean
  /** Route-declared L3 secondary spec unified into the mobile bottom sheet. */
  secondarySpec?: MenuSpec
  /** Per-page L3 action row (e.g. Download Markdown) unified into the mobile bottom sheet. */
  pageAction?: ReactNode
  children?: ReactNode
}

export function ResponsiveActionsProvider({
  onSearch,
  renderDock = true,
  secondarySpec,
  pageAction,
  children,
}: ResponsiveActionsProviderProps) {
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

  const dockValue = useMemo<DockContextValue>(
    () => ({ registrations, onSearch, secondarySpec, pageAction }),
    [registrations, onSearch, secondarySpec, pageAction],
  )

  return (
    <RegistryContext.Provider value={registry}>
      <NavbarActionsContext.Provider value={activeNav}>
        <DockContext.Provider value={dockValue}>
          {children}
          {renderDock && (
            <ResponsiveActionsDock
              registrations={registrations}
              onSearch={onSearch}
              secondarySpec={secondarySpec}
              pageAction={pageAction}
            />
          )}
        </DockContext.Provider>
      </NavbarActionsContext.Provider>
    </RegistryContext.Provider>
  )
}

/** Mounts the registered mobile thumb dock inside the shell's `<main>` landmark. */
export function ResponsiveActionsDockPort() {
  const ctx = useContext(DockContext)
  if (!ctx) return null
  return (
    <ResponsiveActionsDock
      registrations={ctx.registrations}
      onSearch={ctx.onSearch}
      secondarySpec={ctx.secondarySpec}
      pageAction={ctx.pageAction}
    />
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

function testIdSelector(testId: string): string {
  return `[${'data-testid'}="${testId}"]`
}

/**
 * The single mounted mobile dock. Fixed thumb-zone cluster anchored to the
 * fabAlignment corner; lifts above MobileQueryFooter via `--thumb-dock-lift`
 * and respects bottom safe-area insets. Renders nothing on desktop — page
 * headers and inline/slide-over L3 own actions there. Auto-yields
 * (`invisible pointer-events-none`) whenever mobile editor decks,
 * `results-mobile-bar`, active peek/inspector overlay, or visible
 * `.cm-frontmatter-preview` inputs occupy its corner footprint. Stack, top to
 * bottom: unified overflow + L3 sheet (expands upward above the controls),
 * SearchFab + contextual page primary, ⋮ corner trigger.
 */
function ResponsiveActionsDock({
  registrations,
  onSearch,
  secondarySpec,
  pageAction,
}: DockContextValue) {
  const isMobile = useIsMobile()
  const [alignment] = useFabAlignment()
  const viewport = useVisualViewportRect()
  const nav = useOptionalNav()
  const hasL3Content = useL3HasContent(secondarySpec, pageAction)
  const navRightDrawerOpen = Boolean(nav?.navState?.rightDrawerOpen)
  const navInspectorOpen = Boolean(nav?.navState?.inspectorDrawerOpen || nav?.peekTarget)
  const navDispatch = nav?.dispatch
  const resetAnalytics = nav?.analyticsControls?.onReset

  const [localSheetOpen, setLocalSheetOpen] = useState(false)
  const [yieldToOverlay, setYieldToOverlay] = useState(false)
  const sheetOpen = localSheetOpen || navRightDrawerOpen

  const closeSheet = useCallback(() => {
    setLocalSheetOpen(false)
    if (navRightDrawerOpen) {
      navDispatch?.({ type: 'SET_RIGHT_DRAWER', open: false })
    }
  }, [navRightDrawerOpen, navDispatch])

  const toggleSheet = useCallback(() => {
    if (sheetOpen) {
      closeSheet()
    } else {
      setLocalSheetOpen(true)
    }
  }, [sheetOpen, closeSheet])

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
    if (navInspectorOpen) {
      setLocalSheetOpen((open) => (open ? false : open))
      setYieldToOverlay((prev) => (prev ? prev : true))
      return
    }
    const hasEditorOverlay = Boolean(
      document.querySelector(
        `${testIdSelector(TEST_IDS.MOBILE_WHEEL_COMPOSER)}, ${testIdSelector(TEST_IDS.MOBILE_TYPING_BAR)}`,
      ),
    )
    if (hasEditorOverlay) {
      setLocalSheetOpen((open) => (open ? false : open))
      setYieldToOverlay((prev) => (prev ? prev : true))
      return
    }
    const vv = window.visualViewport
    if (vv && window.innerHeight - (vv.height + vv.offsetTop) > 100) {
      setLocalSheetOpen((open) => (open ? false : open))
      setYieldToOverlay((prev) => (prev ? prev : true))
      return
    }
    const resultsBar = document.querySelector<HTMLElement>(testIdSelector(TEST_IDS.RESULTS_MOBILE_BAR))
    if (resultsBar && !resultsBar.hidden) {
      const rcs = window.getComputedStyle(resultsBar)
      if (rcs.display !== 'none' && rcs.visibility !== 'hidden') {
        setLocalSheetOpen((open) => (open ? false : open))
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
  }, [isMobile, navInspectorOpen])

  useLayoutEffect(() => {
    evaluateYield()
  }, [evaluateYield, alignment, sheetOpen, active, globalActions, onSearch, viewport.height, hasL3Content])

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

  // Overflow shows whenever page/fallback rows OR L3 detail/board content exist.
  const showOverflow = Boolean(active?.hasContent || globalActions?.hasContent || hasL3Content)
  const sheetLabel = active?.hasContent
    ? active.label
    : globalActions?.hasContent
      ? globalActions.label
      : 'Page options'

  if (!isMobile) return null
  if (!onSearch && !active && !globalActions && !hasL3Content) return null

  const viewportHeightCss = viewport.height === null ? '100dvh' : `${viewport.height}px`

  return (
    <div
      ref={dockRef}
      data-testid={TEST_IDS.ACTIONS_DOCK}
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
      {/* Unified bottom sheet expands upward above the primary/search/trigger stack.
          Closed shell stays mounted (hidden) without exposing role="dialog" (WW-087);
          SecondaryNav mounts lazily ONLY while open so L3 never double-mounts. */}
      {sheetOpen && showOverflow && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/20 dark:bg-black/35 cursor-default"
          onClick={closeSheet}
        />
      )}
      <div
        id={sheetId}
        ref={sheetRef}
        role={sheetOpen && showOverflow ? 'dialog' : undefined}
        aria-modal={sheetOpen && showOverflow ? true : undefined}
        aria-label={sheetOpen && showOverflow ? sheetLabel : undefined}
        tabIndex={-1}
        hidden={!sheetOpen || !showOverflow}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            closeSheet()
          }
        }}
        className={cn(
          sheetOpen && showOverflow ? 'flex' : 'hidden',
          'relative z-40 min-h-0 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-2xl bg-card p-3 shadow-xl ring-1 ring-foreground/10 outline-none',
          hasL3Content ? 'w-72' : 'w-60',
          '[&_button]:min-h-11 [&_button]:min-w-11 [&_summary]:min-h-11',
        )}
        style={{
          maxHeight: `calc(${viewportHeightCss} - 8rem - var(--thumb-dock-lift, 0px) - env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <NavigationDrawerProvider close={closeSheet}>
          {hasL3Content && (
            <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground truncate">
                {sheetLabel}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {resetAnalytics && (
                  <button
                    type="button"
                    onClick={resetAnalytics}
                    data-testid={TEST_IDS.L3_DRAWER_RESET_BTN}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeSheet}
                  data-testid={TEST_IDS.L3_DRAWER_DONE_BTN}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {active?.hasContent && (
            <div ref={activeContentRef} className="contents">
              {active.children}
            </div>
          )}

          {sheetOpen && hasL3Content && (
            <>
              {active?.hasContent && (
                <div className="my-1 border-t border-border/60" aria-hidden="true" />
              )}
              <div data-testid={TEST_IDS.ACTIONS_SHEET_L3} className="-mx-3 -my-2 flex flex-col">
                <SecondaryNav spec={secondarySpec} pageAction={pageAction} />
              </div>
            </>
          )}

          {globalActions?.hasContent && (
            <>
              {(active?.hasContent || hasL3Content) && (
                <div className="my-1 border-t border-border/60" aria-hidden="true" />
              )}
              <div ref={globalContentRef} className="contents">
                {globalActions.children}
              </div>
            </>
          )}
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
          {onSearch && <SearchFab onOpen={() => { closeSheet(); onSearch() }} />}
          {active?.primary && (
            <div className="[&_button]:min-h-11 [&_button]:min-w-11">{active.primary}</div>
          )}
        </div>
      )}

      {showOverflow && (
        <button
          type="button"
          onClick={toggleSheet}
          aria-label={sheetLabel}
          title={sheetLabel}
          aria-expanded={sheetOpen}
          aria-controls={sheetId}
          data-testid={TEST_IDS.ACTIONS_OVERFLOW}
          className={cn(
            'relative z-40 flex size-12 shrink-0 items-center justify-center rounded-full',
            'bg-card text-foreground shadow-lg ring-1 ring-foreground/10',
            'hover:bg-muted active:scale-95 transition-all',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          )}
        >
          {sheetOpen ? <XMarkIcon className="size-6" /> : <EllipsisVerticalIcon className="size-6" />}
          <span className="sr-only">{sheetLabel}</span>
        </button>
      )}
    </div>
  )
}
