/**
 * SecondaryNav — shell zone 4: the canonical L3 outline, connections & actions rail.
 *
 * Stream controls (`StreamControlsNav`) are retired so resting L3 is 0px on all
 * stream routes. On detail, guide, and dashboard board routes SecondaryNav
 * renders once per breakpoint (inline rail at 2xl+, RightL3Drawer at lg–2xl,
 * and unified bottom sheet inside ResponsiveActionsDock below lg):
 *   1. Modifiers    — `analyticsControls` (range, units kg/lb, query settings).
 *   2. Goto & Links — route-declared `spec` + `l3Items` ("On this page") +
 *                     `l3Connections` ("Connections" — Notebooks, Schedules,
 *                     Pages, Tags, Efforts, Equipment, Related).
 *   3. Actions      — grouped `l3Actions` (`primary` pinned CTA, collapsible
 *                     disclosures for `author` / `organize` / `share` when >= 4
 *                     secondary actions exist, separated red `danger`) +
 *                     `pageAction`.
 */

import { useMemo, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { RangeSelector, useAnalyticsUnitPreference } from '@bitcobblers/wod-wiki-ui'
import { cn } from '@/lib/utils'
import { TEST_IDS } from '@/lib/testIds'

import { MenuList, useActiveSectionId, useResolvedMenu } from './MenuList'
import {
  useNav,
  useOptionalNav,
  type AnalyticsNavControls,
  type L3ActionItem,
} from './NavContext'
import { useCloseNavigationDrawer } from './NavigationDrawerContext'
import { l3ToMenuEntries } from './menuModel'
import type { MenuEntry, MenuSpec } from './menuModel'
import { QuerySettingsTrigger } from '../components/organisms/wql/QuerySettingsTrigger'
import { EXPLORER_RANGE_OPTIONS } from '../hooks/useExplorerQueryState'

/** Secondary actions collapse into native `<details>` disclosures at or above this threshold. */
const COLLAPSE_SECONDARY_THRESHOLD = 4

export function hasVisibleMenuEntries(entries: MenuEntry[] | undefined): boolean {
  if (!entries || entries.length === 0) return false
  return entries.some(entry => {
    if (entry.kind === 'wql') return true
    if (entry.kind === 'section') return hasVisibleMenuEntries(entry.entries)
    return true
  })
}

/**
 * Shared L3 content check used by SidebarLayout (inline rail / RightL3Drawer)
 * and ResponsiveActionsDock (mobile unified bottom sheet). Excludes retired
 * `streamControls` so resting L3 is 0px on all stream routes.
 */
export function useL3HasContent(spec?: MenuSpec, pageAction?: ReactNode): boolean {
  const nav = useOptionalNav()
  return Boolean(
    hasVisibleMenuEntries(spec) ||
      (nav?.l3Items && nav.l3Items.length > 0) ||
      hasVisibleMenuEntries(nav?.l3Connections) ||
      (nav?.l3Actions && nav.l3Actions.length > 0) ||
      nav?.analyticsControls ||
      pageAction,
  )
}

/**
 * AnalyticsControlsNav — L3 Slot 1 modifier block for Dashboard boards and
 * Note pages carrying embedded `query` blocks.
 */
export function AnalyticsControlsNav({ controls }: { controls: AnalyticsNavControls }) {
  const { unit, setUnit } = useAnalyticsUnitPreference()
  const showRange = controls.showRange !== false
  const showUnits = controls.showUnits !== false
  const controlledRange = controls.weeks !== undefined && controls.onWeeksChange !== undefined

  return (
    <div className="flex flex-col gap-3" data-testid={TEST_IDS.L3_ANALYTICS_CONTROLS}>
      {controls.onOpenQuerySettings && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            This page
          </span>
          <QuerySettingsTrigger onOpen={controls.onOpenQuerySettings} />
        </div>
      )}

      {showRange && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Date range
          </span>
          {controlledRange ? (
            <div className="flex flex-col gap-0.5" data-testid={TEST_IDS.L3_RANGE_OPTIONS}>
              {EXPLORER_RANGE_OPTIONS.map(w => {
                const active = controls.weeks === w
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={active}
                    onClick={() => controls.onWeeksChange?.(w)}
                    data-testid={`l3-range-${w}w`}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 max-lg:min-h-11 text-xs transition-colors',
                      active
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-foreground/85 hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <span className="w-3.5 text-primary">
                      {active ? <Check className="size-3.5" aria-hidden="true" /> : null}
                    </span>
                    <span>Past {w} weeks</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <RangeSelector />
          )}
        </div>
      )}

      {showUnits && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Units{controls.unitForced ? ' — pinned by query' : ''}
          </span>
          <div className="grid grid-cols-2 gap-1" data-testid={TEST_IDS.L3_UNIT_OPTIONS}>
            {(['kg', 'lb'] as const).map(u => {
              const active = unit === u
              return (
                <button
                  key={u}
                  type="button"
                  disabled={Boolean(controls.unitForced)}
                  aria-pressed={active}
                  onClick={() => setUnit(u)}
                  data-testid={`l3-unit-${u}`}
                  className={cn(
                    'flex min-h-8 max-lg:min-h-11 items-center justify-center rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                    controls.unitForced
                      ? 'border-transparent text-muted-foreground/75 opacity-70 cursor-not-allowed'
                      : active
                        ? 'border-border/80 bg-card text-foreground shadow-sm'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {u}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function L3ActionRow({
  action,
  variant = 'default',
}: {
  action: L3ActionItem
  variant?: 'primary' | 'default' | 'danger'
}) {
  const closeDrawer = useCloseNavigationDrawer()
  const Icon = action.icon
  return (
    <button
      type="button"
      disabled={action.disabled}
      data-testid={action.testId}
      onClick={() => {
        if (action.disabled) return
        closeDrawer()
        action.onRun()
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        variant === 'primary' &&
          'justify-center bg-primary px-3 py-2 min-h-9 max-lg:min-h-11 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90',
        variant === 'default' &&
          'px-2 py-1.5 max-lg:min-h-11 text-left text-[13px] text-foreground/85 hover:bg-muted/60 hover:text-foreground',
        variant === 'danger' &&
          'px-2 py-1.5 max-lg:min-h-11 text-left text-[13px] font-medium text-destructive hover:bg-destructive/10 hover:text-destructive',
        action.disabled &&
          (variant === 'primary'
            ? 'cursor-not-allowed opacity-50'
            : variant === 'danger'
              ? 'cursor-not-allowed text-destructive/50 hover:bg-transparent'
              : 'cursor-not-allowed text-muted-foreground/60 hover:bg-transparent'),
      )}
    >
      {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
      <span
        className={cn('min-w-0 truncate', variant !== 'primary' && 'flex-1')}
        title={action.label}
      >
        {action.label}
      </span>
    </button>
  )
}

interface SecondaryGroupBucket {
  id: 'author' | 'organize' | 'share'
  label: string
  testId: string
  items: L3ActionItem[]
  extraNode?: ReactNode
}

function L3ActionGroupDisclosure({ bucket }: { bucket: SecondaryGroupBucket }) {
  const count = bucket.items.length + (bucket.extraNode ? 1 : 0)
  return (
    <details
      data-testid={bucket.testId}
      className="group rounded-lg border border-border/40 bg-muted/20"
    >
      <summary className="flex min-h-9 max-lg:min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground/85 select-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">{bucket.label}</span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </summary>
      <div className="flex flex-col gap-0.5 px-1 pb-1.5 pt-0.5">
        {bucket.items.map(action => (
          <L3ActionRow key={action.id} action={action} />
        ))}
        {bucket.extraNode && <div className="pt-0.5">{bucket.extraNode}</div>}
      </div>
    </details>
  )
}

function GroupedL3Actions({
  actions,
  pageAction,
}: {
  actions: L3ActionItem[]
  pageAction?: ReactNode
}) {
  const primaryActions = useMemo(() => actions.filter(a => a.group === 'primary'), [actions])
  const authorActions = useMemo(() => actions.filter(a => a.group === 'author'), [actions])
  const organizeActions = useMemo(
    () => actions.filter(a => a.group === 'organize' || a.group === undefined),
    [actions],
  )
  const shareActions = useMemo(() => actions.filter(a => a.group === 'share'), [actions])
  const dangerActions = useMemo(() => actions.filter(a => a.group === 'danger'), [actions])

  const secondaryCount = authorActions.length + organizeActions.length + shareActions.length
  const collapseSecondary = secondaryCount >= COLLAPSE_SECONDARY_THRESHOLD

  const secondaryBuckets = useMemo<SecondaryGroupBucket[]>(() => {
    const list: SecondaryGroupBucket[] = []
    if (authorActions.length > 0) {
      list.push({
        id: 'author',
        label: 'Author',
        testId: TEST_IDS.L3_ACTIONS_GROUP_AUTHOR,
        items: authorActions,
      })
    }
    if (organizeActions.length > 0) {
      list.push({
        id: 'organize',
        label: 'Organize',
        testId: TEST_IDS.L3_ACTIONS_GROUP_ORGANIZE,
        items: organizeActions,
      })
    }
    if (shareActions.length > 0 || (collapseSecondary && pageAction)) {
      list.push({
        id: 'share',
        label: 'Share & Export',
        testId: TEST_IDS.L3_ACTIONS_GROUP_SHARE,
        items: shareActions,
        extraNode: collapseSecondary ? pageAction : undefined,
      })
    }
    return list
  }, [authorActions, organizeActions, shareActions, collapseSecondary, pageAction])

  return (
    <div className="flex flex-col gap-1.5">
      {primaryActions.length > 0 && (
        <div data-testid={TEST_IDS.L3_ACTIONS_PRIMARY} className="flex flex-col gap-1.5 pb-1">
          {primaryActions.map(action => (
            <L3ActionRow key={action.id} action={action} variant="primary" />
          ))}
        </div>
      )}

      {collapseSecondary ? (
        <div className="flex flex-col gap-1.5">
          {secondaryBuckets.map(bucket => (
            <L3ActionGroupDisclosure key={bucket.id} bucket={bucket} />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            {[...authorActions, ...organizeActions, ...shareActions].map(action => (
              <L3ActionRow key={action.id} action={action} />
            ))}
          </div>
          {pageAction && (
            <div className={cn(secondaryCount > 0 && 'pt-1')}>{pageAction}</div>
          )}
        </>
      )}

      {dangerActions.length > 0 && (
        <div
          data-testid={TEST_IDS.L3_ACTIONS_DANGER}
          className="mt-1 flex flex-col gap-0.5 border-t border-destructive/25 pt-2"
        >
          {dangerActions.map(action => (
            <L3ActionRow key={action.id} action={action} variant="danger" />
          ))}
        </div>
      )}
    </div>
  )
}

export function SecondaryNav({ spec, pageAction }: { spec?: MenuSpec; pageAction?: ReactNode }) {
  const { l3Items, l3Connections, l3Actions = [], analyticsControls } = useNav()
  const resolved = useResolvedMenu(spec)
  const resolvedConnections = useResolvedMenu(l3Connections)
  const toc = useMemo(() => l3ToMenuEntries(l3Items), [l3Items])
  const activeId = useActiveSectionId()

  const hasModifiers = Boolean(analyticsControls)
  const hasResolvedSpec = hasVisibleMenuEntries(resolved)
  const hasToc = toc.length > 0
  const hasConnections = hasVisibleMenuEntries(resolvedConnections)
  const hasGoto = hasResolvedSpec || hasToc || hasConnections
  const hasActions = l3Actions.length > 0 || Boolean(pageAction)

  if (!hasModifiers && !hasGoto && !hasActions) return null

  return (
    <div className="flex flex-col px-3 py-4 gap-4">
      {hasModifiers && (
        <div className={cn('flex flex-col gap-4', (hasGoto || hasActions) && 'pb-3 border-b border-border/50')}>
          {analyticsControls && <AnalyticsControlsNav controls={analyticsControls} />}
        </div>
      )}

      {hasResolvedSpec && <MenuList entries={resolved} activeId={activeId} />}

      {hasToc && (
        <div className="flex flex-col">
          <h2 className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            On this page
          </h2>
          <MenuList entries={toc} activeId={activeId} />
        </div>
      )}

      {hasConnections && (
        <div
          data-testid={TEST_IDS.L3_CONNECTIONS}
          className={cn(
            'flex flex-col gap-1',
            (hasToc || hasResolvedSpec) && 'pt-3 border-t border-border/50',
          )}
        >
          <h2 className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Connections
          </h2>
          <MenuList entries={resolvedConnections} activeId={activeId} />
        </div>
      )}

      {hasActions && (
        <div
          data-testid={TEST_IDS.L3_ACTIONS}
          className={cn('flex flex-col gap-1', hasGoto && 'pt-3 border-t border-border/50')}
        >
          <h2 className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Actions
          </h2>
          <GroupedL3Actions actions={l3Actions} pageAction={pageAction} />
        </div>
      )}
    </div>
  )
}
