import { SlidersHorizontal } from 'lucide-react'
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

const LAYOUT_LABEL: Record<LayoutMode, string> = {
  cards: 'Cards',
  rows: 'Rows',
  feed: 'Feed',
  agenda: 'Agenda',
  planner: 'Planner',
}

const LAYOUT_SHORT: Record<LayoutMode, string> = {
  cards: 'CRD',
  rows: 'ROW',
  feed: 'FED',
  agenda: 'AGD',
  planner: 'PLN',
}

export interface StreamViewPopoverProps {
  level: EntityLevel
  settings: ViewSettings
  availableLayouts: readonly LayoutMode[]
  availableGroupDims: readonly string[]
  groupDims: readonly string[]
  onLayoutChange: (layout: LayoutMode) => void
  onToggleGroupDim: (dim: string) => void
  onToggleField: (fieldId: string) => void
  onOpenQuerySettings?: () => void
}

export function StreamViewPopover({
  level,
  settings,
  availableLayouts,
  availableGroupDims,
  groupDims,
  onLayoutChange,
  onToggleGroupDim,
  onToggleField,
  onOpenQuerySettings,
}: StreamViewPopoverProps) {
  const fields = getFieldsForLevel(level)
  const visibleSet = new Set(settings.visibleFields)

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
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {LAYOUT_SHORT[settings.layout]}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        data-testid={TEST_IDS.STREAM_VIEW_POPOVER_CONTENT}
        className="w-72 space-y-3 p-3"
      >
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Layout
          </p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Stream layout">
            {availableLayouts.map((mode) => {
              const active = settings.layout === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onLayoutChange(mode)}
                  aria-pressed={active}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
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

        {availableGroupDims.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Group by
            </p>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Group by dimension">
              {availableGroupDims.map((dim) => {
                const active = groupDims.some((d) => d.toLowerCase() === dim.toLowerCase())
                return (
                  <button
                    key={dim}
                    type="button"
                    onClick={() => onToggleGroupDim(dim)}
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
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
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
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
                    className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
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

        {onOpenQuerySettings && (
          <div className="border-t border-border/60 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenQuerySettings}
              className="h-8 w-full justify-start text-xs"
            >
              Configure view defaults…
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
