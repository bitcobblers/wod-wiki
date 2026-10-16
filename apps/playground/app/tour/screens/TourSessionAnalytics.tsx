/**
 * TourSessionAnalytics.tsx — the explore-section stage pane: the session
 * adapter between the homepage tour and the production WQL/dashboard stack.
 *
 * Four panes driven by the wql-* stages:
 *  - wql-idea: the WQL vocabulary strip (shared with the showcase tiles).
 *  - wql-table: a REAL WqlTable running the caption-selected query against
 *    one of two clearly labelled sources — 'Example data' (the isolated
 *    in-memory dataset, the populated default; never writes to visitor
 *    storage and never calls loadSampleData) or 'This run' (the live store,
 *    scoped to the run's note with a `note:<id>` filter when a run exists).
 *    A floating Revert appears whenever the query diverges from the source
 *    default.
 *  - wql-dashboard: a REAL seeded board (markdown/dashboards/**) rendered by
 *    the production DashboardView over the example store, with the same
 *    range/unit/inspect wiring as /dashboard/:slug. Caption buttons switch
 *    boards.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { queryService } from '@/services/queryService'
import { getHomeExampleQueryService } from '../homeAnalyticsData'
import { type AnyParsedQuery, type QueryResult } from '@bitcobblers/wod-wiki-engine'
import { RangeSelector, DashboardView, WqlTable } from '@bitcobblers/wod-wiki-ui'
import { parseDashboardNote, buildDashboardDocument, defaultTokenValues, type DashboardWidget as ModelWidget } from '@bitcobblers/wod-wiki-wql'
import { useAnalyticsRange } from '../../hooks/useAnalyticsRange'
import { PanelSizeProvider, usePanelSize } from '@/panels/panel-system/PanelSizeContext'
import { buildDashboardSeeds } from '../../lib/dashboardSeeds'
import { useSeedContent } from '@/services/content/seedContent'
import { WidgetComposerDialog } from '../../views/dashboards/WidgetComposerDialog'
import { StreamQueryBar } from '../../views/stream/StreamQueryBar'
import { VocabularyStrip } from '../HomeAnalyticsSection'

/** Caption command key → base (unscoped) WQL query + display unit. */
export const TABLE_QUERIES: Record<string, { query: string; unit: string }> = {
  'q-elapsed': { query: 'sum:elapsed{} by {effort}', unit: 's' },
  'q-reps': { query: 'sum:totalReps{} by {effort}', unit: 'reps' },
  'q-tonnage': { query: 'sum:totalVolume{} by {week}', unit: 'kg' },
  'q-tis': { query: 'avg:tis{}', unit: 'pts' },
}
export const DEFAULT_TABLE_QUERY_KEY = 'q-elapsed'

/** Boards addressable from the wql-dashboard caption buttons. */
export const BOARD_SLUGS = ['training-block-review', 'road-to-560-total', 'polarized-base-marathon'] as const
export const DEFAULT_BOARD_SLUG = 'training-block-review'

/**
 * Scope a code-owned base query to one playground note (`note:<id>` filter).
 * AST-safe: merges into the existing filter braces without a trailing comma
 * (`{}` → `{note:<id>}`; `{discipline:strength}` → `{note:<id>, discipline:strength}`).
 */
export function scopeQueryToNote(query: string, noteId: string): string {
  const open = query.indexOf('{')
  if (open === -1) return `${query}{note:${noteId}}`
  const close = query.indexOf('}', open)
  const inner = query.slice(open + 1, close).trim()
  const merged = inner ? `note:${noteId}, ${inner}` : `note:${noteId}`
  return `${query.slice(0, open)}{${merged}}${query.slice(close + 1)}`
}

export interface TourSessionAnalyticsProps {
  /** Active stage id (or the section's fixed pane id). */
  activeStageId: string
  /** Current playground run's note id — null before the first run. */
  noteId: string | null
  /** Caption-selected table query key (TABLE_QUERIES keys). */
  queryKey: string
  /** Caption-selected board slug (BOARD_SLUGS entries). */
  boardSlug: string
}

