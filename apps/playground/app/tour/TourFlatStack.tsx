import type { ReactNode } from 'react'
import { TourHeroHeading } from './TourHero'
import { TourLearnSection } from './TourLearnSection'
import { TourChapterPicker } from './TourChapterPicker'
import { HomeAnalyticsSection } from './HomeAnalyticsSection'
import { TourTimerScreen } from './screens/TourTimerScreen'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { TourSessionAnalytics, DEFAULT_TABLE_QUERY_KEY, DEFAULT_BOARD_SLUG } from './screens/TourSessionAnalytics'
import { TourSessionResult } from './screens/TourSessionResult'
import type { TourSectionTimerWiring, TourSectionSessionWiring } from './TourSectionRunway'
import { TaglineHeader } from './TaglineHeader'
import { TourJumpSection } from './TourJumpSection'
import { CaptionBody, TOUR_CAPTIONS } from './TourCaptions'
import { TOUR_ACCENTS } from './tourConstants'
import type { ScriptBlock } from '@/components/Editor/types'
import type { Chapter, Quest } from '../canvas/parseCanvasMarkdown'

export interface TourFlatStackProps {
  theme: string
  wodFiles?: Record<string, string>
  quests: Quest[]
  chapters: Chapter[]
  questLabels?: Record<string, string>
  onHomeQuestClick?: (questId: string) => void
  doc: string
  onDocChange: (next: string) => void
  onBlocksChange: (blocks: ScriptBlock[]) => void
  onRun: () => void
  onHeroRun?: () => void
  onChapterRun?: (chapterId: string, block: ScriptBlock | null, doc: string) => void
  heroContent?: ReactNode
  /** Choose-your-own-adventure workout choice from the editor-blank caption card. */
  onChoice?: (wod: string) => void
  /** Caption command buttons (Try it / query presets / board picks). */
  onCommand?: (captionId: string, key: string) => void
  /** Shared-script attribution + reset, shown on the hero preview. */
  sharedBy?: string
  onResetShared?: () => void
  /** The inline run pane — same wiring as the sticky runways (no fullscreen). */
  timer: TourSectionTimerWiring
  session?: TourSectionSessionWiring
  /** Rendered between Explore and Learn the Language (the offerings block). */
  offeringsSlot?: ReactNode
}

export function TourFlatStack(props: TourFlatStackProps) {
  const editorBlankCaption = TOUR_CAPTIONS.find((c) => c.id === 'editor-blank')
  const editorMetricsCaption = TOUR_CAPTIONS.find((c) => c.id === 'editor-metrics')
  const timerCaption = TOUR_CAPTIONS.find((c) => c.id === 'timer-wallclock')
  const metricsCaption = TOUR_CAPTIONS.find((c) => c.id === 'metrics-e')

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

      <TourJumpSection />

      {/* Section 01: Write it in Markdown — hosts the page's ONE editor */}
      <section id="tour-section-write" data-testid="tour-section-write" className="flex flex-col gap-4">
        <TaglineHeader
          index="01"
          before="Write it in "
          accentText="Markdown"
          after=""
          accent={TOUR_ACCENTS.editor}
          blurb="Freeform Markdown notes, fenced ```time blocks, property and tag suggestions. Everything starts as plain text you can edit."
        />
        <div
          data-testid="tour-stack-editor"
          className="mx-6 h-[calc((100dvh-65px)*0.6)] overflow-hidden rounded-2xl border border-border shadow-sm lg:h-[calc((100dvh-104px)*0.6)]"
        >
          <TourEditorScreen
            doc={props.doc}
            onDocChange={props.onDocChange}
            onBlocksChange={props.onBlocksChange}
            onRun={props.onRun}
            theme={props.theme}
          />
        </div>
        {editorBlankCaption && (
          <article
            data-testid="tour-editor-card"
            className="mx-6 rounded-2xl border border-border bg-card p-6"
          >
            <CaptionBody cap={editorBlankCaption} onChoice={props.onChoice} onCommand={props.onCommand} />
          </article>
        )}
        {editorMetricsCaption && (
          <article
            data-testid="tour-editor-metrics-card"
            className="mx-6 rounded-2xl border border-border bg-card p-6"
          >
            <CaptionBody cap={editorMetricsCaption} />
          </article>
        )}
      </section>

      {/* Section 02: Run it as a Timer */}
      <section id="tour-section-run" data-testid="tour-section-run" className="flex flex-col gap-4">
        <TaglineHeader
          index="02"
          before="Run it as a "
          accentText="Timer"
          after=""
          accent={TOUR_ACCENTS.timer}
          blurb="The script becomes the clock. Step through rounds, cast to the big screen, and pace the room together."
        />
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
      </section>

      {/* Section 03: Own the Metrics */}
      <section id="tour-section-own" data-testid="tour-section-own" className="flex flex-col gap-4">
        <TaglineHeader
          index="03"
          before="Own the "
          accentText="Metrics"
          after=""
          accent={TOUR_ACCENTS.analytics}
          blurb="Every movement produces facts. Metrics bind to efforts, accumulating structured workout data on every pass."
        />
        {metricsCaption && (
          <article
            data-testid="tour-metrics-card"
            className="mx-6 rounded-2xl border border-border bg-card p-6"
          >
            <CaptionBody cap={metricsCaption} />
          </article>
        )}
        <div className="mx-6 h-[calc((100dvh-65px)*0.6)] overflow-hidden rounded-2xl border border-border lg:h-[calc((100dvh-104px)*0.6)]">
          {props.session?.result ? <TourSessionResult result={props.session.result} /> : (
            <TourSessionAnalytics
              activeStageId="wql-table"
              noteId={props.session?.noteId ?? null}
              queryKey={props.session?.queryKey ?? DEFAULT_TABLE_QUERY_KEY}
              boardSlug={props.session?.boardSlug ?? DEFAULT_BOARD_SLUG}
            />
          )}
        </div>
      </section>

      {/* Section 04: Explore your analytics */}
      <section id="tour-section-explore" data-testid="tour-section-explore" className="flex flex-col gap-4">
        <TaglineHeader
          index="04"
          before=""
          accentText="Explore"
          after=" your analytics"
          accent={TOUR_ACCENTS.rounds}
          blurb="Query what you just did in WQL. Roll up totals, graph volume over time, and build custom dashboards."
        />
        <HomeAnalyticsSection />
      </section>

      {/* Offerings (keep-scrolling teaser included) — see HomeTour */}
      {props.offeringsSlot}

      {/* Syntax chapter picker */}
      <TourChapterPicker wodFiles={props.wodFiles ?? {}} theme={props.theme} chapters={props.chapters} allQuests={props.quests} onRun={props.onChapterRun} />

      {/* High-level progress */}
      <TourLearnSection
        quests={props.quests}
        chapters={props.chapters}
        questLabels={props.questLabels}
        onHomeQuestClick={props.onHomeQuestClick}
      />
    </div>
  )
}
