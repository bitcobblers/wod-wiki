/**
 * AppRail — 56px icon rail (general layout, leftmost column).
 *
 * Carries the L1 destinations (Home / Library / Dashboards / Efforts) as
 * icon-only buttons, the app avatar on top, and search pinned to the bottom.
 * Labels/children live in the context sidebar (NavSidebar); the rail is the
 * only constant chrome across sections.
 */

import { Dumbbell, Settings, UserRound } from 'lucide-react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { useNavigate, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { ComponentType } from 'react'
import { BUY_ME_A_COFFEE_URL, BuyMeACoffeeIcon } from '../components/atoms/BuyMeACoffee'

import { useNav } from './NavContext'
import { executeNavAction } from './navTypes'
import { isItemActive } from './NavSidebar'
import { useCloseNavigationDrawer } from './NavigationDrawerContext'
import type { NavItem, NavActionDeps } from './navTypes'
import { APP_VERSION } from '../lib/appVersion'

export function AppRail({ onSearch, onCreate }: { onSearch: () => void; onCreate?: () => void }) {
  const { tree, navState, dispatch } = useNav()
  const navigate = useNavigate()
  const location = useLocation()
  // Mobile drawer: settings is an external flow — dismiss explicitly (no-op on
  // desktop, where the seam defaults to nothing). Create/search close earlier
  // in the drawer's wrappers; L1 destinations intentionally keep it open.
  const closeDrawer = useCloseNavigationDrawer()

  const deps: NavActionDeps = {
    navigate: (to, opts) => navigate(to, { replace: opts?.replace }),
    setQueryParam: () => {},
    scrollToSection: () => {},
  }

  // buy-me-a-coffee rides the tree for the mobile drawer but renders as a
  // dedicated bottom icon here, not in the primary loop.
  const items = (tree ?? []).filter(
    (item): item is NavItem =>
      item != null && item.icon != null && item.id !== 'settings' && item.id !== 'buy-me-a-coffee',
  )
  const isSettingsActive = location.pathname.startsWith('/settings')

  return (
    <>
      {/* Avatar → home */}
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label="Wod Wiki home"
        className="mb-3 grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20 rotate-3"
      >
        <Dumbbell size={17} />
      </button>

      <nav aria-label="Primary" className="flex flex-col items-center gap-1.5">
        {items.map(item => {
          const Icon = item.icon as unknown as ComponentType<{ className?: string }>
          const active = isItemActive(item, navState, location as unknown as Location)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                dispatch({ type: 'SET_ACTIVE_L1', id: item.id })
                executeNavAction(item.action, deps)
              }}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative grid size-9 place-items-center rounded-lg transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {active && (
                <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <Icon className="size-5" />
            </button>
          )
        })}
      </nav>


      <div className="flex-1" />

      <button
        type="button"
        onClick={onSearch}
        title="Search (⌘/)"
        aria-label="Search"
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <MagnifyingGlassIcon className="size-5" />
      </button>
      {/* Buy Me a Coffee — under search, above Settings; external link. */}
      <a
        href={BUY_ME_A_COFFEE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Buy Me a Coffee"
        aria-label="Buy Me a Coffee"
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <BuyMeACoffeeIcon className="size-5" />
      </a>

      {/* Profile — between the coffee link and Settings. */}
      <button
        type="button"
        onClick={() => {
          closeDrawer()
          navigate('/settings/profile')
        }}
        title="Profile"
        aria-label="Profile"
        aria-current={location.pathname.startsWith('/settings/profile') ? 'page' : undefined}
        data-testid="nav-profile"
        className={cn(
          'relative grid size-9 place-items-center rounded-lg transition-colors mt-1.5',
          location.pathname.startsWith('/settings/profile')
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        {location.pathname.startsWith('/settings/profile') && (
          <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        )}
        <UserRound className="size-5" />
      </button>

      <button
        type="button"
        onClick={() => {
          closeDrawer()
          navigate('/settings/appearance')
        }}
        title="Settings"
        aria-label="Settings"
        aria-current={isSettingsActive ? 'page' : undefined}
        data-testid="nav-settings"
        className={cn(
          'group relative grid size-9 place-items-center rounded-lg transition-colors mt-1.5',
          isSettingsActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        {isSettingsActive && (
          <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        )}
        <Settings className="size-5" />
        {/* Hover/focus popover: build version (System settings has the full About block). */}
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-0 left-full z-50 ml-2 w-max rounded-md border border-border bg-popover px-2 py-1 font-mono text-[10px] text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          v{APP_VERSION}
        </span>
      </button>
    </>
  )
}
