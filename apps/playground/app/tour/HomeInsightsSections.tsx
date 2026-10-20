/**
 * HomeInsightsSections.tsx — ONE parallax session covering both data views.
 * A sticky viewport flips scope as the copy scrolls past it:
 *
 *   01 Your Session, Analyzed → the recorded run's own result: the output
 *      statements table (the same data the note gets), or the run-to-view
 *      CTA while nothing is recorded yet.
 *      Session Insights       → the run turned into data: rest vs. work,
 *      how fast you answered the clock, round by round.
 *   02 One Run Becomes Many   → the seeded example dashboards — distinct
 *      ways of aggregating workout data behind flexible search criteria.
 *
 * Desktop (lg+): the copy steps scroll beside the sticky pane; an
 * IntersectionObserver band centred on the viewport flips the scope.
 * Mobile: each step renders its copy followed by its pane, sequentially.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import type { Sessions } from '@/components/Editor/types'
import { SCREEN_TITLES } from './tourConstants'
import { TourSessionInsights, InsightsRunCta } from './screens/TourSessionInsights'
import { TourSessionResult } from './screens/TourSessionResult'
import { SampleDashboardPane } from './screens/SampleDashboardPane'
import { cn } from '@/lib/utils'

type Scope = 'result' | 'analytics' | 'boards'
const SCOPES: readonly Scope[] = ['result', 'analytics', 'boards']

const STEP_COPY: Record<Scope, { index?: string; heading: 'h2' | 'h3'; title: string; blurb: string }> = {
  result: {
    index: '01',
    heading: 'h2',
    title: 'Your Session, Analyzed',
    blurb:
      'The run you just did is already data — every statement it recorded lands here as a queryable table, the same format your note gets. Nothing to fill in; it comes straight from the run.',
  },
  analytics: {
    heading: 'h3',
    title: 'Session Insights',
    blurb:
      'Run the workout and this window turns your run into data — rest vs. work, how fast you answered the clock, round by round.',
  },
  boards: {
    index: '02',
    heading: 'h2',
    title: 'One Run Becomes Many',
    blurb:
      'Dashboards let you visualise your progress — every recorded run rolls up into analytics boards. Aggregate results across flexible search criteria, from note frontmatter to session metrics: one run becomes many insights.',
  },
}

function StepCopy({ scope }: { scope: Scope }) {
  const copy = STEP_COPY[scope]
  const Tag = copy.heading
  return (
    <div>
      <Tag className="flex items-baseline gap-4 text-[clamp(26px,3.2vw,44px)] font-extrabold leading-[1.1] tracking-[-0.03em]">
        {copy.index && (
          <span className="font-mono text-xs font-normal tracking-normal text-muted-foreground">{copy.index}</span>
        )}
        <span>{copy.title}</span>
      </Tag>
      <p className="mt-3 max-w-xl text-[clamp(14px,1.2vw,18px)] leading-[1.65] text-muted-foreground">{copy.blurb}</p>
    </div>
  )
}

/** The example dashboards — swapped for new data as more boards land. */
const DASHBOARD_SLIDES = [
  { id: 'road-to-560-total', label: 'Road to 560 Total', title: 'Road to 560 Total' },
  { id: 'polarized-base-marathon', label: 'Polarized Base', title: 'Polarized Base Marathon' },
] as const

export interface InsightsDashboardsSectionProps {
  /** The recorded run feeding the result/analytics scopes (null → CTAs). */
  session: Sessions | null
  /** CTA: launch the fullscreen run. */
  onRun: () => void
}

