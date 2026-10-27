/**
 *
 * Rendering layers (top → bottom):
 *   1. Context heading (active L1 label)
 *   2. L2 panel (children list or custom component for the active L1)
 *
 * L1 destinations live in AppRail (icon ribbon), shared by desktop and the
 * mobile drawer. "On this page" (L3) section links are intentionally
 * excluded here — they appear only in the "…" ActionsMenu so they don't
 * duplicate the right TOC.
 */

import { useNavigate, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { Plus, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils'

import { Sidebar, SidebarBody, SidebarHeader, SidebarItem, SidebarLabel, SidebarSection } from '@/components/organisms/layout/Sidebar'
import { SidebarAccordion } from '@/components/organisms/layout/SidebarAccordion'

import { useNav } from './NavContext'
import { executeNavAction } from './navTypes'
import { useCloseNavigationDrawer } from './NavigationDrawerContext'
import type { NavItem, NavActionDeps, NavState } from './navTypes'
import { MenuList, useResolvedMenu } from './MenuList'
import type { MenuSpec } from './menuModel'

// ─── helpers ─────────────────────────────────────────────────────────────────

function useNavDeps(): NavActionDeps {
  const navigate = useNavigate()
  const { scrollToSection } = useNav()

  return {
    navigate: (to, opts) => navigate(to, { replace: opts?.replace }),
    setQueryParam: (_params, _replace) => {
      // Sidebar clicks on L3 section items use scrollToSection instead.
      // URL query params are updated by the page's IntersectionObserver.
    },
    scrollToSection,
  }
}

function useNavAction() {
  const deps = useNavDeps()
  const { openCreateJournal } = useNav()
  const closeDrawer = useCloseNavigationDrawer()

  return (item: NavItem) => {
    closeDrawer()
    if (item.id === 'home-new-journal') {
      openCreateJournal({ mode: 'blank' })
      return
    }
    executeNavAction(item.action, deps)
  }
}

export function isItemActive(item: NavItem, navState: NavState, location: Location): boolean {
  if (item.isActive) return item.isActive(location as unknown as Location, navState)
  if (item.action.type === 'route') {
    return item.action.to === '/'
      ? location.pathname === '/' || location.pathname === ''
      : location.pathname === item.action.to
  }
  if (item.action.type === 'scroll') return navState.activeL3Id === item.action.sectionId
  if (item.action.type === 'query') return navState.activeL3Id === item.id
  return false
}

// ─── L2 children list renderer ────────────────────────────────────────────────

function L2ChildrenList({ items }: { items: NavItem[] }) {
  const { navState } = useNav()
  const location = useLocation()
  const handleAction = useNavAction()

  return (
    <SidebarSection>
      {items.map(child => {
        if (child.variant === 'notable') {
          return (
            <div key={child.id} className="mb-2">
              <button
                type="button"
                data-testid={`nav-item-${child.id}`}
                onClick={() => handleAction(child)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm"
              >
                <Plus className="size-4 shrink-0" />
                <span>{child.label}</span>
              </button>
            </div>
          )
        }
        const active = isItemActive(child, navState, location)

        // Accordion group (e.g. Syntax with sub-pages)
        if (child.children && child.children.length > 0) {
          return (
            <SidebarAccordion
              key={child.id}
              title={child.label}
              count={child.children.length}
              defaultOpen={child.children.some(gc => isItemActive(gc, navState, location))}
              collapsible={child.id !== 'syntax-group'}
            >              
              {child.children.map(gc => {
                const gcActive = isItemActive(gc, navState, location)
                return (
                  <SidebarItem
                    key={gc.id}
                    onClick={() => handleAction(gc)}
                    current={gcActive}
                  >
                    {gc.icon && <gc.icon data-slot="icon" />}
                    <SidebarLabel>{gc.label}</SidebarLabel>
                  </SidebarItem>
                )
              })}
            </SidebarAccordion>
          )
        }

        // Flat item
        return (
          <div key={child.id} className="group relative flex items-center">
            <SidebarItem
              onClick={child.disabled ? undefined : () => handleAction(child)}
              current={active}
              disabled={child.disabled}
              aria-label={child.disabled ? `${child.label} (coming soon)` : undefined}
              className={cn('flex-1', child.disabled && 'opacity-60')}
            >
              {child.icon && <child.icon data-slot="icon" />}
              <SidebarLabel>{child.disabled ? '+' : child.label}</SidebarLabel>
            </SidebarItem>
            {child.onTogglePin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  child.onTogglePin?.()
                }}
                title={child.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                aria-label={child.pinned ? `Unpin ${child.label}` : `Pin ${child.label}`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
              >
                <PinOff className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </SidebarSection>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NavSidebar({ navSpec }: { navSpec?: MenuSpec }) {
  const { tree, navState, dispatch, contextNav } = useNav()
  const location = useLocation()
  const resolvedNav = useResolvedMenu(navSpec)

  // Find which L1 is currently active
  const activeL1 = (tree ?? []).find(item => item?.id === navState.activeL1Id) ?? null

  // Route-scoped context nav (e.g. note relationships): while its pathname
  // matches, it replaces both the L1 listing panel and the route navSpec —
  // even when its spec is empty.
  const contextPanel = contextNav?.pathname === location.pathname ? contextNav : null

  // Render the L2 zone for the active L1 — same on desktop and in the
  // mobile drawer (the drawer wraps it beside the shared icon rail).
  const renderL2 = () => {
    if (contextPanel) return null
    if (!activeL1) return null

    // Custom panel (Journal, Collections, Search)
    if (activeL1.panel) {
      const Panel = activeL1.panel
      return (
        <div className="border-b border-border/40 pb-2 mb-2">
          <Panel item={activeL1} navState={navState} dispatch={dispatch} />
        </div>
      )
    }

    // Children list (Home docs/syntax)
    if (activeL1.children && activeL1.children.length > 0) {
      return (
        <div className="border-b border-border/40 pb-2 mb-2">
          <L2ChildrenList items={activeL1.children} />
        </div>
      )
    }

    return null
  }

  return (
    <Sidebar>
      {/* ── Context heading ───────────────────────────────────────────────── */}
      {/* Names the active section above its L2 panel; the L1 icon rail
          (AppRail) carries destinations on both desktop and mobile drawer. */}
      <SidebarHeader>
        <div className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {activeL1?.label ?? 'Wod Wiki'}
        </div>
      </SidebarHeader>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <SidebarBody>
        {/* L2 — context-specific panel or doc children */}
        {renderL2()}
        {contextPanel ? (
          /* Route-scoped context nav (zone 2 contract) — replaces the
             listing panel and route navSpec for its pathname. */
          <div className="pt-1">
            <MenuList entries={contextPanel.spec} />
          </div>
        ) : (
          /* Route-declared nav panel (zone 2 contract) — same standardized
              rendering as the secondary rail. */
          resolvedNav.length > 0 && (
            <div className="pt-1">
              <MenuList entries={resolvedNav} />
            </div>
          )
        )}
      </SidebarBody>
    </Sidebar>
  )
}
