'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from '@bitcobblers/wod-wiki-ui/primitives'
import { useLocation } from 'react-router-dom'
import { NavbarItem } from '@/components/organisms/layout/Navbar'
import { AppRail } from '../../app/nav/AppRail'
import { NavigationDrawerProvider } from '../../app/nav/NavigationDrawerContext'
import type { MenuSpec } from '../../app/nav/menuModel'
import { L3DrawerStateProvider, MobileQuerySlotProvider, MobileQuerySlotTarget } from '../panels/page-shells'
import { SecondaryNav, useL3HasContent } from '../../app/nav/SecondaryNav'
import { useNav } from '../../app/nav/NavContext'
import { useIsMobile } from '../../app/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import { TEST_IDS } from '@/lib/testIds'
import { ResponsiveActionsDockPort, ResponsiveActionsProvider } from '../../app/nav/ResponsiveActions'
import { useSurfaceBusy } from '@/agent/surfaceBridges'
import { feedProgressDetail, feedProgressLabel } from '@/services/feed/feedProgress'
import { useActiveImportLabel, useFeedImportPending, useFeedReadiness, useFeedSyncProgress } from '@/services/feed/feedReadiness'

const DESKTOP_2XL_QUERY = '(min-width: 1520px)'

function useIs2xlViewport(): boolean {
  const [is2xl, setIs2xl] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_2XL_QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(DESKTOP_2XL_QUERY)
    setIs2xl(mql.matches)
    if (typeof mql.addEventListener !== 'function') return
    const onChange = (e: MediaQueryListEvent) => setIs2xl(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return is2xl
}

function OpenMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true" className="[&>[data-slot=icon]]:size-5">
      <path d="M2 6.75C2 6.33579 2.33579 6 2.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.16421 17.6642 7.5 17.25 7.5H2.75C2.33579 7.5 2 7.16421 2 6.75ZM2 13.25C2 12.8358 2.33579 12.5 2.75 12.5H17.25C17.6642 12.5 18 12.8358 18 13.25C18 13.6642 17.6642 14 17.25 14H2.75C2.33579 14 2 13.6642 2 13.25Z" />
    </svg>
  )
}

function CloseMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true" className="[&>[data-slot=icon]]:size-5">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}

