/**
 * StreamQueryBar — the compact WQL query bar that lives IN the header.
 *
 * Desktop: `<WqlComposer compact surface="popover" />` — renders Concept A
 * unified Split-Pills in the single-row sticky header at rest. Clicking a pill,
 * `+ Filter`, or `[</>]` turns the pill rail in place into the single live
 * `WqlTextEditor` and drops the floating `WHAT/WHERE/WHEN/GROUP` Scope Map
 * popover cleanly over the page without inflating the header.
 *
 * Mobile (`compact`): renders a human-readable thumb-footer trigger that opens
 * `PaletteShell` as a dedicated 3-region scroll-safe Filter Sheet.
 */

import { useCallback, useMemo } from 'react'
import { ChevronUp, SlidersHorizontal } from 'lucide-react'
import { formatHumanQuerySummary, WqlComposer, type WqlExecutor } from '@bitcobblers/wod-wiki-ui'
import { TEST_IDS } from '@/lib/testIds'
import { cn } from '@/lib/utils'
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store'
import { wqlSearchSource } from '../../services/wqlSearchSource'

export interface StreamQueryBarProps {
  /** The controlled WQL string (the composer query state). */
  query: string
  onQueryChange: (wql: string) => void
  /** Where-stored scope favorites for this route (streamProfile.scopeOptions)
   *  — picker sort priority only, never a validity filter. */
  scopeOptions: readonly string[]
  /** Stage-count executor handed to the palette composer. */
  execute: WqlExecutor
  /** The route's default WQL — composer guidance and the compact dock's
   *  summary when the draft is empty (actual profile default, not a slogan). */
  defaultQuery?: string
  /** Canonical route id — optional route label context. */
  route?: string
  /** Compact (mobile) variant — human-readable thumb-footer trigger. */
  compact?: boolean
  className?: string
}

/** Open the shared query dialog in dedicated Filter Sheet mode on `query`;
 *  Apply writes the composed WQL back through `onApply`. */
export function openStreamQueryEditor(
  query: string,
  execute: WqlExecutor,
  onApply: (wql: string) => void,
  scopeOptions?: readonly string[],
): void {
  void usePaletteStore.getState().open({
    placeholder: 'Craft the query…',
    wql: {
      initialQuery: query,
      execute,
      onApply,
      preferredChoices: scopeOptions,
      hideResults: true,
    },
    sources: [wqlSearchSource()],
  })
}

export function StreamQueryBar({
  query,
  onQueryChange,
  scopeOptions,
  execute,
  defaultQuery,
  compact = false,
  className,
}: StreamQueryBarProps) {
  const effectiveWql = query || defaultQuery || ''
  const humanSummary = useMemo(
    () => formatHumanQuerySummary(effectiveWql, 'Filter or search…'),
    [effectiveWql],
  )

  const openEditor = useCallback(
    () => openStreamQueryEditor(effectiveWql, execute, onQueryChange, scopeOptions),
    [effectiveWql, execute, onQueryChange, scopeOptions],
  )

  if (compact) {
    return (
      <div
        data-testid={TEST_IDS.STREAM_QUERY_BAR_DOCK}
        className={cn(
          'flex min-h-12 w-full items-stretch overflow-hidden rounded-xl border border-border bg-card shadow-xs',
          className,
        )}
      >
        <button
          type="button"
          data-testid={TEST_IDS.STREAM_QUERY_BAR}
          onClick={openEditor}
          title={effectiveWql || undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/60"
        >
          <SlidersHorizontal className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span
            data-testid={TEST_IDS.STREAM_QUERY_SUMMARY}
            data-wql={effectiveWql}
            className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          >
            {humanSummary}
          </span>
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid={TEST_IDS.STREAM_QUERY_BAR}
      className={cn('flex min-w-0 flex-1 items-center gap-1 text-xs', className)}
    >
      <WqlComposer
        query={query}
        onQueryChange={onQueryChange}
        compact
        surface="popover"
        showDiagnostics={false}
        hiddenClauseTypes={['agg', 'metric', 'rollup', 'pipes']}
        preferredChoices={scopeOptions}
        placeholder="Filter or search…"
        className="min-w-0 flex-1"
      />
    </div>
  )
}