export function TourSessionAnalytics({
  activeStageId,
  noteId,
  queryKey,
  boardSlug,
}: TourSessionAnalyticsProps) {
  switch (activeStageId) {
    case 'wql-table':
      return <SessionTablePane noteId={noteId} queryKey={queryKey} />
    case 'wql-dashboard':
      return <DashboardPane boardSlug={boardSlug} />
    default:
      return <VocabularyPane />
  }
}

// ── wql-idea ────────────────────────────────────────────────────────────────

function VocabularyPane() {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-6" data-testid="tour-session-vocab">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Own the analytics
          </span>
          <p className="text-sm text-muted-foreground">
            aggregator · metric · filter · dimension · rollup — the whole
            language fits on one strip.
          </p>
        </div>
        <VocabularyStrip />
      </div>
    </div>
  )
}

// ── wql-table: the session-scoped real table ───────────────────────────────

/**
 * The table answers from ONE of two independent sources:
 *  - 'example': the isolated example dataset (real engine over an in-memory
 *    store — populated by default, clearly labelled, never touching a run
 *    note or visitor storage).
 *  - 'run': the current playground run's note (`note:<id>` filter; the
 *    unscoped journal before the first run) — always truthful.
 * The query is EDITABLE (real WQL composer); the floating Revert returns to
 * the active source's default query.
 */
function SessionTablePane(props: { noteId: string | null; queryKey: string }) {
  // Measure the actual pane, not the viewport: this pane is embedded in the
  // tour demo box, where a desktop viewport can still mean a narrow pane.
  return (
    <PanelSizeProvider>
      <SessionTablePaneBody {...props} />
    </PanelSizeProvider>
  )
}

