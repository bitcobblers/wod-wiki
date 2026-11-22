/**
 * StreamQueryBar — the compact WQL query bar that lives IN the header.
 *
 * Desktop: `<WqlComposer compact surface="popover" />` hiding structural
 * boilerplate pills (`kind`, `target`, route-implied `source`) at rest, paired
 * with a guided `+ Filter` facet popover (`FacetProperties` with explicit
 * Include / Exclude / Off pills). Clicking `[</>]` expands the full raw WQL
 * editor and 4-zone `WHAT/WHERE/WHEN/GROUP` Scope Map cleanly over the page.
 *
 * Mobile (`compact`): renders a human-readable thumb-footer trigger that opens
 * `PaletteShell` as a dedicated Filter Sheet embedding guided `FacetProperties`.
 */

import { useCallback, useMemo, useState } from 'react'
import { ChevronUp, Filter, SlidersHorizontal } from 'lucide-react'
import { isFindQuery, parseQuery } from '@bitcobblers/wod-wiki-wql'
import { formatHumanQuerySummary, WqlComposer, type ClauseType, type WqlExecutor } from '@bitcobblers/wod-wiki-ui'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives'
import { TEST_IDS } from '@/lib/testIds'
import { cn } from '@/lib/utils'
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store'
import { wqlSearchSource } from '../../services/wqlSearchSource'
import { FacetProperties } from '../../nav/panels/FacetProperties'

const BASE_HIDDEN_CLAUSES: ClauseType[] = ['agg', 'metric', 'rollup', 'pipes']

function singlePositiveSource(wql: string): string | null {
  const parsed = parseQuery(wql)
  if (parsed.error || !isFindQuery(parsed)) return null
  const sources = parsed.filters.filter((f) => f.key === 'source' && !f.negate)
  if (sources.length === 1 && sources[0]!.values.length === 1) {
    return sources[0]!.values[0]!.value
  }
  if (sources.length === 0 && parsed.sourceScope?.length === 1) {
    return parsed.sourceScope[0]!
  }
  return null
}

function MobileFacetFilterSheet({
  initialQuery,
  onApply,
}: {
  initialQuery: string
  onApply: (wql: string) => void
}) {
  const [draft, setDraft] = useState(initialQuery)
  const handleChange = useCallback(
    (next: string) => {
      setDraft(next)
      onApply(next)
    },
    [onApply],
  )

  return (
    <div
      data-testid={TEST_IDS.STREAM_MOBILE_FACETS}
      className="max-h-[42vh] overflow-y-auto border-t border-border/60 bg-background/60 px-3 py-2"
    >
      <FacetProperties query={draft} onQueryChange={handleChange} heading="Guided filters" />
    </div>
  )
}

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
  /** True when at least one user-authored filter is active beyond route defaults. */
  hasAppliedFilters?: boolean
  /** Number of user-authored filters (drives the active badge on `+ Filter`). */
  activeFilterCount?: number
  className?: string
}

/** Open the shared query dialog in dedicated Filter Sheet mode on `query`
 *  with guided `FacetProperties`; Apply writes the composed WQL back through `onApply`. */
export function openStreamQueryEditor(
  query: string,
  execute: WqlExecutor,
  onApply: (wql: string) => void,
  scopeOptions?: readonly string[],
): void {
  void usePaletteStore.getState().open({
    placeholder: 'Craft the query…',
    header: <MobileFacetFilterSheet initialQuery={query} onApply={onApply} />,
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
  hasAppliedFilters = false,
  activeFilterCount = 0,
  className,
}: StreamQueryBarProps) {
  const [scopeOpen, setScopeOpen] = useState(false)
  const effectiveWql = query || defaultQuery || ''
  const humanSummary = useMemo(
    () => formatHumanQuerySummary(effectiveWql, 'Filter or search…'),
    [effectiveWql],
  )

  const hiddenClauseTypes = useMemo<ClauseType[]>(() => {
    if (scopeOpen) return BASE_HIDDEN_CLAUSES
    const hidden: ClauseType[] = ['kind', 'target', ...BASE_HIDDEN_CLAUSES]
    if (defaultQuery) {
      const defaultSource = singlePositiveSource(defaultQuery)
      const currentSource = singlePositiveSource(effectiveWql)
      if (defaultSource && currentSource === defaultSource) {
        hidden.push('source')
      }
    }
    return hidden
  }, [scopeOpen, defaultQuery, effectiveWql])

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
          {hasAppliedFilters && activeFilterCount > 0 && (
            <span
              data-testid={TEST_IDS.STREAM_FACET_FILTER_BADGE}
              className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold text-primary-foreground"
            >
              {activeFilterCount}
            </span>
          )}
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid={TEST_IDS.STREAM_QUERY_BAR}
      className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-xs', className)}
    >
      <WqlComposer
        query={query}
        onQueryChange={onQueryChange}
        onScopeOpenChange={setScopeOpen}
        compact
        surface="popover"
        showDiagnostics={false}
        hiddenClauseTypes={hiddenClauseTypes}
        preferredChoices={scopeOptions}
        placeholder="Filter or search…"
        className="min-w-0 flex-1"
      />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant={hasAppliedFilters ? 'secondary' : 'outline'}
              size="sm"
              data-testid={TEST_IDS.STREAM_FACET_FILTER_TRIGGER}
              aria-label={
                hasAppliedFilters && activeFilterCount > 0
                  ? `Guided filters (${activeFilterCount} active)`
                  : 'Open guided filters'
              }
              className="h-8 shrink-0 gap-1.5 px-2.5 text-xs font-semibold"
            />
          }
        >
          <Filter className="size-3.5" aria-hidden="true" />
          <span>Filters</span>
          {hasAppliedFilters && activeFilterCount > 0 && (
            <span
              data-testid={TEST_IDS.STREAM_FACET_FILTER_BADGE}
              className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground"
            >
              {activeFilterCount}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          data-testid={TEST_IDS.STREAM_FACET_FILTER_POPOVER}
          className="w-80 max-h-[70vh] overflow-y-auto p-3"
        >
          <FacetProperties
            query={effectiveWql}
            onQueryChange={onQueryChange}
            heading="Filter facets"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
