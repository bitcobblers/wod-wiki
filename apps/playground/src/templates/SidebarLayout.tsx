'use client'

import * as Headless from '@headlessui/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine'
import { NavbarItem } from '@/components/organisms/layout/Navbar'
import { AppRail } from '../../app/nav/AppRail'
import { NavigationDrawerProvider, useCloseNavigationDrawer } from '../../app/nav/NavigationDrawerContext'
import type { MenuSpec } from '../../app/nav/menuModel'
import { L3DrawerStateProvider, MobileQuerySlotProvider, MobileQuerySlotTarget } from '../panels/page-shells'
import { SecondaryNav } from '../../app/nav/SecondaryNav'
import { useNav } from '../../app/nav/NavContext'
import { cn } from '@/lib/utils'
import { ResponsiveActionsProvider } from '../../app/nav/ResponsiveActions'

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

/**
 * DrawerApplyFooter — fixed bottom bar of the mobile drawer, outside the
 * SidebarBody scroll owner, for conditions-filter L1s (nav tree
 * `applyFooter: true`). Queries already update on every option click, so the
 * button only dismisses the drawer — no draft/commit transaction.
 */
function DrawerApplyFooter() {
  const { tree, navState, contextNav } = useNav()
  const location = useLocation()
  const close = useCloseNavigationDrawer()
  const active = tree.find(item => item.id === navState.activeL1Id)
  if (!active?.applyFooter || contextNav?.pathname === location.pathname) return null
  return (
    <div className="shrink-0 border-t border-border/50 bg-card p-3">
      <button
        type="button"
        onClick={close}
        className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground"
      >
        Apply
      </button>
    </div>
  )
}

function MobileSidebar({ open, close, onSearch, children }: React.PropsWithChildren<{ open: boolean; close: () => void; onSearch?: () => void }>) {
  return (
    // z-50 lifts the whole dialog (backdrop + panel) above the mobile
    // thumb dock (z-40) and query footer (z-30); relative anchors the
    // Headless stacking context.
    <Headless.Dialog open={open} onClose={close} className="fixed inset-0 z-50 lg:hidden">
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 bg-black/30 dark:bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />
      <Headless.DialogPanel
        transition
        className="fixed inset-y-0 left-0 w-full transition duration-300 ease-out data-closed:-translate-x-full"
      >
        {/* Full-viewport edge-to-edge drawer; the close seam lets rail/filter
            flows dismiss explicitly while plain navigation keeps it open. */}
        <NavigationDrawerProvider close={close}>
        <div className="flex h-full min-h-0 bg-card">
          {/* Same icon rail as desktop, fixed 56px, beside the L2 panel.
              Hit areas bumped to 44px for touch; close runs before
              create/search so two focus traps never stack. */}
          <div className="flex h-full w-14 shrink-0 flex-col items-center border-r border-zinc-950/5 bg-background/72 py-3 dark:border-white/5 [&_a]:size-11 [&_button]:size-11">
            <AppRail
              onSearch={() => {
                close()
                onSearch?.()
              }}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center px-4 pt-3">
              <Headless.CloseButton as={NavbarItem} aria-label="Close navigation" title="Close navigation">
                <CloseMenuIcon />
                <span className="sr-only">Close navigation</span>
              </Headless.CloseButton>
            </div>
            {/* No own overflow: SidebarBody inside {children} is the single
                scroll viewport so section headers/footers stick to it. */}
            <div className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
            <DrawerApplyFooter />
          </div>
        </div>
        </NavigationDrawerProvider>
      </Headless.DialogPanel>
    </Headless.Dialog>
  )
}

/**
 * RightL3Drawer — the unified < 2xl L3 slide-over surface.
 *
 * Below `lg` (mobile), slides in full-width (`w-full`) with the bottom Apply
 * footer; between `lg` and `2xl` (1024px–1519px), slides in as a `w-80`
 * right-docked sheet triggered by `L3DrawerTrigger` ("Page options") or `⌘.`.
 * Hosts the exact same `<SecondaryNav />` component as the `2xl+` inline rail.
 */