function SessionTablePaneBody({ noteId, queryKey }: { noteId: string | null; queryKey: string }) {
  const { isCompact } = usePanelSize()
  const def = TABLE_QUERIES[queryKey] ?? TABLE_QUERIES[DEFAULT_TABLE_QUERY_KEY]!
  const [source, setSource] = useState<'example' | 'run'>('example')
  const [editedQuery, setEditedQuery] = useState<string | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const presetQuery = source === 'run' && noteId ? scopeQueryToNote(def.query, noteId) : def.query
  const activeQuery = editedQuery ?? presetQuery
  const executor = source === 'example' ? getHomeExampleQueryService() : queryService

  // StreamQueryBar consumes the parsed AST (same seam as the dashboard composer).
  const runQueryExecutor = useCallback(
    (ast: AnyParsedQuery) => executor.runQuery(ast.raw),
    [executor],
  )
  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    void executor.runQuery(activeQuery).then((next) => {
      if (cancelled) return
      if (next.parsed.error) setError(next.parsed.error)
      else setResult(next)
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [activeQuery, executor])

  const hasPoints = !!result && result.series.some((s) => s.points.length > 0)
  const canRevert = editedQuery !== null
  const revert = () => setEditedQuery(null)
  const switchSource = (next: 'example' | 'run') => {
    if (next === source) return
    setSource(next)
    setEditedQuery(null)
  }

  return (
    <div className="relative flex h-full w-full flex-col p-5" data-testid="tour-session-table">
      <div className="flex flex-col items-start gap-3">
        <div className="w-full min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary" data-testid="tour-session-source-label">
            {source === 'example' ? 'Example data' : noteId ? 'This run' : 'Your journal'}
          </div>
          <div className="mt-1">
            <StreamQueryBar
              query={activeQuery}
              onQueryChange={(q) => setEditedQuery(q)}
              scopeOptions={[]}
              execute={runQueryExecutor}
              defaultQuery={presetQuery}
              compact={isCompact}
            />
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {canRevert && (
            <button
              type="button"
              onClick={revert}
              data-testid="tour-session-revert"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Revert
            </button>
          )}
          <div
            role="group"
            aria-label="Data source"
            className="inline-flex overflow-hidden rounded-full border border-border bg-card shadow-sm"
          >
            <button
              type="button"
              onClick={() => switchSource('run')}
              aria-pressed={source === 'run'}
              data-testid="tour-session-source-run"
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${source === 'run' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              This run
            </button>
            <button
              type="button"
              onClick={() => switchSource('example')}
              aria-pressed={source === 'example'}
              data-testid="tour-session-source-example"
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${source === 'example' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Example data
            </button>
          </div>
        </div>
      </div>
      {/* Results sit directly under the query controls (items-start) instead
          of floating mid-pane; the table scrolls here, the header never
          scrolls away. */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto pt-3">
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : result && !hasPoints ? (
          <p className="max-w-sm py-6 text-center text-sm text-muted-foreground" data-testid="tour-session-table-empty">
            {source === 'example' ? 'No example metrics match this query.' : noteId
              ? 'This run has no logged metrics for that query yet. Use Next or Stop to log what you completed.'
              : 'Your journal has no matching metrics yet. Switch to Example data to see these queries answer.'}
          </p>
        ) : result && hasPoints ? (
          <div className="max-h-full w-full max-w-3xl">
            <WqlTable result={result} unit={def.unit} />
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">Running query…</p>
        )}
      </div>
    </div>
  )
}

// ── wql-dashboard: real seeded boards ──────────────────────────────────────

function DashboardPane({ boardSlug }: { boardSlug: string }) {
  const exampleExecutor = getHomeExampleQueryService()
  const files = useSeedContent()
  const seeds = useMemo(() => (files ? buildDashboardSeeds(files) : []), [files])
  const seed = useMemo(
    () => seeds.find((s) => s.slug === boardSlug) ?? seeds[0],
    [seeds, boardSlug],
  )
  const document = useMemo(() => {
    if (!seed?.rawContent) return null
    try {
      const { meta, sections } = parseDashboardNote(seed.rawContent)
      return buildDashboardDocument(sections, meta)
    } catch {
      return null
    }
  }, [seed])

  const [weeks, setWeeks] = useAnalyticsRange()
  // Refresh the query window only when the selected range changes.
  const [rangeStart, rangeEnd] = useMemo(() => {
    const end = Date.now()
    return [end - weeks * 7 * 86400000, end]
  }, [weeks])

  const [inspect, setInspect] = useState<ModelWidget | null>(null)

  return (
    <div className="flex h-full w-full flex-col" data-testid="tour-session-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-primary">
            {seed?.title ?? boardSlug}
          </span>
          <span
            data-testid="tour-session-dashboard-source"
            className="flex-none rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            Example data
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelector weeks={weeks} onWeeksChange={setWeeks} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-3 [&_[data-testid=dashboard-view]>div.grid]:grid-cols-1 [&_[data-testid=dashboard-view]>div.grid]:sm:grid-cols-2 [&_[data-testid=dashboard-view]>div.grid]:lg:grid-cols-2 [&_[data-testid=dashboard-view]>div.grid>*]:col-span-1">
        {document ? (
          <DashboardView
            document={document}
            executor={exampleExecutor}
            onInspectWidget={setInspect}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
          />
        ) : (
          <p className="pt-8 text-center text-sm text-muted-foreground">Loading board…</p>
        )}
      </div>

      <WidgetComposerDialog
        open={inspect !== null}
        onClose={() => setInspect(null)}
        mode="inspect"
        initialWql={inspect?.body ?? 'sum:totalVolume{}'}
        initial={
          inspect
            ? {
                title: inspect.title,
                question: inspect.question,
                type: inspect.type,
                spanCols: inspect.spanCols,
                spanFull: inspect.spanFull,
                attributes: inspect.attributes,
              }
            : undefined
        }
        executor={exampleExecutor}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        tokenValues={document ? defaultTokenValues(document.tokens) : undefined}
        onApply={undefined}
      />
    </div>
  )
}

export default TourSessionAnalytics
