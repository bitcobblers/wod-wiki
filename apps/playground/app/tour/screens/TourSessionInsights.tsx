/**
 * TourSessionInsights.tsx — the home page's post-run analytics pane.
 *
 * Two states:
 *  - recorded session present: a session timeline (countdown/rest spans vs
 *    next-click spans, straight from the run's segment log) plus two cards —
 *    Rest/Test Ratio (time on countdown timers vs time to click Next) and
 *    Reaction Time (how long each line waited for its Next click).
 *  - no session yet: a call-to-action pane whose button triggers the
 *    fullscreen run.
 *
 * Data comes from the segment log the runtime already records (see the
 * probe in the tests): block-level `segment` statements carry timeSpan,
 * completionReason (`timer-expired` for countdowns, `user-advance` for
 * Next-click waits) and the parsed per-line metrics.
 */
import { useMemo } from 'react'
import { Play } from 'lucide-react'
import type { Sessions } from '@/components/Editor/types'

// ── Derivation ──────────────────────────────────────────────────────────────

export interface InsightSegment {
  /** Session-relative span in ms. */
  start: number
  end: number
  /** 'clock' = time on a countdown timer; 'next' = time until Next was clicked. */
  kind: 'clock' | 'next'
  label: string
}

export interface SessionInsights {
  segments: InsightSegment[]
  totalMs: number
  /** Time on countdown timers (the rest side of the ratio). */
  clockMs: number
  /** Time from line-shown to Next click (the test side). */
  nextMs: number
  /** Per Next click: ms the line waited. */
  reactions: number[]
}

interface MetricLike {
  type?: string
  value?: unknown
}

/** Parse a segment log into insights; null when nothing is measurable. */
export function deriveSessionInsights(result: Sessions): SessionInsights | null {
  const base = Number.isFinite(result.startTime) ? result.startTime : 0
  const segments: InsightSegment[] = []
  for (const log of result.logs ?? []) {
    if (log.outputType !== 'segment') continue
    if (log.stackLevel !== 1 || log.line == null) continue
    const span = log.timeSpan
    if (!span || typeof span.started !== 'number' || typeof span.ended !== 'number') continue
    if (span.ended <= span.started) continue
    const metrics = (log.metrics ?? []) as MetricLike[]
    const has = (type: string) => metrics.some((m) => m.type === type)
    const effort = metrics.find((m) => m.type === 'effort' && typeof m.value === 'string')
    const kind = has('duration') && !has('rep') ? 'clock'
      : log.completionReason === 'user-advance' ? 'next'
      : null
    if (!kind) continue
    segments.push({
      start: span.started - base,
      end: span.ended - base,
      kind,
      label: (effort?.value as string) ?? `Line ${log.line + 1}`,
    })
  }
  if (segments.length === 0) return null
  const totalMs = Number.isFinite(result.duration) && result.duration > 0
    ? result.duration
    : Math.max(...segments.map((s) => s.end))
  const clockMs = segments.filter((s) => s.kind === 'clock').reduce((acc, s) => acc + (s.end - s.start), 0)
  const nextMs = segments.filter((s) => s.kind === 'next').reduce((acc, s) => acc + (s.end - s.start), 0)
  const reactions = segments.filter((s) => s.kind === 'next').map((s) => s.end - s.start)
  return { segments, totalMs, clockMs, nextMs, reactions }
}

// ── Formatting ──────────────────────────────────────────────────────────────

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ms → seconds with one decimal — named computation used in both reaction readouts.
const fmtSeconds = (ms: number) => `${(Math.round(ms / 100) / 10).toFixed(1)}s`

// ── Pane ────────────────────────────────────────────────────────────────────

/** The no-run-yet call to action — shared by the insights result pane and
 *  the session slide of the dashboards carousel. */
export function InsightsRunCta({ onRun }: { onRun: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center" data-testid="tour-insights-empty">
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        Run the workout and this window turns your run into data — rest vs. work,
        how fast you answered the clock, round by round.
      </p>
      <button
        type="button"
        onClick={onRun}
        data-testid="tour-insights-run"
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90"
      >
        <Play className="size-4" />
        Run to view the results
      </button>
    </div>
  )
}

export interface TourSessionInsightsProps {
  result: Sessions | null
  /** CTA: start the fullscreen run. */
  onRun: () => void
}

export function TourSessionInsights({ result, onRun }: TourSessionInsightsProps) {
  const insights = useMemo(() => (result ? deriveSessionInsights(result) : null), [result])

  if (!result || !insights) {
    return <InsightsRunCta onRun={onRun} />
  }

  const { segments, totalMs, clockMs, nextMs, reactions } = insights
  const avgReaction = reactions.length > 0 ? reactions.reduce((a, b) => a + b, 0) / reactions.length : 0
  const maxReaction = reactions.length > 0 ? Math.max(...reactions) : 0
  const ratio = nextMs > 0 ? clockMs / nextMs : 0

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4" data-testid="tour-insights">
      {/* Session timeline — one bar per recorded span, proportional widths. */}
      <div data-testid="tour-insights-timeline">
        <div className="flex h-3 w-full overflow-hidden rounded-full border border-border/60 bg-muted/40">
          {segments.map((segment, i) => (
            <div
              key={i}
              title={`${segment.label} — ${segment.kind === 'clock' ? 'countdown' : 'to Next'} ${fmtClock(segment.end - segment.start)}`}
              className="h-full"
              style={{
                flexGrow: segment.end - segment.start,
                flexBasis: 0,
                backgroundColor: segment.kind === 'clock' ? 'hsl(var(--metric-rest))' : 'hsl(var(--metric-time))',
                marginLeft: i > 0 ? 1 : 0,
              }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ backgroundColor: 'hsl(var(--metric-rest))' }} />
            Countdown
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ backgroundColor: 'hsl(var(--metric-time))' }} />
            To Next click
          </span>
          <span className="ml-auto">{fmtClock(totalMs)} total</span>
        </div>
      </div>

      {/* The two cards. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-testid="tour-insights-ratio" className="rounded-xl border border-border bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Rest / Test Ratio</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-foreground">
            1 : {ratio > 0 ? (nextMs / Math.max(clockMs, 1)).toFixed(1) : '∞'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {fmtClock(clockMs)} on countdown timers · {fmtClock(nextMs)} to click Next
          </p>
        </div>
        <div data-testid="tour-insights-reaction" className="rounded-xl border border-border bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reaction Time</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-foreground">
            {reactions.length > 0 ? fmtSeconds(avgReaction) : '—'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {reactions.length} click{reactions.length === 1 ? '' : 's'}
            {reactions.length > 1 ? ` · slowest ${fmtSeconds(maxReaction)}` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

export default TourSessionInsights
