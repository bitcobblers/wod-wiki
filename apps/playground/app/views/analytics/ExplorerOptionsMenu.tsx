/**
 * ExplorerOptionsMenu — the Metric Explorer's range / units controls as a
 * single header dropdown.
 *
 * Examples moved into the command bar's combo box (issue #897 — a single
 * home for each control); what remains:
 *   Range    — the analytics time window (Past 4/8/16 weeks), ✓ marks active.
 *   Units    — display-unit preference (kg/lb), ✓ marks active; pinned when
 *            the query forces a unit (`in <unit>`).
 *
 * Hand-rolled popover (same idiom as the composer's ClausePopover) — Radix
 * layers misfire in this repo's jsdom env.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EXPLORER_RANGE_OPTIONS, type ExplorerRangeWeeks } from '../../hooks/useExplorerQueryState'
import { useAnalyticsUnitPreference } from '@bitcobblers/wod-wiki-ui'

export interface ExplorerOptionsMenuProps {
  /** Active analytics range in weeks. */
  weeks: ExplorerRangeWeeks
  onWeeks: (weeks: ExplorerRangeWeeks) => void
  /** When the query pins a unit (`in <unit>`), the units section is inert. */
  unitForced: boolean
  /** Open the page's own query settings (landing default, scope favorites). */
  onOpenQuerySettings?: () => void
}

export function ExplorerOptionsMenu({ weeks, onWeeks, unitForced, onOpenQuerySettings }: ExplorerOptionsMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { unit, setUnit } = useAnalyticsUnitPreference()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        data-testid="explorer-options"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
          open
            ? 'border-primary/60 text-primary bg-primary/10'
            : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
        )}
      >
        <SlidersHorizontal className="size-3.5" />
        Options
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-border bg-card shadow-xl p-1.5"
          data-testid="explorer-options-menu"
        >
          <div className="px-2 pt-1.5 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
            Range
          </div>
          {EXPLORER_RANGE_OPTIONS.map(w => (
            <button
              key={w}
              type="button"
              onClick={pick(() => onWeeks(w))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
            >
              <span className="w-3.5 text-primary">{weeks === w ? <Check className="size-3.5" /> : null}</span>
              Past {w} weeks
            </button>
          ))}

          <div className="mt-1 border-t border-border/60 px-2 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
            Units{unitForced ? ' — pinned by query' : ''}
          </div>
          {(['kg', 'lb'] as const).map(u => (
            <button
              key={u}
              type="button"
              disabled={unitForced}
              onClick={pick(() => setUnit(u))}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                unitForced ? 'text-muted-foreground/50 cursor-not-allowed' : 'text-foreground hover:bg-muted',
              )}
            >
              <span className="w-3.5 text-primary">{unit === u ? <Check className="size-3.5" /> : null}</span>
              {u}
            </button>
          ))}

          {onOpenQuerySettings && (
            <>
              <div className="mt-1 border-t border-border/60 px-2 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                This page
              </div>
              <button
                type="button"
                onClick={pick(onOpenQuerySettings)}
                data-testid="explorer-query-settings"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
              >
                <span className="w-3.5 text-primary" />
                Query settings
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
