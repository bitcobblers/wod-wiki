/**
 * ConditionsNavPanel — the shared L2 panel for the list routes
 * (/notebooks /notes /feeds /pages /efforts /equipment /sessions) and,
 * via NotebookZonePanel, the journal (/journal, /day/:date) and
 * playgrounds (/playgrounds, /playground/:id) views inside the notebooks
 * zone — one route-keyed panel per view.
 *
 * Navigation and discovery only: chrome rows (create action, landing row,
 * Custom row with save/clear, saved shortcuts, page actions) plus a Recent
 * section linking the committed results of the CURRENT route+query. L2 never
 * renders where-clause filters — those moved to the L3 stream controls
 * (StreamControlsNav ▸ FacetProperties, via the rail, the header ⋯ dropdown
 * and the mobile thumb ⋯ sheet).
 *
 * Grouping presets ("Arrange by …", "All time") ride the CURRENT query as
 * their base — never the profile default — and page actions (Feeds, the
 * landing row) stay plain routes.
 */

import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { BookmarkPlus, Plus, X } from 'lucide-react'

import { parseQuery } from '@bitcobblers/wod-wiki-wql'

import { SidebarItem, SidebarLabel, SidebarSection, SidebarHeading } from '@/components/organisms/layout/Sidebar'

import { SaveWqlShortcutDialog } from '../../components/organisms/wql/SaveWqlShortcutDialog'

import { useAppliedRouteWqlConfig } from '../../lib/routeWqlConfig'
import { ALL_SHORTCUT_ID, SHORTCUT_ICONS, shortcutMatches, useRouteShortcuts } from '../../lib/routeWqlShortcuts'
import type { StreamProfile } from '../../views/stream/streamProfile'
import { useStreamResults } from '../../views/stream/streamResults'
import { entryOpenHref } from '../../lib/entryActions'

import type { NavItem, NavPanelProps } from '../navTypes'
import { executeNavAction } from '../navTypes'
import { useCloseNavigationDrawer } from '../NavigationDrawerContext'
import { useNav } from '../NavContext'
import { navigateToQuery } from './FacetProperties'

export interface ConditionsPanelSpec {
  /** Landing ("All …") row label and route. */
  landingLabel: string
  icon: NavItem['icon']
  route: string
  profile: StreamProfile
  /** Plain page actions after the presets (e.g. Feeds). */
  extraChildren?: NavItem[]
  /** Whole zone route family (drives landing-row + L1 activation). */
  familyActive: (loc: Location) => boolean
  createAction?: {
    label: string
    icon?: NavItem['icon']
    testId?: string
    onClick: (deps: { navigate: (to: string) => void; openCreateJournal: (opts?: { mode?: 'blank' | 'source' }) => void }) => void
  }
}

const urlQuery = (loc: Location): string => new URLSearchParams(loc.search).get('q') ?? ''

/** Deterministic cap on the L2 Recent links — the committed run's head rows. */
export const RECENT_RESULTS_LIMIT = 8

