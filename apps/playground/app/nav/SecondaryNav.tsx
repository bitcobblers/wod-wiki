/**
 * SecondaryNav — shell zone 4: the canonical L3 context action panel.
 *
 * Every page family renders the same 3-slot L3 anatomy across all breakpoints
 * (inline rail at 2xl+, slide-over drawer at lg–2xl, full-width right drawer
 * below lg):
 *   1. Modifiers  — `streamControls` (FacetProperties, date window, group-by,
 *                   layout, fields, query settings) and/or `analyticsControls`
 *                   (range, units kg/lb, query settings).
 *   2. Goto       — route-declared `secondary` spec + `l3Items` ("On this page"
 *                   structural scroll anchors & scroll-spy).
 *   3. Actions    — `l3Actions` + `pageAction` ("Actions" context shortcuts).
 */

import { useMemo, type ReactNode } from 'react'
import { CalendarDays, Check, Columns3, LayoutGrid, Rss, Table } from 'lucide-react'
import { RangeSelector, useAnalyticsUnitPreference } from '@bitcobblers/wod-wiki-ui'
import { cn } from '@/lib/utils'

import { MenuList, useActiveSectionId, useResolvedMenu } from './MenuList'
import {
  useNav,
  type AnalyticsNavControls,
  type L3ActionItem,
  type StreamNavControls,
} from './NavContext'
import { useCloseNavigationDrawer } from './NavigationDrawerContext'
import { l3ToMenuEntries } from './menuModel'
import type { MenuSpec } from './menuModel'
import { WqlWindowPicker } from '../views/stream/WqlWindowPicker'
import { QuerySettingsTrigger } from '../components/organisms/wql/QuerySettingsTrigger'
import type { LayoutMode } from '../lib/viewSettingsStorage'
import { getFieldsForLevel } from '../lib/fieldProjection'
import { EXPLORER_RANGE_OPTIONS } from '../hooks/useExplorerQueryState'
import { FacetProperties } from './panels/FacetProperties'

const LAYOUT_OPTIONS: readonly { id: LayoutMode; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'cards', label: 'Cards', icon: LayoutGrid },
  { id: 'rows', label: 'Rows', icon: Table },
  { id: 'feed', label: 'Feed', icon: Rss },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'planner', label: 'Planner', icon: Columns3 },
]

/**
 * StreamControlsNav — L3 Slot 1 modifier block for stream/library surfaces
 * (query settings + date window + group-by + layout + fields + FacetProperties).
 */
