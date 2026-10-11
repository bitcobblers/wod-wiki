'use client'

import * as Headless from '@headlessui/react'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarPlus, SlidersHorizontal } from 'lucide-react'
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine'
import { NavbarItem } from '@/components/organisms/layout/Navbar'
import { AppRail } from '../../app/nav/AppRail'
import { NavigationDrawerProvider, useCloseNavigationDrawer } from '../../app/nav/NavigationDrawerContext'
import type { MenuSpec } from '../../app/nav/menuModel'
import { MobileQuerySlotProvider, MobileQuerySlotTarget } from '../panels/page-shells'
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

function MobileSidebar({ open, close, onSearch, onCreate, children }: React.PropsWithChildren<{ open: boolean; close: () => void; onSearch?: () => void; onCreate?: () => void }>) {
  return (
    // z-50 lifts the whole dialog (backdrop + panel) above the mobile
    // thumb dock (z-40) and query footer (z-30); relative anchors the
    // Headless stacking context.
    <Headless.Dialog open={open} onClose={close} className="relative z-50 lg:hidden">
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
              onCreate={onCreate ? () => { close(); onCreate() } : undefined}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center px-4 pt-3">
              <Headless.CloseButton as={NavbarItem} aria-label="Close navigation">
                <CloseMenuIcon />
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
 * MobileRightDrawer — the mirrored mobile L3 surface: slides in from the
 * right edge, full viewport, hosting the SAME SecondaryNav content as the
 * 2xl+ rail (properties, stream controls, On this page, download). Facet
 * edits keep it open for repeated picking; the Apply footer (and close
 * button / Escape / backdrop) dismisses it. The ⋯ header dropdown owns
 * these entries between lg and 2xl instead.
 */
function MobileRightDrawer({ open, close, children }: React.PropsWithChildren<{ open: boolean; close: () => void }>) {
  return (
    // Same z-50 contract as MobileSidebar: above the thumb dock (z-40) and
    // query footer (z-30).
    <Headless.Dialog open={open} onClose={close} className="relative z-50 lg:hidden">
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 bg-black/30 dark:bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />
      <Headless.DialogPanel
        transition
        className="fixed inset-y-0 right-0 w-full transition duration-300 ease-out data-closed:translate-x-full"
      >
        {/* The same close seam as the left drawer: rail flows (WQL-text jump,
            explicit dismissals) close whichever drawer hosts them. */}
        <NavigationDrawerProvider close={close}>
        <div className="flex h-full min-h-0 flex-col bg-card">
          <div className="flex items-center justify-end px-4 pt-3">
            <Headless.CloseButton as={NavbarItem} aria-label="Close page options">
              <CloseMenuIcon />
            </Headless.CloseButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
          <div className="shrink-0 border-t border-border/50 bg-card p-3">
            <button
              type="button"
              onClick={close}
              className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground"
            >
              Apply
            </button>
          </div>
        </div>
        </NavigationDrawerProvider>
      </Headless.DialogPanel>
    </Headless.Dialog>
  )
}

export function SidebarLayout({
  navbar,
  sidebar,
  onSearch,
  onCreate,
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
  /** Opens the global new-journal-note dialog (rail + mobile header; the drawer rail closes first). */
  onCreate?: () => void
  /** Route-declared secondary nav (zone 4); the page index merges in. */
  secondary?: MenuSpec
  /** Per-page action row appended to the L3 rail (e.g. Download Markdown) —
   * the same action the ⋯ fallback carries below 2xl. */
  pageAction?: React.ReactNode
  hideDesktopSidebar?: boolean
}>) {
  let [showSidebar, setShowSidebar] = useState(false)
  let [showRightDrawer, setShowRightDrawer] = useState(false)
  // The right-drawer trigger mirrors the hamburger: it only appears when the
  // L3 rail actually has content (stream properties, page index, controls,
  // download). The rail stays mounted at every width (hidden below 2xl via
  // CSS), so its rendered output is the source of truth for the trigger.
  const railContentRef = useRef<HTMLDivElement>(null)
  const [railHasContent, setRailHasContent] = useState(false)
  useLayoutEffect(() => {
    setRailHasContent((railContentRef.current?.childElementCount ?? 0) > 0)
  }, [secondary, pageAction])

  // Mobile hides the facet columns behind the right drawer, so the applied
  // where-filters get no visible state — mirror them as a dot on the trigger.
  const { streamControls } = useNav()
  const hasAppliedFilters = useMemo(() => {
    const parsed = parseQuery(streamControls?.query ?? '')
    return !parsed.error && isFindQuery(parsed) && parsed.filters.length > 0
  }, [streamControls?.query])

  // No pathname auto-close: L1 selection swaps the L2 panel in place and WQL
  // facet/query updates keep the drawer open for repeated edits. Dismissal is
  // explicit only — Apply + modal/external rail flows (NavigationDrawerProvider
  // seam), Close button, Escape, backdrop.

  return (
    <MobileQuerySlotProvider>
    <ResponsiveActionsProvider onSearch={onSearch}>
    <div className="relative isolate flex min-h-svh w-full bg-background max-lg:flex-col lg:flex-row">
      <div className="flex flex-1 w-full max-lg:flex-col lg:flex-row">
        {/* Main desktop nav — L1 Icon rail + L2 Context sidebar */}
        <nav aria-label="Main" className="hidden lg:flex">
          <div className="w-14 shrink-0 sticky top-0 h-svh flex flex-col items-center border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm z-40 py-3">
            <AppRail onSearch={onSearch ?? (() => {})} onCreate={onCreate} />
          </div>

          {/* overflow-hidden: SidebarBody is the single scroll owner; shell
              wrappers only size (min-h-0) so sticky sections resolve to it. */}
          <div className={cn('w-60 shrink-0 sticky top-0 self-start h-svh min-h-0 overflow-hidden border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm flex flex-col', hideDesktopSidebar && 'lg:hidden')}>
            {sidebar}
          </div>
        </nav>
        <MobileSidebar open={showSidebar} close={() => setShowSidebar(false)} onSearch={onSearch} onCreate={onCreate}>
          {sidebar}
        </MobileSidebar>

        {/* Content column — on desktop, page headers (StickyPageHeader) own lg:top-0.
            On mobile, this sticky navbar carries the hamburger drawer trigger.
            At xl (1280px), content halts growth at 984px (1280px viewport - 56px rail - 240px sidebar),
            allowing right-side space to grow until the 240px secondary rail mounts at 2xl (1520px). */}
        <div className="flex flex-1 flex-col min-w-0 xl:max-w-[984px] 2xl:max-w-none">
          <header data-page-sticky-boundary="true" className="lg:hidden sticky top-0 z-20 flex items-center px-2 sm:px-4 bg-card border-b border-border/50">
            <div className="py-2.5 shrink-0">
              <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Open navigation">
                <OpenMenuIcon />
              </NavbarItem>
            </div>
            <div className="min-w-0 flex-1">{navbar}</div>
            {onCreate && (
              <div className="py-2.5 shrink-0">
                <NavbarItem onClick={onCreate} aria-label="New journal note">
                  <CalendarPlus className="size-5" />
                </NavbarItem>
              </div>
            )}
            {railHasContent && (
              <div className="py-2.5 shrink-0">
                <NavbarItem onClick={() => setShowRightDrawer(true)} aria-label="Open page options">
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
            renders this rail; between lg and 2xl the same entries collapse
            into the header ⋯ (ActionsMenu); below lg the mobile right drawer
            hosts them (trigger mirrors the hamburger in the mobile header).
            Between xl (1280px) and 2xl (1520px), content remains capped at
            984px and right padding grows until the 240px rail fits without
            shrinking content. */}
        <aside className="hidden 2xl:flex w-60 shrink-0 sticky top-0 h-svh flex-col overflow-y-auto bg-background/72 backdrop-blur-sm">
          {/* display:contents pass-through — the wrapper exists only to
              measure whether SecondaryNav rendered anything (drives the
              mobile right-drawer trigger). */}
          <div ref={railContentRef} className="contents">
            <SecondaryNav spec={secondary} pageAction={pageAction} />
          </div>
        </aside>
        <MobileRightDrawer open={showRightDrawer} close={() => setShowRightDrawer(false)}>
          <SecondaryNav spec={secondary} pageAction={pageAction} />
        </MobileRightDrawer>

      {/* Mobile thumb dock — single-mounted via ResponsiveActionsProvider
          (search FAB + page primary + overflow, aligned per the appearance
          preference); desktop search stays in the icon rail. */}
      </div>
    </div>
    </ResponsiveActionsProvider>
    </MobileQuerySlotProvider>
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
    const observer = new ResizeObserver(() => setLift(el.offsetHeight))
    observer.observe(el)
    setLift(el.offsetHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--thumb-dock-lift', `${lift}px`)
    return () => document.documentElement.style.setProperty('--thumb-dock-lift', '0px')
  }, [lift])

  return (
    <>
      <div
        ref={barRef}
        className={cn(
          'lg:hidden fixed inset-x-0 bottom-0 z-30',
          lift > 0 && 'bg-card border-t border-border/50 px-3 py-2',
        )}
      >
        <MobileQuerySlotTarget className="flex w-full min-w-0" />
      </div>
      <div className="lg:hidden" aria-hidden="true" style={{ height: lift }} />
    </>
  )
}