function MobileSidebar({
  open,
  close,
  onSearch,
  children,
}: React.PropsWithChildren<{ open: boolean; close: () => void; onSearch?: () => void }>) {
  const navBodyRef = useRef<HTMLDivElement>(null)
  return (
    <Drawer
      side="start"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
    >
      <DrawerBackdrop className="bg-black/30 dark:bg-black/30 transition-none data-[closed]:hidden lg:hidden" />
      <DrawerContent
        initialFocus={() => navBodyRef.current}
        data-testid={TEST_IDS.MOBILE_NAV_DRAWER}
        className="w-full max-w-none h-dvh max-h-dvh p-0 gap-0 rounded-none border-0 bg-card transition-none data-[closed]:hidden lg:hidden"
      >
        <DrawerTitle className="sr-only">Navigation</DrawerTitle>
        <NavigationDrawerProvider close={close}>
          <div className="flex h-full min-h-0 bg-card">
            <div className="flex h-full w-[156px] sm:w-44 shrink-0 flex-col overflow-y-auto border-r border-zinc-950/5 bg-background/72 px-2 py-3 dark:border-white/5">
              <AppRail
                variant="mobile-list"
                onSearch={() => {
                  close()
                  onSearch?.()
                }}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-end px-3 pt-3">
                <DrawerClose
                  render={
                    <NavbarItem
                      aria-label="Close navigation"
                      title="Close navigation"
                      data-testid={TEST_IDS.MOBILE_NAV_CLOSE}
                    />
                  }
                >
                  <CloseMenuIcon />
                </DrawerClose>
              </div>
              <div ref={navBodyRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
                {children}
              </div>
            </div>
          </div>
        </NavigationDrawerProvider>
      </DrawerContent>
    </Drawer>
  )
}

function RightL3Drawer({
  open,
  close,
  showControlsFooter = false,
  onReset,
  children,
}: React.PropsWithChildren<{
  open: boolean
  close: () => void
  showControlsFooter?: boolean
  onReset?: () => void
}>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <Drawer
      side="end"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
    >
      <DrawerBackdrop className="bg-black/25 dark:bg-black/40 transition-none data-[closed]:hidden 2xl:hidden" />
      <DrawerContent
        initialFocus={() => bodyRef.current}
        data-testid={TEST_IDS.L3_RIGHT_DRAWER}
        aria-label="Page options panel"
        className="w-full lg:w-80 max-w-none h-dvh max-h-dvh p-0 gap-0 rounded-none border-0 lg:border-l lg:border-border/60 bg-card lg:shadow-2xl flex flex-col transition-none data-[closed]:hidden 2xl:hidden"
      >
        <NavigationDrawerProvider close={close}>
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
            <DrawerTitle className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Page options
            </DrawerTitle>
            <DrawerClose
              render={
                <NavbarItem
                  aria-label="Close page options"
                  title="Close page options"
                />
              }
            >
              <CloseMenuIcon />
            </DrawerClose>
          </div>
          <div ref={bodyRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none">
            {children}
          </div>
          {showControlsFooter && (
            <div className="shrink-0 flex items-center gap-2 border-t border-border/50 bg-card p-3">
              {onReset && (
                <button
                  type="button"
                  onClick={onReset}
                  data-testid={TEST_IDS.L3_DRAWER_RESET_BTN}
                  className="h-10 max-lg:h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={close}
                data-testid={TEST_IDS.L3_DRAWER_DONE_BTN}
                className="h-10 max-lg:h-11 flex-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </NavigationDrawerProvider>
      </DrawerContent>
    </Drawer>
  )
}

export function SidebarLayout({
  navbar,
  sidebar,
  onSearch,
  secondary,
  pageAction,
  peekSlot,
  /** Suppress the desktop L2 column only (mobile drawer keeps it) — set for
   * the canvas home and /guide/* pages, whose chapter list renders at the
   * end of the page instead (GuideIndexFooter). */
  hideDesktopSidebar,
  children,
}: React.PropsWithChildren<{
  navbar: React.ReactNode
  sidebar: React.ReactNode
  /** Opens the global search palette — wired to the icon rail's search button. */
  onSearch?: () => void
  /** Route-declared secondary nav (zone 4); the page index & connections merge in. */
  secondary?: MenuSpec
  /** Per-page action row appended to the L3 rail (e.g. Download Markdown) —
   * rendered in L3 Slot 3 ("Actions") across all breakpoints. */
  pageAction?: React.ReactNode
  /** Right-edge 340px Entity/Schedule Peek drawer rendered when `peekTarget` is active. */
  peekSlot?: React.ReactNode
  hideDesktopSidebar?: boolean
}>) {
  const [showSidebar, setShowSidebar] = useState(false)
  const is2xl = useIs2xlViewport()
  const isMobile = useIsMobile()
  const {
    navState,
    dispatch,
    peekTarget,
    closePeek,
    analyticsControls,
  } = useNav()

  // The home route and guide chapters suppress the 240px L2 sidebar
  // (hideDesktopSidebar), so the xl cap — budgeted for rail + sidebar — would
  // strand the remainder as dead space. They render wide instead; every other
  // route keeps the cap.
  const isFullWidthRoute = useLocation().pathname === '/' || Boolean(hideDesktopSidebar)
  const showRightDrawer = Boolean(navState?.rightDrawerOpen)
  const inspectorActive = Boolean(navState?.inspectorDrawerOpen || peekTarget)
  const showPeekSlot = Boolean(peekTarget && peekSlot)

  const setShowRightDrawer = useCallback(
    (open: boolean) => dispatch({ type: 'SET_RIGHT_DRAWER', open }),
    [dispatch],
  )
  const openRightDrawer = useCallback(() => setShowRightDrawer(true), [setShowRightDrawer])
  const closeRightDrawer = useCallback(() => setShowRightDrawer(false), [setShowRightDrawer])

  // L3 has content only on detail/board/guide routes (stream routes have 0px resting L3).
  const railHasContent = useL3HasContent(secondary, pageAction)

  const l3DrawerState = useMemo(
    () => ({ railHasContent, hasAppliedFilters: false, openRightDrawer }),
    [railHasContent, openRightDrawer],
  )

  // Dismiss open drawers & active peek on browser Back/Forward so the route
  // never changes hidden underneath an open overlay.
  useEffect(() => {
    if (!showSidebar && !showRightDrawer && !peekTarget) return
    const onPopState = () => {
      setShowSidebar(false)
      setShowRightDrawer(false)
      closePeek?.()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [showSidebar, showRightDrawer, peekTarget, setShowRightDrawer, closePeek])

  // Keyboard shortcut `⌘.` / `Ctrl+.` toggles the L3 slide-over drawer when
  // the viewport is below `2xl` (1520px) and L3 has content.
  useEffect(() => {
    if (!railHasContent) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key === '.' && !e.shiftKey && !e.altKey) {
        if (window.innerWidth >= 1520) return
        e.preventDefault()
        setShowRightDrawer(!showRightDrawer)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [railHasContent, showRightDrawer, setShowRightDrawer])

  // Esc dismisses an active peekSlot when not already handled by the drawer itself.
  useEffect(() => {
    if (!showPeekSlot) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closePeek?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showPeekSlot, closePeek])

  // Single-mount L3 rule: SecondaryNav mounts at most ONCE across all breakpoints:
  //   - 2xl+ (>=1520px): inline `<aside>` rail (when railHasContent && !inspectorActive)
  //   - lg–2xl (1024..1519px): RightL3Drawer ONLY when open
  //   - <lg (<1024px): unified bottom sheet inside ResponsiveActionsDock ONLY when open
  const mountInlineL3 = is2xl && railHasContent && !inspectorActive
  const mountDesktopL3Drawer = !is2xl && !isMobile && showRightDrawer

  return (
    <L3DrawerStateProvider value={l3DrawerState}>
    <MobileQuerySlotProvider>
    <ResponsiveActionsProvider
      onSearch={onSearch}
      renderDock={false}
      secondarySpec={secondary}
      pageAction={pageAction}
    >
    <div className="relative isolate flex min-h-svh w-full bg-background max-lg:flex-col lg:flex-row">
      <div className="flex flex-1 w-full max-lg:flex-col lg:flex-row">
        {/* Desktop shell nav container — non-landmark wrapper so AppRail (<nav aria-label="Primary">)
            and NavSidebar (<nav aria-label="...">) stay flat sibling landmarks (no nested <nav>). */}
        <div data-shell-nav="desktop" className="hidden lg:flex">
          <div className="w-14 shrink-0 sticky top-0 h-svh flex flex-col items-center border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm z-40 py-3">
            <AppRail onSearch={onSearch ?? (() => {})} />
          </div>

          {/* overflow-hidden: SidebarBody is the single scroll owner; shell
              wrappers only size (min-h-0) so sticky sections resolve to it. */}
          <div className={cn('w-60 shrink-0 sticky top-0 self-start h-svh min-h-0 overflow-hidden border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm flex flex-col', hideDesktopSidebar && 'lg:hidden')}>
            {sidebar}
          </div>
        </div>
        <MobileSidebar open={showSidebar} close={() => setShowSidebar(false)} onSearch={onSearch}>
          {sidebar}
        </MobileSidebar>

        {/* Content column — on desktop, page headers (StickyPageHeader) own lg:top-0.
            On mobile, this calm sticky navbar carries Menu + Breadcrumb + Sync + Cast
            (L3 & page options live in the bottom thumb-zone ResponsiveActionsDock).
            At xl (1280px), content halts growth at 984px (1280px viewport - 56px rail - 240px sidebar),
            allowing right-side space to grow until the 240px secondary rail mounts at 2xl (1520px).
            The home route (isFullWidthRoute) and active inspector/peek drawer skip the cap. */}
        <div className={cn('flex flex-1 flex-col min-w-0 2xl:max-w-none', isFullWidthRoute || inspectorActive ? 'xl:max-w-none' : 'xl:max-w-[984px]')}>
          <header data-page-sticky-boundary="true" className="lg:hidden sticky top-0 z-20 flex items-center px-2 sm:px-4 bg-card">
            <div className="py-2.5 shrink-0">
              <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Open navigation" title="Open navigation" data-testid={TEST_IDS.MOBILE_NAV_OPEN}>
                <OpenMenuIcon />
                <span className="sr-only">Open navigation</span>
              </NavbarItem>
            </div>
            <div className="min-w-0 flex-1">{navbar}</div>
          </header>

        <MainLandmark>
          <div className="grow w-full max-lg:pb-[calc(12rem+var(--thumb-dock-lift,0px)+env(safe-area-inset-bottom,0px))] lg:overflow-visible">
            {children}
          </div>
          {/* Mobile thumb-area footer + dock live inside <main> so interactive
              controls never sit outside landmarks or occlude bottom content. */}
          <MobileQueryFooter />
          <ResponsiveActionsDockPort />
        </MainLandmark>

        </div>

        {/* Right edge — 3-state mutually exclusive slot:
            1. Streams / empty L3: 0px (nothing rendered).
            2. Resting L3 at 2xl+: 240px inline `<aside aria-label="Page outline and actions">`.
            3. Active Inspector or Entity/Schedule Peek: 340px `INSPECTOR_DRAWER_RAIL_SPACER`
               at xl+ plus `peekSlot` (with overlay backdrop below xl). */}
        {mountInlineL3 && (
          <aside
            aria-label="Page outline and actions"
            data-testid={TEST_IDS.L3_INLINE_RAIL}
            className="hidden 2xl:flex w-60 shrink-0 sticky top-0 h-svh flex-col overflow-y-auto bg-background/72 backdrop-blur-sm"
          >
            <SecondaryNav spec={secondary} pageAction={pageAction} />
          </aside>
        )}

        {inspectorActive && (
          <div
            aria-hidden="true"
            data-testid={TEST_IDS.INSPECTOR_DRAWER_RAIL_SPACER}
            className="hidden xl:block w-[340px] shrink-0"
          />
        )}

        {showPeekSlot && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close peek drawer"
              data-testid={TEST_IDS.PEEK_DRAWER_BACKDROP}
              onClick={() => closePeek?.()}
              className="xl:hidden fixed inset-0 z-[29] bg-black/25 dark:bg-black/40 cursor-default"
            />
            <div
              data-testid={TEST_IDS.PEEK_DRAWER_SLOT}
              className="fixed right-0 top-0 bottom-0 z-30 flex w-[340px] max-w-[92vw] flex-col overflow-hidden max-xl:shadow-2xl xl:shadow-none"
            >
              {peekSlot}
            </div>
          </>
        )}

        {mountDesktopL3Drawer && (
          <RightL3Drawer
            open={showRightDrawer}
            close={closeRightDrawer}
            showControlsFooter={Boolean(analyticsControls)}
            onReset={analyticsControls?.onReset}
          >
            <SecondaryNav spec={secondary} pageAction={pageAction} />
          </RightL3Drawer>
        )}
      </div>
    </div>
    </ResponsiveActionsProvider>
    </MobileQuerySlotProvider>
    </L3DrawerStateProvider>
  )
}

export function MainLandmark({ children }: React.PropsWithChildren) {
  const location = useLocation()
  const surfaceBusy = useSurfaceBusy()
  const feedReadiness = useFeedReadiness()
  const importPending = useFeedImportPending()
  const activeImportLabel = useActiveImportLabel()
  const progress = useFeedSyncProgress()
  const isBusy = surfaceBusy || feedReadiness === 'preparing' || importPending
  const showImportPill = importPending && location.pathname !== '/'
  const detail = showImportPill ? feedProgressDetail(progress) : null

  return (
    <main
      aria-busy={isBusy}
      data-agent-status={isBusy ? 'loading' : 'ready'}
      className="flex flex-1 flex-col lg:min-w-0"
    >
      {children}
      {showImportPill && (
        <div
          role="status"
          aria-live="polite"
          data-testid={TEST_IDS.BOOT_IMPORT_PROGRESS}
          className="pointer-events-none fixed z-30 max-lg:bottom-[calc(0.75rem+var(--thumb-dock-lift,0px)+env(safe-area-inset-bottom,0px))] max-lg:left-3 max-lg:right-auto max-lg:max-w-[calc(100vw-5.5rem)] lg:bottom-4 lg:right-4 lg:left-auto flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs text-foreground shadow-sm"
        >
          <span className="truncate">{activeImportLabel ?? (progress ? feedProgressLabel(progress) : 'Importing library…')}</span>
          {detail && <span className="text-muted-foreground shrink-0">{detail}</span>}
        </div>
      )}
    </main>
  )
}

/** `py-2` (16px) + `border-t` (1px) around MobileQueryFooter when non-empty. */
const MOBILE_QUERY_FOOTER_CHROME_PX = 17

/**
 * MobileQueryFooter — the fixed bottom row of the mobile shell where pages
 * portal thumb-zone controls (stream routes: the WQL composer as a
 * full-width button row). Publishes its outer border-box height as
 * `--thumb-dock-lift` so ResponsiveActionsDock stacks cleanly above it,
 * and renders a flow spacer so scrolled-to-bottom content clears it.
 * Collapses to nothing when no page portals in.
 */
function MobileQueryFooter() {
  const barRef = useRef<HTMLDivElement>(null)
  const [innerHeight, setInnerHeight] = useState(0)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    // Measure the content-box of the fixed inner wrapper so padding added
    // when innerHeight > 0 never feeds back into ResizeObserver measurements;
    // add the constant outer chrome (16px py-2 + 1px border-t = 17px) when
    // publishing `--thumb-dock-lift` so actions-dock clears the outer border.
    const observer = new ResizeObserver((entries) => {
      const h = Math.round(entries[0]?.contentRect.height ?? 0)
      setInnerHeight((prev) => (prev === h ? prev : h))
    })
    observer.observe(el, { box: 'content-box' })
    const initial = Math.round(el.getBoundingClientRect().height)
    setInnerHeight((prev) => (prev === initial ? prev : initial))
    return () => observer.disconnect()
  }, [])

  const lift = innerHeight > 0 ? innerHeight + MOBILE_QUERY_FOOTER_CHROME_PX : 0

  useEffect(() => {
    document.documentElement.style.setProperty('--thumb-dock-lift', `${lift}px`)
    return () => document.documentElement.style.setProperty('--thumb-dock-lift', '0px')
  }, [lift])

  return (
    <>
      <div
        className={cn(
          'lg:hidden fixed inset-x-0 bottom-0 z-30',
          lift > 0 && 'bg-card border-t border-border/50 px-3 py-2',
        )}
      >
        <div ref={barRef} className="w-full min-w-0">
          <MobileQuerySlotTarget className="flex w-full min-w-0" />
        </div>
      </div>
      <div className="lg:hidden" aria-hidden="true" style={{ height: lift }} />
    </>
  )
}
