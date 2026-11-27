import { Plus, Save, SlidersHorizontal } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives'
import { TEST_IDS } from '@/lib/testIds'
import {
  getFieldsForLevel,
  type EntityLevel,
} from '../../lib/fieldProjection'
import type { LayoutMode, ViewSettings } from '../../lib/viewSettingsStorage'
import { WqlWindowPicker } from './WqlWindowPicker'

const LAYOUT_LABEL: Record<LayoutMode, string> = {
  cards: 'Cards',
  rows: 'Rows',
  feed: 'Feed',
  agenda: 'Agenda',
  planner: 'Planner',
}

const CALENDAR_GROUP_DIMS = new Set(['date', 'day', 'week', 'month', 'year'])

export interface StreamViewPopoverProps {
  level: EntityLevel
  settings: ViewSettings
  /** Effective URL/route-resolved layout; falls back to persisted `settings.layout`. */
  layout?: LayoutMode
  availableLayouts: readonly LayoutMode[]
  availableGroupDims: readonly string[]
  groupDims: readonly string[]
  onLayoutChange: (layout: LayoutMode) => void
  onToggleGroupDim: (dim: string) => void
  onToggleField: (fieldId: string) => void
  onOpenQuerySettings?: () => void
  /** When false (undated routes), hides Date window & calendar grouping dimensions. */
  calendarCapable?: boolean
  /** Current WQL query (used by Date window picker when `calendarCapable`). */
  query?: string
  onQueryChange?: (wql: string) => void
  /** Optional creation action inside the View menu (avoids duplicating standalone header chrome). */
  addActionLabel?: string
  onAddAction?: () => void
  /** Optional dashboard promotion action inside the View menu. */
  onAddToDashboard?: () => void
  addToDashboardDisabled?: boolean
}

export function StreamViewPopover({
  level,
  settings,
  layout,
  availableLayouts,
  availableGroupDims,
  groupDims,
  onLayoutChange,
  onToggleGroupDim,
  onToggleField,
  onOpenQuerySettings,
  calendarCapable = true,
  query,
  onQueryChange,
  addActionLabel,
  onAddAction,
  onAddToDashboard,
  addToDashboardDisabled = false,
}: StreamViewPopoverProps) {
  const activeLayout = layout ?? settings.layout
  const fields = getFieldsForLevel(level)
  const visibleSet = new Set(settings.visibleFields)
  const filteredGroupDims = calendarCapable
    ? availableGroupDims
    : availableGroupDims.filter((dim) => !CALENDAR_GROUP_DIMS.has(dim.toLowerCase()))
  const showDateWindow = calendarCapable && query !== undefined && Boolean(onQueryChange)
  const hasFooterActions = Boolean(onAddAction || onAddToDashboard || onOpenQuerySettings)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={TEST_IDS.STREAM_VIEW_POPOVER_TRIGGER}
            className="h-8 gap-1.5 px-2.5 text-xs font-semibold"
          />
        }
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        <span>View</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {LAYOUT_LABEL[activeLayout]}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        data-testid={TEST_IDS.STREAM_VIEW_POPOVER_CONTENT}
        className="w-72 space-y-3 p-3"
      >
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Layout
          </p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Stream layout">
            {availableLayouts.map((mode) => {
              const active = activeLayout === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onLayoutChange(mode)}
                  aria-pressed={active}
                  className={`rounded-md border px-2 py-1 text-xs font-medium max-lg:min-h-11 transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  {LAYOUT_LABEL[mode]}
                </button>
              )
            })}
          </div>
        </div>

        {showDateWindow && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Date window
            </p>
            <WqlWindowPicker
              query={query!}
              onQueryChange={onQueryChange!}
              className="w-full"
            />
          </div>
        )}

        {filteredGroupDims.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Group by
            </p>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Group by dimension">
              {filteredGroupDims.map((dim) => {
                const active = groupDims.some((d) => d.toLowerCase() === dim.toLowerCase())
                return (
                  <button
                    key={dim}
                    type="button"
                    onClick={() => onToggleGroupDim(dim)}
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-1 text-xs font-medium max-lg:min-h-11 transition-colors ${
                      active
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-card text-foreground hover:bg-muted'
                    }`}
                  >
                    {dim}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Visible fields
          </p>
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-1">
              {fields.map((field) => {
                const active = visibleSet.has(field.id)
                return (
                  <button
                    key={field.id}
                    type="button"
                    onClick={() => onToggleField(field.id)}
                    aria-pressed={active}
                    className={`rounded border px-2 py-0.5 text-xs max-lg:min-h-11 transition-colors ${
                      active
                        ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {field.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {hasFooterActions && (
          <div className="space-y-1 border-t border-border/60 pt-2">
            {onAddAction && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAddAction}
                data-testid={TEST_IDS.STREAM_VIEW_ADD_ACTION}
                className="h-8 max-lg:min-h-11 w-full justify-start gap-2 text-xs font-medium"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{addActionLabel ?? '+ Add'}</span>
              </Button>
            )}
            {onAddToDashboard && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={addToDashboardDisabled}
                onClick={onAddToDashboard}
                data-testid={TEST_IDS.SAVE_STREAM_QUERY}
                className="h-8 max-lg:min-h-11 w-full justify-start gap-2 text-xs font-medium"
              >
                <Save className="size-3.5" aria-hidden="true" />
                <span>Add to dashboard</span>
              </Button>
            )}
            {onOpenQuerySettings && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenQuerySettings}
                className="h-8 max-lg:min-h-11 w-full justify-start text-xs"
              >
                Configure view defaults…
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
