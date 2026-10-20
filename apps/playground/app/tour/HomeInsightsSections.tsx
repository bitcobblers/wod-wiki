/**
 * HomeInsightsSections.tsx — the two data sections that follow the hero:
 *
 *  01 · Your Session, Analyzed — the run's own analytics (timeline + the
 *      Rest/Test Ratio and Reaction Time cards), or the run-to-view CTA
 *      while nothing has been recorded yet.
 *  02 · One Run Becomes Many — two example boards over the preloaded
 *      sample data, each a different way of aggregating workout data.
 *
 * Both use the standard tagline-header + macOS-window chrome; no runway —
 * the panes are static content, the run choreography lives in the hero.
 */
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import type { Sessions } from '@/components/Editor/types'
import { TaglineHeader } from './TaglineHeader'
import { TOUR_ACCENTS } from './tourConstants'
import { TourSessionInsights } from './screens/TourSessionInsights'
import { SampleDashboardPane } from './screens/SampleDashboardPane'

export interface SessionInsightsSectionProps {
  /** The recorded run feeding the analytics pane (null → CTA). */
  session: Sessions | null
  /** CTA: launch the fullscreen run. */
  onRun: () => void
}

export function SessionInsightsSection({ session, onRun }: SessionInsightsSectionProps) {
  return (
    <section id="tour-section-insights" data-testid="tour-section-insights" className="flex flex-col gap-4 border-b border-border/60 pb-12">
      <TaglineHeader
        index="01"
        before="Your Session, "
        accentText="Analyzed"
        after=""
        accent={TOUR_ACCENTS.analytics}
        blurb="The run you just did is already data — time on countdown timers against time to the next click, and how fast you answered the clock. Nothing to fill in; it comes straight from the run."
      />
      <div className="mx-auto w-full max-w-[820px] px-5 2xl:max-w-[920px]">
        <MacOSChrome title="Session Insights" className="h-[460px]">
          <TourSessionInsights result={session} onRun={onRun} />
        </MacOSChrome>
      </div>
    </section>
  )
}


/** The two sample boards — distinct aggregation styles over the example store. */
const SAMPLE_BOARD_SLUGS = ['road-to-560-total', 'polarized-base-marathon'] as const

export function SampleDashboardsSection() {
  return (
    <section id="tour-section-boards" data-testid="tour-section-boards" className="flex flex-col gap-4 border-b border-border/60 pb-12">
      <TaglineHeader
        index="02"
        before="One Run Becomes "
        accentText="Many"
        after=""
        accent={TOUR_ACCENTS.analytics}
        blurb="The same recorded facts roll up across workouts — tonnage toward a total, easy vs. hard work over weeks. These boards answer over example data; yours updates as you log."
      />
      <div className="grid gap-4 px-5 lg:grid-cols-2 2xl:gap-6">
        {SAMPLE_BOARD_SLUGS.map((slug) => (
          <MacOSChrome key={slug} title="Example Board" className="h-[520px]">
            <SampleDashboardPane boardSlug={slug} />
          </MacOSChrome>
        ))}
      </div>
    </section>
  )
}
