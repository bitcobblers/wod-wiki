import type { ReactNode } from 'react'
import { TourHeroHeading } from './TourHero'
import { TourTimerScreen } from './screens/TourTimerScreen'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { TourSessionResult } from './screens/TourSessionResult'
import type { TourSectionTimerWiring, TourSectionSessionWiring } from './TourSectionRunway'
import { TaglineHeader } from './TaglineHeader'
import { CaptionBody, TOUR_CAPTIONS } from './TourCaptions'
import { TOUR_ACCENTS } from './tourConstants'
import type { ScriptBlock } from '@/components/Editor/types'

export interface TourFlatStackProps {
  theme: string
  /** The hero's shared welcome document. */
  doc: string
  onDocChange: (next: string) => void
  onBlocksChange: (blocks: ScriptBlock[]) => void
  onRun: () => void
  onHeroRun?: () => void
  /** The run-section intro example document (home-example.md). */
  exampleDoc: string
  onExampleDocChange: (next: string) => void
  onExampleBlocksChange: (blocks: ScriptBlock[]) => void
  heroContent?: ReactNode
  /** Caption command buttons (Try it). */
  onCommand?: (captionId: string, key: string) => void
  /** Shared-script attribution + reset, shown on the hero preview. */
  sharedBy?: string
  onResetShared?: () => void
  /** The inline run pane — same wiring as the sticky runways (no fullscreen). */
  timer: TourSectionTimerWiring
  session?: TourSectionSessionWiring
  /** Rendered after Explore (the offerings block). */
  offeringsSlot?: ReactNode
}

/**
 * TourFlatStack — the reduced-motion home page: flat cards instead of the
 * sticky scrub runways. Same section order as the animated HomeTour: hero,
 * Run it as a Timer, Explore your analytics, then the offerings slot
 * (feeds + data ownership render around it in HomeTour).
 */
export function TourFlatStack(props: TourFlatStackProps) {
  const introCaption = TOUR_CAPTIONS.find((c) => c.id === 'timer-intro')
  const timerCaption = TOUR_CAPTIONS.find((c) => c.id === 'timer-wallclock')

  return (
    <div data-testid="tour-flat-stack" className="flex flex-col gap-6">
      <section id="tour-hero" data-testid="tour-hero" className="grid h-[calc(100dvh-65px)] grid-rows-[2fr_3fr] gap-4 px-6 py-4 lg:h-[calc(100dvh-104px)]">
        <div className="flex min-h-0 items-center justify-center overflow-y-auto"><TourHeroHeading /></div>
        <div className="relative min-h-0 overflow-hidden rounded-xl border border-border">
          {props.sharedBy && props.onResetShared && (
            <button type="button" onClick={props.onResetShared} data-testid="tour-hero-reset-shared" className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-accent">
              Reset
            </button>
          )}
          {props.heroContent ?? <TourEditorScreen doc={props.doc} theme={props.theme} onDocChange={props.onDocChange} onBlocksChange={props.onBlocksChange} onRun={props.onHeroRun ?? props.onRun} />}
        </div>
      </section>

      {/* Section 01: Run it as a Timer */}
      <section id="tour-section-run" data-testid="tour-section-run" className="flex flex-col gap-4">
        <TaglineHeader
          index="01"
          before="Run it as a "
          accentText="Timer"
          after=""
          accent={TOUR_ACCENTS.timer}
          blurb="The workout reads like plain text — press Run and the script becomes the clock. Step through rounds, cast to the big screen, then see what you logged."
        />
        {introCaption && (
          <article
            data-testid="tour-run-intro-card"
            className="mx-6 rounded-2xl border border-border bg-card p-6"
          >
            <CaptionBody cap={introCaption} />
          </article>
        )}
        {/* The intro example — home-example.md in its own editor. */}
        <div
          data-testid="tour-stack-example-editor"
          className="mx-6 h-[calc((100dvh-65px)*0.6)] overflow-hidden rounded-2xl border border-border shadow-sm lg:h-[calc((100dvh-104px)*0.6)]"
        >
          <TourEditorScreen
            doc={props.exampleDoc}
            onDocChange={props.onExampleDocChange}
            onBlocksChange={props.onExampleBlocksChange}
            onRun={props.onRun}
            theme={props.theme}
          />
        </div>
        {timerCaption && (
          <article
            data-testid="tour-timer-card"
            className="mx-6 rounded-2xl border border-border bg-card p-6"
          >
            <CaptionBody cap={timerCaption} onCommand={props.onCommand} />
          </article>
        )}
        {/* Inline run pane — the reduced-motion sibling of the sticky runways.
            Run reveals it right here (no scroll choreography, no fullscreen). */}
        <div
          id="tour-stack-timer"
          data-testid="tour-stack-timer"
          className="mx-6 h-[calc((100dvh-65px)*0.6)] overflow-hidden rounded-2xl border border-border lg:h-[calc((100dvh-104px)*0.6)]"
        >
          <TourTimerScreen
            key={props.timer.sessionKey}
            block={props.timer.block}
            autoStart={props.timer.autoStart}
            onClose={props.timer.onClose}
            onComplete={props.timer.onComplete}
            onRuntimeReady={props.timer.onRuntimeReady}
            onRunStarted={props.timer.onRunStarted}
            onStart={props.timer.onStart}
            onReset={props.timer.onReset}
            externalStop={props.timer.externalStop}
          />
        </div>
        {props.session?.result && (
          <div
            data-testid="tour-stack-result"
            className="mx-6 overflow-hidden rounded-2xl border border-border"
          >
            <TourSessionResult result={props.session.result} />
          </div>
        )}
      </section>

      {/* Offerings (feeds render just above, in HomeTour) — see HomeTour */}
      {props.offeringsSlot}
    </div>
  )
}