function RightL3Drawer({ open, close, children }: React.PropsWithChildren<{ open: boolean; close: () => void }>) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 2xl:hidden" data-testid="l3-right-drawer">
      <div
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 bg-black/25 dark:bg-black/40 transition-opacity"
      />
      <div
        role="region"
        aria-label="Page options panel"
        className="fixed inset-y-0 right-0 flex h-full min-h-0 w-full lg:w-80 flex-col bg-card lg:border-l lg:border-border/60 lg:shadow-2xl animate-in slide-in-from-right duration-200"
      >
        <NavigationDrawerProvider close={close}>
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Page options
            </span>
            <NavbarItem onClick={close} aria-label="Close page options" title="Close page options">
              <CloseMenuIcon />
              <span className="sr-only">Close page options</span>
            </NavbarItem>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
          <div className="shrink-0 border-t border-border/50 bg-card p-3 lg:hidden">
            <button
              type="button"
              onClick={close}
              className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground"
            >
              Apply
            </button>
          </div>
        </NavigationDrawerProvider>
      </div>
    </div>
  )
}

export function SidebarLayout({
  navbar,
  sidebar,
  onSearch,
  secondary,
  pageAction,
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
  /** Route-declared secondary nav (zone 4); the page index merges in. */
  secondary?: MenuSpec
  /** Per-page action row appended to the L3 rail (e.g. Download Markdown) —
   * rendered in L3 Slot 3 ("Actions") across all breakpoints. */
  pageAction?: React.ReactNode
  hideDesktopSidebar?: boolean
}>) {
  let [showSidebar, setShowSidebar] = useState(false)
  const {
    navState,
    dispatch,
    streamControls,
    analyticsControls,
    l3Items,
    l3Actions = [],
  } = useNav()
  const showRightDrawer = Boolean(navState?.rightDrawerOpen)
  const setShowRightDrawer = useCallback(
    (open: boolean) => dispatch({ type: 'SET_RIGHT_DRAWER', open }),
    [dispatch],
  )
  const openRightDrawer = useCallback(() => setShowRightDrawer(true), [setShowRightDrawer])
  const closeRightDrawer = useCallback(() => setShowRightDrawer(false), [setShowRightDrawer])

  // The right-drawer triggers (mobile header + lg–2xl StickyPageHeader) appear
  // only when the L3 surface actually has content across any of its 3 slots.
  const railHasContent = Boolean(
    (secondary && secondary.length > 0) ||
    (l3Items && l3Items.length > 0) ||
    (l3Actions && l3Actions.length > 0) ||
    streamControls ||
    analyticsControls ||
    pageAction
  )
  const hasAppliedFilters = useMemo(() => {
    const parsed = parseQuery(streamControls?.query ?? '')
    return !parsed.error && isFindQuery(parsed) && parsed.filters.length > 0
  }, [streamControls?.query])

  const l3DrawerState = useMemo(
    () => ({ railHasContent, hasAppliedFilters, openRightDrawer }),
    [railHasContent, hasAppliedFilters, openRightDrawer],
  )

  // Dismiss open drawers on browser Back/Forward so the route never changes
  // hidden underneath an open drawer.
  useEffect(() => {
    if (!showSidebar && !showRightDrawer) return
    const onPopState = () => {
      setShowSidebar(false)
      setShowRightDrawer(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [showSidebar, showRightDrawer, setShowRightDrawer])

  // Keyboard shortcut `⌘.` / `Ctrl+.` toggles the L3 slide-over drawer when
  // the viewport is below `2xl` (1520px) and L3 has content.
  useEffect(() => {
    if (!railHasContent) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.' && !e.shiftKey && !e.altKey) {
        if (window.innerWidth >= 1520) return
        e.preventDefault()
        setShowRightDrawer(!showRightDrawer)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [railHasContent, showRightDrawer, setShowRightDrawer])

  return (
    <L3DrawerStateProvider value={l3DrawerState}>
    <MobileQuerySlotProvider>
    <ResponsiveActionsProvider onSearch={onSearch}>
    <div className="relative isolate flex min-h-svh w-full bg-background max-lg:flex-col lg:flex-row">
      <div className="flex flex-1 w-full max-lg:flex-col lg:flex-row">
        {/* Main desktop nav — L1 Icon rail + L2 Context sidebar */}
        <nav aria-label="Main" className="hidden lg:flex">
          <div className="w-14 shrink-0 sticky top-0 h-svh flex flex-col items-center border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm z-40 py-3">
            <AppRail onSearch={onSearch ?? (() => {})} />
          </div>

          {/* overflow-hidden: SidebarBody is the single scroll owner; shell
              wrappers only size (min-h-0) so sticky sections resolve to it. */}
          <div className={cn('w-60 shrink-0 sticky top-0 self-start h-svh min-h-0 overflow-hidden border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm flex flex-col', hideDesktopSidebar && 'lg:hidden')}>
            {sidebar}
          </div>
        </nav>
        <MobileSidebar open={showSidebar} close={() => setShowSidebar(false)} onSearch={onSearch}>
          {sidebar}
        </MobileSidebar>

        {/* Content column — on desktop, page headers (StickyPageHeader) own lg:top-0.
            On mobile, this sticky navbar carries the hamburger drawer trigger.
            At xl (1280px), content halts growth at 984px (1280px viewport - 56px rail - 240px sidebar),
            allowing right-side space to grow until the 240px secondary rail mounts at 2xl (1520px). */}
        <div className="flex flex-1 flex-col min-w-0 xl:max-w-[984px] 2xl:max-w-none">
          <header data-page-sticky-boundary="true" className="lg:hidden sticky top-0 z-20 flex items-center px-2 sm:px-4 bg-card">
            <div className="py-2.5 shrink-0">
              <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Open navigation" title="Open navigation">
                <OpenMenuIcon />
                <span className="sr-only">Open navigation</span>
              </NavbarItem>
            </div>
            <div className="min-w-0 flex-1">{navbar}</div>
            {railHasContent && (
              <div className="py-2.5 shrink-0">
                <NavbarItem onClick={openRightDrawer} aria-label="Open page options" title="Open page options">
                  <span className="relative inline-flex">
                    <SlidersHorizontal className="size-5" />
                    {hasAppliedFilters && (
                      <span
                        data-testid="drawer-filters-active"
                        className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-500"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="sr-only">Open page options</span>
                </NavbarItem>
              </div>
            )}
          </header>

        <main className="flex flex-1 flex-col lg:min-w-0">
          <div className="grow w-full max-lg:pb-48 lg:overflow-visible">
            {children}
          </div>
          {/* Mobile thumb-area footer — pages portal their query bar (the
              WQL composer) into the slot at the bottom of the screen; the
              thumb dock stacks above it via --thumb-dock-lift. Collapses
              when unoccupied. */}
          <MobileQueryFooter />
        </main>

        </div>

        {/* Secondary nav — zone 4; the canonical L3 surface. Desktop (2xl+)
            renders this rail inline; below 2xl (lg–2xl laptop and < lg mobile)
            RightL3Drawer slides in with the exact same SecondaryNav content. */}
        <aside className="hidden 2xl:flex w-60 shrink-0 sticky top-0 h-svh flex-col overflow-y-auto bg-background/72 backdrop-blur-sm">
          <SecondaryNav spec={secondary} pageAction={pageAction} />
        </aside>
        <RightL3Drawer open={showRightDrawer} close={closeRightDrawer}>
          <SecondaryNav spec={secondary} pageAction={pageAction} />
        </RightL3Drawer>

      {/* Mobile thumb dock — single-mounted via ResponsiveActionsProvider
          (search FAB + page primary + overflow, aligned per the appearance
          preference); desktop search stays in the icon rail. */}
      </div>
    </div>
    </ResponsiveActionsProvider>
    </MobileQuerySlotProvider>
    </L3DrawerStateProvider>
  )
}
/**
 * MobileQueryFooter — the fixed bottom row of the mobile shell where pages
 * portal thumb-zone controls (stream routes: the WQL composer as a
 * full-width button row). Publishes its height as `--thumb-dock-lift` so
 * ResponsiveActionsDock stacks a row above it, and renders a flow spacer
 * so scrolled-to-bottom content clears it. Collapses to nothing when no
 * page portals in.
 */
function MobileQueryFooter() {
  const barRef = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState(0)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    // Measure the content-box of the fixed inner wrapper: the bar's own
    // border-box height includes the padding we apply when lift>0, and portal
    // content can size itself off --thumb-dock-lift — either feedback loops
    // into maximum-update-depth crashes (observed on collection routes).
    const observer = new ResizeObserver((entries) => {
      const h = Math.round(entries[0]?.contentRect.height ?? 0)
      setLift((prev) => (prev === h ? prev : h))
    })
    observer.observe(el, { box: 'content-box' })
    const initial = Math.round(el.getBoundingClientRect().height)
    setLift((prev) => (prev === initial ? prev : initial))
    return () => observer.disconnect()
  }, [])

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