export function createConditionsNavPanel(spec: ConditionsPanelSpec) {
  return function ConditionsNavPanel(_props: NavPanelProps | Record<string, unknown>) {
    const location = useLocation()
    const navigate = useNavigate()
    const { openCreateJournal } = useNav()
    // The Route-Default overlay resolves LIVE, so the panel and the view
    // agree on the fallback — and a save in the page's own query settings
    // is reflected here without a reload.
    const profile = useAppliedRouteWqlConfig(spec.profile)

    const rawQ = urlQuery(location)
    const effectiveQuery = rawQ && !parseQuery(rawQ).error ? rawQ : profile.defaultWql

    const apply = (wql: string) => navigateToQuery(location, navigate, wql)
    // Full-query shortcuts (landing row, grouping presets, page actions)
    // replace the whole query/page — the drawer closes after navigating.
    // Facet edits intentionally keep it open.
    const closeNavigationDrawer = useCloseNavigationDrawer()

    // Recent — the committed run for THIS route+query (both must match, so a
    // previous page's or a superseded draft's results never appear). The
    // facets' pending-stale display is deliberately not mirrored here: links
    // are discovery, they hide until a matching run commits. No query
    // execution — the panel subscribes to the view's published snapshot.
    const published = useStreamResults()
    const recentEntries =
      published && published.pathname === location.pathname && published.query === effectiveQuery
        ? published.entries.slice(0, RECENT_RESULTS_LIMIT)
        : []

    // Saved shortcuts (routeWqlShortcuts): the built-in library-group links
    // (landing, Feeds route action) plus the user's saved full-WQL links
    // (grouping `by {}` is simply part of a saved query — the per-section
    // Group-by checkbox owns ad-hoc grouping edits). Matching is full-query
    // and permutation-insensitive on WHERE items / group dimensions, so a
    // base All link never matches a custom filter and an unmatched query is
    // the Custom row above the Create action. Writes elsewhere (WQL line,
    // Settings) land here live via useRouteShortcuts.
    const shortcuts = useRouteShortcuts(spec.route)
    const matchCtx = { pathname: location.pathname, query: urlQuery(location) }
    const allShortcut = shortcuts.find(s => s.id === ALL_SHORTCUT_ID) ?? null
    const userShortcuts = shortcuts.filter(s => s.to === undefined && s.id !== ALL_SHORTCUT_ID)
    const landingWql = allShortcut?.wql ?? ''
    const landingLabel = allShortcut?.label ?? spec.landingLabel
    const LandingIcon = allShortcut ? SHORTCUT_ICONS[allShortcut.icon]! : spec.icon
    const customQuery =
      matchCtx.query && !parseQuery(matchCtx.query).error && !shortcuts.some(s => shortcutMatches(s, matchCtx))
        ? effectiveQuery
        : null
    const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false)

    // Full-bleed over the SidebarBody gutter: sections span the whole L2
    // view; shortcuts rows and the Recent list re-inset rows.
    return (
      <div className="-mx-4 flex flex-col gap-1 py-3" data-testid="conditions-nav-panel">
        <SidebarSection className="px-6">
          {spec.createAction && (() => {
            const CreateIcon = spec.createAction.icon ?? Plus
            return (
              <div className="mb-2">
                <button
                  type="button"
                  data-testid={spec.createAction.testId ?? 'conditions-nav-create'}
                  onClick={() => {
                    spec.createAction!.onClick({
                      navigate,
                      openCreateJournal: (opts) => openCreateJournal?.(opts),
                    })
                    closeNavigationDrawer()
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm"
                >
                  <CreateIcon className="size-4 shrink-0" />
                  <span>{spec.createAction.label}</span>
                </button>
              </div>
            )
          })()}
          {customQuery ? (
            <div className="flex items-center gap-1" data-testid="conditions-nav-custom">
              <SidebarItem
                current
                className="min-w-0 flex-1"
                title={customQuery}
                aria-label={`Custom query: ${customQuery}`}
                onClick={() => {
                  apply(customQuery)
                  closeNavigationDrawer()
                }}
              >
                {LandingIcon && <LandingIcon data-slot="icon" />}
                <SidebarLabel>Custom</SidebarLabel>
              </SidebarItem>
              <button
                type="button"
                onClick={() => setShortcutEditorOpen(true)}
                aria-label="Save shortcut"
                title="Save shortcut"
                data-testid="conditions-nav-custom-save"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <BookmarkPlus className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (landingWql) {
                    apply(landingWql)
                  } else {
                    navigate(spec.route)
                  }
                  closeNavigationDrawer()
                }}
                aria-label="Clear query"
                title="Clear to all entries"
                data-testid="conditions-nav-custom-clear"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <SidebarItem
              onClick={() => {
                if (landingWql) {
                  apply(landingWql)
                } else {
                  navigate(spec.route)
                }
                closeNavigationDrawer()
              }}
              current={
                landingWql && allShortcut
                  ? shortcutMatches(allShortcut, matchCtx)
                  : spec.familyActive(location) && urlQuery(location).trim() === ''
              }
            >
              {LandingIcon && <LandingIcon data-slot="icon" />}
              <SidebarLabel>{landingLabel}</SidebarLabel>
            </SidebarItem>
          )}
          {userShortcuts.map(s => {
            const Icon = SHORTCUT_ICONS[s.icon]!
            return (
              <SidebarItem
                key={`shortcut-${s.id}`}
                onClick={() => {
                  if (s.wql) apply(s.wql)
                  else navigate(spec.route)
                  closeNavigationDrawer()
                }}
                current={shortcutMatches(s, matchCtx)}
                data-testid={`nav-shortcut-${s.id}`}
              >
                <Icon data-slot="icon" />
                <SidebarLabel>{s.label}</SidebarLabel>
              </SidebarItem>
            )
          })}
          {(spec.extraChildren ?? []).map(child => {
            const target = child.action.type === 'route' ? child.action.to : null
            const override = target ? shortcuts.find(s => s.to === target) : null
            const OverrideIcon = override ? SHORTCUT_ICONS[override.icon]! : null
            return (
              <SidebarItem
                key={child.id}
                onClick={() => {
                  if (child.action) {
                    executeNavAction(child.action, { navigate, setQueryParam: () => {} })
                    closeNavigationDrawer()
                  }
                }}
                current={child.isActive?.(location) ?? false}
                data-testid={override ? `nav-shortcut-${override.id}` : undefined}
              >
                {OverrideIcon ? <OverrideIcon data-slot="icon" /> : child.icon && <child.icon data-slot="icon" />}
                <SidebarLabel>{override?.label ?? child.label}</SidebarLabel>
              </SidebarItem>
            )
          })}
        </SidebarSection>

        {recentEntries.length > 0 && (
          <SidebarSection className="px-6" data-testid="conditions-nav-recent">
            <SidebarHeading>Recent</SidebarHeading>
            {recentEntries.map(entry => (
              <SidebarItem
                key={`${entry.id}:${entry.block?.blockId ?? ''}`}
                href={entryOpenHref(entry)}
                onClick={closeNavigationDrawer}
                data-testid="conditions-nav-recent-link"
              >
                <SidebarLabel>{entry.title}</SidebarLabel>
              </SidebarItem>
            ))}
          </SidebarSection>
        )}

        <SaveWqlShortcutDialog
          open={shortcutEditorOpen}
          onOpenChange={setShortcutEditorOpen}
          route={spec.route}
          initialQuery={effectiveQuery}
        />
      </div>
    )
  }
}
