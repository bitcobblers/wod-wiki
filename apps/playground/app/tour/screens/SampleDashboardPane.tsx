/**
 * SampleDashboardPane.tsx — one seeded example board rendered over the
 * isolated example store (moved verbatim from the retired
 * TourSessionAnalytics explore pane; the home sample-dashboards section
 * mounts two of these).
 */
import { useMemo, useState } from 'react'
import { getHomeExampleQueryService } from '../homeAnalyticsData'
import { RangeSelector, DashboardView } from '@bitcobblers/wod-wiki-ui'
import { parseDashboardNote, buildDashboardDocument, defaultTokenValues, type DashboardWidget as ModelWidget } from '@bitcobblers/wod-wiki-wql'
import { useAnalyticsRange } from '../../hooks/useAnalyticsRange'
import { buildDashboardSeeds } from '../../lib/dashboardSeeds'
import { useSeedContent } from '@/services/content/seedContent'
import { WidgetComposerDialog } from '../../views/dashboards/WidgetComposerDialog'

export function SampleDashboardPane({ boardSlug }: { boardSlug: string }) {
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
