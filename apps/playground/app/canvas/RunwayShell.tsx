/**
 * RunwayShell.tsx — the shared sticky-parallax runway chrome (single
 * consistent layout for tour + guide runways): outer track (host height) →
 * sticky window under the app nav (65px mobile / 104px lg+, dvh) →
 * context-measured 60/40 demo/caption row (split vs stacked by measured
 * context, never viewport breakpoints). The stage indicator (host status
 * slot + pips) rides RunwayIndicatorContext into the pane's mac window
 * header instead of costing its own row.
 *
 * Presentational only: the host owns the scroll driver (useScrollRunway),
 * screens/rings/runtime and caption content; per-frame work stays in
 * host-owned refs. Named headers render outside the shell.
 */
import { useState, type ReactNode, type Ref } from 'react'
import type { ScrollStage } from './parseCanvasMarkdown'
import { useContextSize } from './contextSize'
import { STICKY_NAV_HEIGHT } from './canvasUtils'
import { ScrollGate } from '../scroll/ScrollTrackProvider'
import { RunwayIndicatorContext } from './runwayIndicator'

export interface RunwayShellProps {
  /** Outer track ref — attach the host's useScrollRunway driver here. */
  trackRef: Ref<HTMLElement>
  /** Track height, e.g. '300vh'. */
  height: string
  /** Stage identities + accents rendered as the pip bar. */
  stages: readonly Pick<ScrollStage, 'id' | 'accent'>[]
  /** Active stage index — drives the pips. */
  activeIndex: number
  /** Stage pane — 60% of the measured context. */
  pane: ReactNode
  /** Caption rail — the other 40%; scrolls internally when one outgrows it. */
  captions: ReactNode
  /** Status slot rendered inside the pane's mac window header (via context). */
  status?: ReactNode
  /**
   * ScrollTrack segment this shell's track belongs to. When set, the
   * caption rail is wrapped in a scroll gate for that segment. Editing or
   * Scroll panel enables its inner scroller; otherwise gestures move the page.
   * Omitted → no gate (canvas guide runways outside a track).
   */
  segmentId?: string
  testId?: string
  className?: string
}

export function RunwayShell({
  trackRef,
  height,
  stages,
  activeIndex,
  pane,
  captions,
  status,
  segmentId,
  testId,
  className,
}: RunwayShellProps) {
  const [contextRow, setContextRow] = useState<HTMLDivElement | null>(null)
  const split = useContextSize(STICKY_NAV_HEIGHT, contextRow).mode === 'split'

  // Stage indicator lives in the pane's mac window header (MacOSChrome reads
  // this context) — it no longer reserves a row of the sticky window.
  const indicator = {
    status,
    pips: (
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {stages.map((seg, i) => {
          const live = activeIndex === i
          const done = activeIndex > i
          return (
            <span
              key={seg.id}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: live ? 30 : 10,
                background: live
                  ? (seg.accent ?? 'hsl(var(--primary))')
                  : done
                    ? 'hsl(var(--foreground))'
                    : 'hsl(var(--foreground) / 0.15)',
              }}
            />
          )
        })}
      </div>
    ),
  }

  return (
    <section
      ref={trackRef}
      data-testid={testId}
      className={className ? `relative ${className}` : 'relative'}
      style={{ height }}
    >
      <RunwayIndicatorContext.Provider value={indicator}>
      <div className="sticky top-[65px] flex h-[calc(100dvh-65px)] flex-col overflow-hidden lg:top-[104px] lg:h-[calc(100dvh-104px)]">
        {/* measured context row: pane 3/5, caption rail 2/5 */}
        <div
          ref={setContextRow}
          className={`mx-auto flex min-h-0 w-full max-w-[1500px] 2xl:max-w-[1720px] flex-1 px-5 pt-2 pb-5 lg:px-10 lg:pt-3 xl:px-16 xl:pb-8 2xl:pb-10 ${
            split ? 'flex-row items-stretch gap-[clamp(20px,2.5vw,56px)] xl:gap-12 2xl:gap-16' : 'flex-col gap-6 xl:gap-8'
          }`}
        >
          <div className="relative min-h-0 min-w-0 flex-[3_1_0%]">{pane}</div>
          <div className="flex min-h-0 min-w-0 flex-[2_1_0%] flex-col">
            {segmentId ? (
              <ScrollGate
                gateId={`${segmentId}-captions`}
                segmentId={segmentId}
                className="relative min-h-0 flex-1"
              >
                {captions}
              </ScrollGate>
            ) : (
              <div className="relative min-h-0 flex-1">{captions}</div>
            )}
          </div>
        </div>
      </div>
      </RunwayIndicatorContext.Provider>
    </section>
  )
}
