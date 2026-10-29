/**
 * StreamQueryBar — the compact WQL query bar that lives IN the header.
 * Its contextual writer expands to a second row inside the sticky boundary.
 *
 * Desktop: the shared WqlComposer in compact mode IS the bar — kind, target
 * and Where-stored scope chips with one searchable picker; favorites
 * (`scopeOptions`) prioritize choices without ever defining validity. There
 * is no header-local parser, draft text or separate scope dropdown. The full
 * query dialog stays reachable through the View menu and the global
 * ⌘/ palette; Apply writes the composed WQL back through `onQueryChange`
 * (URL `?q=` follows).
 *
 * `compact` (mobile) renders the summary row that portals into the app
 * navbar: tapping opens the shared palette dialog (view settings lives in
 * the mobile dock, owned by ResponsiveActions).
 */

import { useCallback } from 'react'
import { ChevronUp, Search } from 'lucide-react'
import { WqlComposer, type WqlExecutor } from '@bitcobblers/wod-wiki-ui'
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
  /** Canonical route id — when present, the desktop WQL line gains a save
   *  icon that stores the current query as a route shortcut. */
  route?: string
  /** Compact (mobile) variant — summary line instead of the composer. */
  compact?: boolean
  className?: string
}

/** Open the shared query dialog (palette WQL mode) on `query`; Apply writes
 *  the composed WQL through `onApply`. */
export function openStreamQueryEditor(
  query: string,
  execute: WqlExecutor,
  onApply: (wql: string) => void,
  scopeOptions?: readonly string[],
): void {
  void usePaletteStore.getState().open({
    placeholder: 'Craft the query…',
    wql: { initialQuery: query, execute, onApply, preferredChoices: scopeOptions },
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
  const openEditor = useCallback(
    () => openStreamQueryEditor(query, execute, onQueryChange, scopeOptions),
    [query, execute, onQueryChange, scopeOptions],
  )

  if (compact) {
    // Mobile thumb-footer button row — the summary control (48px target)
    // opens the WQL palette; the trailing save icon stores the current
    // query as a route shortcut. Same border token as the desktop composer
    // box so both variants read as one chrome. An empty draft summarizes
    // the route's actual default query.
    return (
      <div
        data-testid="stream-query-bar-dock"
        className={cn(
          'flex min-h-12 w-full items-stretch overflow-hidden rounded-xl border border-border bg-muted/40 shadow-xs',
          className,
        )}
      >
        <button
          type="button"
          data-testid="stream-query-bar"
          onClick={openEditor}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/70"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            data-testid="stream-query-summary"
            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          >
            {query || defaultQuery || 'Filter or search…'}
          </span>
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="stream-query-bar"
      className={cn('flex min-w-0 flex-1 items-center gap-1 text-xs', className)}
    >
      {/* Shared composer — fills the row left empty by the removed title. */}
      <WqlComposer
        query={query}
        onQueryChange={onQueryChange}
        compact
        showDiagnostics={false}
        preferredChoices={scopeOptions}
        placeholder="Filter or search…"
        className="min-w-0 flex-1"
      />
    </div>
  )
}