export function StreamControlsNav({ streamControls }: { streamControls: StreamNavControls }) {
  const available = streamControls.availableLayouts
  return (
    <div className="flex flex-col gap-3" data-testid="l3-stream-controls">
      {streamControls.onOpenQuerySettings && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            This page
          </span>
          <QuerySettingsTrigger onOpen={streamControls.onOpenQuerySettings} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Date window
        </span>
        <WqlWindowPicker
          query={streamControls.query}
          onQueryChange={streamControls.onQueryChange}
          className="w-full justify-between"
        />
      </div>

      {/* Group by properties as items to check under it */}
      {streamControls.availableGroupDims.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Group by
          </span>
          <div className="flex flex-col gap-0.5" data-testid="l3-groupby-options">
            {streamControls.availableGroupDims.map(opt => {
              const checked = streamControls.groupDims.some(
                d => d.toLowerCase() === opt.id.toLowerCase()
              )
              return (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/80 hover:bg-muted/60 transition-colors"
                  data-testid={`l3-groupby-${opt.id}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => streamControls.onToggleGroupDim(opt.id)}
                    className="size-3.5 rounded border-border accent-primary cursor-pointer"
                  />
                  <span>{opt.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Layout + visible fields — per-route view settings; cast stays header-only chrome. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Layout
        </span>
        <div className="grid grid-cols-3 gap-1" data-testid="l3-layout-options">
          {LAYOUT_OPTIONS
            .filter(opt => !available || available.includes(opt.id))
            .map(opt => {
              const Icon = opt.icon
              const active = streamControls.settings.layout === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => streamControls.onLayoutChange(opt.id)}
                  data-testid={`l3-layout-${opt.id}`}
                  className={`flex min-h-8 items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-border/80 bg-card text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon aria-hidden className="size-3" />
                  {opt.label}
                </button>
              )
            })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Fields
        </span>
        <div className="flex flex-col gap-0.5" data-testid="l3-field-options">
          {getFieldsForLevel(streamControls.level).map(field => {
            const checked = streamControls.settings.visibleFields.includes(field.id)
            return (
              <label
                key={field.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/80 hover:bg-muted/60 transition-colors"
                data-testid={`l3-field-${field.id}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => streamControls.onToggleField(field.id)}
                  className="size-3.5 rounded border-border accent-primary cursor-pointer"
                />
                <span>{field.label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Where-clause filters over the current query — L3-owned (moved out of
          the L2 ConditionsNavPanel); self-titled, renders nothing without a
          parseable find query. */}
      <FacetProperties />
    </div>
  )
}

/**
 * AnalyticsControlsNav — L3 Slot 1 modifier block for Dashboard boards,
 * Metric Explorer, and Note pages carrying embedded `query` blocks.
 */
export function AnalyticsControlsNav({ controls }: { controls: AnalyticsNavControls }) {
  const { unit, setUnit } = useAnalyticsUnitPreference()
  const showRange = controls.showRange !== false
  const showUnits = controls.showUnits !== false
  const controlledRange = controls.weeks !== undefined && controls.onWeeksChange !== undefined

  return (
    <div className="flex flex-col gap-3" data-testid="l3-analytics-controls">
      {controls.onOpenQuerySettings && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            This page
          </span>
          <QuerySettingsTrigger onOpen={controls.onOpenQuerySettings} />
        </div>
      )}

      {showRange && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Date range
          </span>
          {controlledRange ? (
            <div className="flex flex-col gap-0.5" data-testid="l3-range-options">
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
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                      active
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-foreground/80 hover:bg-muted/60 hover:text-foreground',
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
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Units{controls.unitForced ? ' — pinned by query' : ''}
          </span>
          <div className="grid grid-cols-2 gap-1" data-testid="l3-unit-options">
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
                    'flex min-h-8 items-center justify-center rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                    controls.unitForced
                      ? 'border-transparent text-muted-foreground/50 cursor-not-allowed'
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

function L3ActionRow({ action }: { action: L3ActionItem }) {
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
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
        action.disabled
          ? 'cursor-not-allowed text-muted-foreground/45'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate" title={action.label}>
        {action.label}
      </span>
    </button>
  )
}

export function SecondaryNav({ spec, pageAction }: { spec?: MenuSpec; pageAction?: ReactNode }) {
  const { l3Items, l3Actions = [], streamControls, analyticsControls } = useNav()
  const resolved = useResolvedMenu(spec)
  const toc = useMemo(() => l3ToMenuEntries(l3Items), [l3Items])
  const activeId = useActiveSectionId()

  const hasModifiers = Boolean(streamControls || analyticsControls)
  const hasGoto = resolved.length > 0 || toc.length > 0
  const hasActions = l3Actions.length > 0 || Boolean(pageAction)

  if (!hasModifiers && !hasGoto && !hasActions) return null

  return (
    <div className="flex flex-col px-3 py-4 gap-4">
      {hasModifiers && (
        <div className={cn('flex flex-col gap-4', (hasGoto || hasActions) && 'pb-3 border-b border-border/50')}>
          {streamControls && <StreamControlsNav streamControls={streamControls} />}
          {analyticsControls && <AnalyticsControlsNav controls={analyticsControls} />}
        </div>
      )}

      {resolved.length > 0 && <MenuList entries={resolved} activeId={activeId} />}
      {toc.length > 0 && (
        <div className="flex flex-col">
          <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            On this page
          </div>
          <MenuList entries={toc} activeId={activeId} />
        </div>
      )}

      {hasActions && (
        <div
          data-testid="l3-actions"
          className={cn('flex flex-col gap-0.5', hasGoto && 'pt-2 border-t border-border/50')}
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Actions
          </div>
          {l3Actions.map(action => (
            <L3ActionRow key={action.id} action={action} />
          ))}
          {pageAction && <div className={cn(l3Actions.length > 0 && 'pt-1')}>{pageAction}</div>}
        </div>
      )}
    </div>
  )
}