export function InsightsDashboardsSection({ session, onRun }: InsightsDashboardsSectionProps) {
  const [scope, setScope] = useState<Scope>('result')
  const [slide, setSlide] = useState(0)
  const active = DASHBOARD_SLIDES[slide]
  const stepRefs = useRef(new Map<Scope, HTMLElement>())

  // Scroll-spy: whichever step's copy sits in the middle band of the
  // viewport becomes the sticky pane's scope.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const s = entry.target.getAttribute('data-scope')
          if (s === 'result' || s === 'analytics' || s === 'boards') setScope(s)
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    stepRefs.current.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const setStepRef = (s: Scope) => (el: HTMLElement | null) => {
    if (el) stepRefs.current.set(s, el)
    else stepRefs.current.delete(s)
  }

  const scopePane = (s: Scope) => {
    if (s === 'result') {
      return (
        <MacOSChrome title={session ? SCREEN_TITLES.result : 'Session Insights'} className="h-[460px]">
          {session ? <TourSessionResult result={session} /> : <InsightsRunCta onRun={onRun} />}
        </MacOSChrome>
      )
    }
    if (s === 'analytics') {
      return (
        <MacOSChrome title="Session Insights" className="h-[460px]">
          <TourSessionInsights result={session} onRun={onRun} />
        </MacOSChrome>
      )
    }
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Dashboard slides" className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {DASHBOARD_SLIDES.map((sl, i) => (
              <button
                key={sl.id}
                type="button"
                role="tab"
                aria-selected={slide === i}
                aria-pressed={slide === i}
                data-testid={`dashboard-slide-tab-${sl.id}`}
                onClick={() => setSlide(i)}
                className={cn(
                  'min-h-11 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  slide === i ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {sl.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSlide((s) => (s + DASHBOARD_SLIDES.length - 1) % DASHBOARD_SLIDES.length)}
              aria-label="Previous dashboard"
              data-testid="dashboard-slide-prev"
              className="flex size-11 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setSlide((s) => (s + 1) % DASHBOARD_SLIDES.length)}
              aria-label="Next dashboard"
              data-testid="dashboard-slide-next"
              className="flex size-11 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
        <MacOSChrome title={active.title} className="min-h-0 flex-1">
          <div key={active.id} className="flex h-full w-full flex-col" role="tabpanel">
            <SampleDashboardPane boardSlug={active.id} />
          </div>
        </MacOSChrome>
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
          {slide + 1} / {DASHBOARD_SLIDES.length}
        </p>
      </div>
    )
  }

  const stickyPane = (
    <div data-testid="tour-sticky-pane" className="sticky top-[72px] hidden h-[calc(100dvh-72px)] flex-col items-center justify-center self-start lg:top-[104px] lg:flex lg:h-[calc(100dvh-104px)]">
      <div className="relative w-full max-w-[700px]">
        <div className="relative h-[460px]">
          {SCOPES.map((s) => (
            <div
              key={s}
              aria-hidden={scope !== s}
              data-scope-active={scope === s}
              className={cn(
                'absolute inset-0 transition-opacity duration-500',
                scope === s ? 'opacity-100' : 'invisible opacity-0',
              )}
            >
              {scopePane(s)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const desktopStep = (s: Scope, extra?: Record<string, string>) => (
    <div
      ref={setStepRef(s)}
      data-scope={s}
      className="flex min-h-[85vh] flex-col justify-center scroll-mt-[104px]"
      {...extra}
    >
      <StepCopy scope={s} />
    </div>
  )

  const mobileStep = (s: Scope) => (
    <div data-testid={`tour-step-mobile-${s}`} data-scope={s} className="flex flex-col gap-4 lg:hidden">
      <StepCopy scope={s} />
      <div className="h-[460px]">{scopePane(s)}</div>
    </div>
  )

  return (
    <section id="tour-section-insights" data-testid="tour-section-insights" className="border-b border-border/60">
      <div className="mx-auto grid max-w-[1500px] gap-10 px-5 py-14 lg:grid-cols-2 lg:gap-16 lg:px-12 lg:py-0 xl:px-16 2xl:max-w-[1720px]">
        {/* Scrolling copy — desktop steps drive the sticky pane's scope. */}
        <div className="hidden flex-col lg:flex">
          <div id="tour-scroll-target-insights" className="scroll-mt-[72px] lg:scroll-mt-[104px]">
            {desktopStep('result')}
          </div>
          {desktopStep('analytics')}
          {desktopStep('boards', {
            id: 'tour-section-boards',
            'data-testid': 'tour-section-boards',
          })}
        </div>
        {/* Mobile: each step is copy followed by its own pane. */}
        <div className="flex flex-col gap-12 lg:hidden">
          {mobileStep('result')}
          {mobileStep('analytics')}
          {mobileStep('boards')}
        </div>
        {stickyPane}
      </div>
    </section>
  )
}
