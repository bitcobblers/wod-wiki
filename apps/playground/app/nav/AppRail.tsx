/**
 * AppRail — 56px icon rail (general layout, leftmost column).
 *
 * Carries the L1 destinations (Home / Library / Dashboards / Efforts) as
 * icon-only buttons, the app avatar on top, and search pinned to the bottom.
 * Labels/children live in the context sidebar (NavSidebar); the rail is the
 * only constant chrome across sections.
 */

import { Settings, UserRound } from 'lucide-react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { useNavigate, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { TEST_IDS } from '@/lib/testIds'
import type { ComponentType } from 'react'
import { BUY_ME_A_COFFEE_URL, BuyMeACoffeeIcon } from '../components/atoms/BuyMeACoffee'
import { WodWikiMark } from '@/components/atoms/WodWikiBrand'

import { useNav } from './NavContext'
import { executeNavAction } from './navTypes'
import { isItemActive } from './NavSidebar'
import { useCloseNavigationDrawer } from './NavigationDrawerContext'
import type { NavItem, NavActionDeps } from './navTypes'
import { APP_VERSION } from '../lib/appVersion'

export function AppRail({
  onSearch,
  onCreate: _onCreate,
  variant = 'rail',
}: {
  onSearch: () => void
  onCreate?: () => void
  variant?: 'rail' | 'mobile-list'
}) {
  const { tree, navState, dispatch } = useNav()
  const navigate = useNavigate()
  const location = useLocation()
  // Mobile drawer: settings is an external flow — dismiss explicitly (no-op on
  // desktop, where the seam defaults to nothing). Create/search close earlier
  // in the drawer's wrappers; L1 destinations intentionally keep it open.
  const closeDrawer = useCloseNavigationDrawer()

  const deps: NavActionDeps = {
    navigate: (to, opts) => {
      void navigate(to, { replace: opts?.replace })
    },
    setQueryParam: () => {},
    scrollToSection: () => {},
  }

  const isMobileList = variant === 'mobile-list'
  const homeItem = (tree ?? []).find(item => item?.id === 'home')
  const isHomeActive = homeItem
    ? isItemActive(homeItem, navState, location as unknown as Location)
    : location.pathname === '/' || location.pathname === ''

  // Home owns the single top brand button; buy-me-a-coffee and settings render
  // in the trailing cluster below the spacer.
  const items = (tree ?? []).filter(
    (item): item is NavItem =>
      item != null &&
      item.icon != null &&
      item.id !== 'home' &&
      item.id !== 'settings' &&
      item.id !== 'buy-me-a-coffee',
  )
  const isProfileActive = location.pathname.startsWith('/settings/profile')
  const isSettingsActive = location.pathname.startsWith('/settings')
  // ponytail: fixed 56px rail keeps labels in tooltips/screen-readers; add persistent labels when rail widens to 72px+.
  const TOOLTIP_CLASS =
    'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 z-50 ml-2 w-max rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'

  const mobileRowClass = (active: boolean) =>
    cn(
      'flex w-full min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
      active
        ? 'bg-primary/10 font-semibold text-primary'
        : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    )

  return (
    <>
      {/* Brand logo — single Home trigger */}
      <button
        type="button"
        onClick={() => {
          closeDrawer()
          dispatch({ type: 'SET_ACTIVE_L1', id: 'home' })
          void navigate('/')
        }}
        title="Wod Wiki home"
        aria-label="Wod Wiki home"
        aria-current={isHomeActive ? 'page' : undefined}
        data-testid={TEST_IDS.NAV_L1_HOME}
        className={
          isMobileList
            ? cn(mobileRowClass(isHomeActive), 'mb-1.5 shrink-0')
            : cn(
                'group relative mb-3 grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
                isHomeActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
        }
      >
        {!isMobileList && isHomeActive && (
          <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        )}
        <WodWikiMark
          size={isMobileList ? 24 : 32}
          className={cn(
            'shrink-0 shadow-sm shadow-black/15',
            isMobileList ? 'size-6 rounded-[6px]' : 'size-8 rounded-[8px]',
          )}
        />
        {isMobileList ? (
          <span className="min-w-0 flex-1 truncate">Home</span>
        ) : (
          <>
            <span className="sr-only">Wod Wiki home</span>
            <span role="tooltip" className={TOOLTIP_CLASS}>
              Wod Wiki home
            </span>
          </>
        )}
      </button>
      <nav
        aria-label="Primary"
        className={
          isMobileList
            ? 'flex w-full flex-col gap-0.5'
            : 'flex w-full flex-col items-center gap-1.5'
        }
      >
        {items.map(item => {
          const Icon = item.icon as unknown as ComponentType<{ className?: string }>
          const active = isItemActive(item, navState, location as unknown as Location)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                const hasL2 = Boolean(item.panel || (item.children && item.children.length > 0))
                if (!isMobileList || !hasL2 || active) {
                  closeDrawer()
                }
                dispatch({ type: 'SET_ACTIVE_L1', id: item.id })
                executeNavAction(item.action, deps)
              }}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              data-testid={`nav-l1-${item.id}`}
              className={
                isMobileList
                  ? mobileRowClass(active)
                  : cn(
                      'group relative grid size-9 place-items-center rounded-lg transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )
              }
            >
              {!isMobileList && active && (
                <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <Icon className={isMobileList ? 'size-4 shrink-0' : 'size-5'} />
              {isMobileList ? (
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              ) : (
                <>
                  <span className="sr-only">{item.label}</span>
                  <span role="tooltip" className={TOOLTIP_CLASS}>
                    {item.label}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </nav>

      <div className="flex-1 min-h-2" />

      <button
        type="button"
        onClick={onSearch}
        title="Search (⌘/)"
        aria-label="Search"
        data-testid={TEST_IDS.NAV_L1_SEARCH}
        className={
          isMobileList
            ? mobileRowClass(false)
            : 'group relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
        }
      >
        <MagnifyingGlassIcon className={isMobileList ? 'size-4 shrink-0' : 'size-5'} />
        {isMobileList ? (
          <span className="min-w-0 flex-1 truncate">Search</span>
        ) : (
          <>
            <span className="sr-only">Search</span>
            <span role="tooltip" className={TOOLTIP_CLASS}>
              Search (⌘/)
            </span>
          </>
        )}
      </button>
      {/* Buy Me a Coffee — under search, above Settings; external link. */}
      <a
        href={BUY_ME_A_COFFEE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Buy Me a Coffee"
        aria-label="Buy Me a Coffee"
        className={
          isMobileList
            ? mobileRowClass(false)
            : 'group relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
        }
      >
        <BuyMeACoffeeIcon className={isMobileList ? 'size-4 shrink-0' : 'size-5'} />
        {isMobileList ? (
          <span className="min-w-0 flex-1 truncate">Buy Me a Coffee</span>
        ) : (
          <>
            <span className="sr-only">Buy Me a Coffee</span>
            <span role="tooltip" className={TOOLTIP_CLASS}>
              Buy Me a Coffee
            </span>
          </>
        )}
      </a>

      {/* Profile — between the coffee link and Settings. */}
      <button
        type="button"
        onClick={() => {
          closeDrawer()
          void navigate('/settings/profile')
        }}
        title="Profile"
        aria-label="Profile"
        aria-current={isProfileActive ? 'page' : undefined}
        data-testid="nav-profile"
        className={
          isMobileList
            ? cn(mobileRowClass(isProfileActive), 'mt-0.5')
            : cn(
                'group relative grid size-9 place-items-center rounded-lg transition-colors mt-1.5',
                isProfileActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
        }
      >
        {!isMobileList && isProfileActive && (
          <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        )}
        <UserRound className={isMobileList ? 'size-4 shrink-0' : 'size-5'} />
        {isMobileList ? (
          <span className="min-w-0 flex-1 truncate">Profile</span>
        ) : (
          <>
            <span className="sr-only">Profile</span>
            <span role="tooltip" className={TOOLTIP_CLASS}>
              Profile
            </span>
          </>
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          closeDrawer()
          void navigate('/settings/appearance')
        }}
        title="Settings"
        aria-label="Settings"
        aria-current={isSettingsActive ? 'page' : undefined}
        data-testid="nav-settings"
        className={
          isMobileList
            ? cn(mobileRowClass(isSettingsActive), 'mt-0.5')
            : cn(
                'group relative grid size-9 place-items-center rounded-lg transition-colors mt-1.5',
                isSettingsActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
        }
      >
        {!isMobileList && isSettingsActive && (
          <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        )}
        <Settings className={isMobileList ? 'size-4 shrink-0' : 'size-5'} />
        {isMobileList ? (
          <span className="min-w-0 flex-1 truncate">Settings</span>
        ) : (
          <>
            <span className="sr-only">Settings</span>
            {/* Hover/focus popover: label + build version. */}
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-0 left-full z-50 ml-2 w-max rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              Settings (v{APP_VERSION})
            </span>
          </>
        )}
      </button>
    </>
  )
}
