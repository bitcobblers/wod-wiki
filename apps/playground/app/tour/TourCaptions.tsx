/**
 * TourCaptions.tsx — per-stage captions for the walkthrough.
 *
 * Desktop: fills the runway's measured description zone (40% of the
 * context — width when split, height when stacked); captions cross-fade
 * with the active stage and scroll internally when one outgrows the zone.
 * Mobile: the parent translates the strip vertically (scrubbed
 * during the last 30% of each stage) or the cards render statically. The
 * same CAPTIONS data now carries the stage drop-off actions for the home
 * funnel.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Combobox,
  ComboboxDescription,
  ComboboxLabel,
  ComboboxOption,
} from '@/components/atoms/primitives/combobox'
import { TOUR_ACCENTS } from './tourConstants'
import { telemetry, HOME_EVENTS, type HomeEventName } from '@/services/telemetry'

export interface TourCaptionAction {
  label: string
  href: string
  event: HomeEventName
  /** Telemetry payload (e.g. { chapter } attribution). */
  data?: Record<string, unknown>
  /** Stable test hook (e.g. chapter-picker-guide-<chapterId>). */
  testId?: string
}

/** A caption button that drives the live stage pane (query/board/Try-it). */
export interface TourCaptionCommand {
  key: string
  label: string
}

/** Choose-your-own-adventure workout option rendered in the caption combo box. */
export interface TourCaptionChoice {
  label: string
  detail: string
  wod: string
}

/** Workout presets for the editor-blank slide — reps + distance + load, no forced timers. */
export const WORKOUT_PRESETS: TourCaptionChoice[] = [
  {
    label: '21-15-9 Rep Scaling',
    detail: 'Air Squats · Pushups',
    wod: '```time\n21-15-9\n  Air Squats\n  Pushups\n  // Rep scheme scaling\n  // Step through reps\n```',
  },
  {
    label: 'Required Rest',
    detail: '3 Rounds · 10 Burpees · *:30 Rest',
    wod: '```time\n(3 Rounds)\n  10 Burpees\n  *:30 Rest\n  // Forced rest timer\n  // Locks time split\n```',
  },
  {
    label: 'Timed Distance',
    detail: '5:00 Run 400m · *:45 Rest',
    wod: '```time\n5:00 Run 400m\n*:45 Rest\n// Fixed time window\n// Distance & rest timer\n// Track meter pace\n```',
  },
  {
    label: 'Load & Resistance',
    detail: '5 Sets · 5 Back Squat 185lb · *1:00 Rest',
    wod: '```time\n(5 Sets)\n  5 Back Squat 185lb\n  *1:00 Rest\n  // Barbell resistance\n  // Rest between sets\n```',
  },
]

/**
 * Adventure script scaffolding (#884): identical header/footer for every
 * preset and for welcome-1.md, so the fenced block always occupies document
 * lines 5–11 and the card-2 highlight is fixed. Every preset fence spans 7
 * lines (open + 5 content + close) — keep them normalized when editing.
 */
export const ADVENTURE_FENCE_LINES = { open: 5, close: 11 } as const

export function buildAdventureScript(wod: string): string {
  return `# 👋 Edit Me\n\nChange the reps, distance, or load below — this is live.\n\n${wod}\n\n> Press **Run** ↑ to start the Clock.\n`
}

export interface TourCaption {
  /** Stage id for walkthrough captions; chapter captions use chapter ids. */
  id: string
  num: string
  title: ReactNode
  body: string
  /** Readable explanatory list under the body (chapter captions). */
  bullets?: string[]
  foot: string
  accent: string
  actions?: TourCaptionAction[]
  /** Buttons that drive the stage pane via the host's onCommand handler. */
  commands?: TourCaptionCommand[]
  /** Workout choices rendered as a combo box; picking one resets the tour session. */
  choices?: TourCaptionChoice[]
  /** Prompt shown above the choices combo box. */
  choicePrompt?: string
  /** Optional node under the foot line (e.g. chapter quest progress). */
  extra?: ReactNode
}

export const TOUR_CAPTIONS: TourCaption[] = [
  {
    id: 'editor-blank',
    num: '01a',
    title: (
      <>
        Start with a Blank Page.{' '}
        <em className="italic text-foreground/80">Type-ahead & freeform Markdown.</em>
      </>
    ),
    body: 'Write freeform Markdown and fenced workout blocks. Typeahead suggests fence names, frontmatter properties, and tags. Workout lines are parsed live; movement names are not autocompleted.',
    foot: 'Markdown · property and tag suggestions · live workout parsing',
    accent: TOUR_ACCENTS.editor,
    choices: WORKOUT_PRESETS,
    choicePrompt: 'Take one for a spin ↓',
    actions: [
      {
        label: 'Start Lesson 1',
        href: '/guide/start#first-workout',
        event: HOME_EVENTS.lessonStarted,
      },
    ],
  },
  {
    id: 'editor-metrics',
    num: '01a',
    title: (
      <>
        Every Line Collects Metrics.{' '}
        <em className="italic text-foreground/80">Fenced ```time syntax.</em>
      </>
    ),
    body: 'Open a fenced block with triple backticks — ```time. Each line defines the metrics collected: rep scaling (21-15-9), distance (400m Run), load resistance (24kg, 225lb), and rest (*:30 Rest).',
    foot: '```time syntax · 21-15-9 rep scaling · 400m distance · 24kg/225lb load',
    accent: TOUR_ACCENTS.editor,
    actions: [
      {
        label: 'Start Lesson 1',
        href: '/guide/metrics#capture',
        event: HOME_EVENTS.lessonStarted,
      },
    ],
  },
  {
    id: 'editor-run',
    num: '01b',
    title: (
      <>
        Press Run to Execute.{' '}
        <em className="italic text-foreground/80">Launch the step-through clock.</em>
      </>
    ),
    body: 'Click Run in the editor top bar to execute the block — the step-through Clock launches and every line starts generating collected metrics.',
    foot: 'Run button · step-through Clock · untimed rounds',
    accent: TOUR_ACCENTS.editor,
    commands: [{ key: 'try', label: 'Try it now ↓' }],
    actions: [
      {
        label: 'Read the behaviors explainer',
        href: '/guide/clock#run-next',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
  {
    id: 'timer-wallclock',
    num: '02a',
    title: (
      <>
        What Happens When It Runs.{' '}
        <em className="italic text-foreground/80">The script becomes the clock.</em>
      </>
    ),
    body: 'The Clock runs whatever you wrote — stepping through each line of the edited workout at your own pace, with no forced time limits.',
    foot: 'Clock · step-through execution · live metric capture',
    accent: TOUR_ACCENTS.timer,
    commands: [{ key: 'try', label: 'Run this example' }],
    actions: [
      {
        label: 'Read the behaviors explainer',
        href: '/guide/clock#run-next',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
  {
    id: 'timer-next',
    num: '02b',
    title: (
      <>
        Next Advances the Workout.{' '}
        <em className="italic text-foreground/80">Every click locks a time.</em>
      </>
    ),
    body: 'Click Next to advance to the next movement or round at your own pace — each click locks the elapsed time into the collected metrics as a split. Click all the way through and the run completes, carrying your data onward.',
    foot: 'Next button · round advance · locked time splits',
    accent: TOUR_ACCENTS.timer,
    actions: [
      {
        label: 'Read the behaviors explainer',
        href: '/guide/clock#run-next',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
  {
    id: 'timer-cast',
    num: '02c',
    title: (
      <>
        Cast to the Big Screen.{' '}
        <em className="italic text-foreground/80">The room paces together.</em>
      </>
    ),
    body: 'Tap the cast button in the timer header and the running clock mirrors to any Chromecast — the receiver shows the movement stack and the live clock, so the whole room follows the same rep without crowding your screen.',
    foot: 'Chromecast button · receiver UI · shared pacing',
    accent: TOUR_ACCENTS.timer,
    actions: [
      {
        label: 'Read the behaviors explainer',
        href: '/guide/clock#casting',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
  {
    id: 'metrics-e',
    num: '03a',
    title: (
      <>
        Every line tracks an effort.{' '}
        <em className="italic text-foreground/80">The registry speaks movement.</em>
      </>
    ),
    body: 'Back Squat, Pullups, a 500m Row — each tracked thing is an effort, drawn from the movement registry with its tags and discipline. Efforts are the nouns your training is written in.',
    foot: 'effort · movement registry · discipline tags',
    accent: TOUR_ACCENTS.timer,
    commands: [
      { key: 'q-reps', label: 'Reps by effort' },
      { key: 'q-tonnage', label: 'Tonnage by week' },
    ],
    actions: [
      {
        label: 'Browse the registry',
        href: '/efforts',
        event: HOME_EVENTS.effortsOpened,
      },
    ],
  },
  {
    id: 'metrics-d',
    num: '03b',
    title: (
      <>
        Every effort collects measures.{' '}
        <em className="italic text-foreground/80">Reps, load, distance, rest.</em>
      </>
    ),
    body: 'The same lines carry micro data points: 5 reps at 225lb, a 400m distance, timed rest. Each measure is typed by the runtime — no forms, no manual entry.',
    foot: 'reps · load · distance · time · custom metrics',
    accent: TOUR_ACCENTS.editor,
  },
  {
    id: 'metrics-c',
    num: '03c',
    title: (
      <>
        Efforts × measures compound into facts.{' '}
        <em className="italic text-foreground/80">Analytics becomes arithmetic.</em>
      </>
    ),
    body: 'Effort × load rolls up to tonnage; effort × distance to pace; every Next click locks a split. Because everything is structured from the start, WQL queries and dashboards are just rollups of what you already logged.',
    foot: 'tonnage · pace · splits · queryable facts',
    accent: TOUR_ACCENTS.analytics,
  },
  {
    id: 'wql-idea',
    num: '04a',
    title: (
      <>
        Query what you just did.{' '}
        <em className="italic text-foreground/80">Every result is one query away.</em>
      </>
    ),
    body: 'WQL turns your journal into queryable facts. Pick an aggregator and a metric, filter by tag, group by a dimension, roll up over time. The labelled example dataset powers these dashboards without adding workouts to your journal.',
    foot: 'aggregator · metric · filter · dimension · rollup',
    accent: TOUR_ACCENTS.analytics,
    actions: [
      {
        label: 'Open the WQL guide',
        href: '/guide/wql',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
  {
    id: 'wql-table',
    num: '04b',
    title: (
      <>
        Read it as a list.{' '}
        <em className="italic text-foreground/80">One query, one ranked table.</em>
      </>
    ),
    body: 'Sum total reps grouped by effort to get a ranked table. Start with Example data, or select This run to query only the workout you recorded. Switch the query and the table updates.',
    foot: 'note-scoped WQL · parsed-query chips',
    accent: TOUR_ACCENTS.analytics,
    commands: [
      { key: 'q-reps', label: 'Reps by effort' },
      { key: 'q-tonnage', label: 'Tonnage by week' },
      { key: 'q-tis', label: 'Avg intensity' },
    ],
  },
  {
    id: 'wql-graphs',
    num: '04c',
    title: (
      <>
        See it as trends.{' '}
        <em className="italic text-foreground/80">A graph is a rollup away.</em>
      </>
    ),
    body: 'Roll the same facts up by week and they become a timeseries — is tonnage rising, is training polarized? A graph is not a feature you enable; it is a rollup away.',
    foot: 'by {week} · timeseries · stacked intensity',
    accent: TOUR_ACCENTS.analytics,
    actions: [
      {
        label: 'Open the WQL guide',
        href: '/guide/wql',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
  {
    id: 'wql-dashboard',
    num: '04d',
    title: (
      <>
        Compose a dashboard.{' '}
        <em className="italic text-foreground/80">N queries on one screen.</em>
      </>
    ),
    body: 'A dashboard is N queries on one screen. These are the app’s seeded boards, using the same DashboardView, range selector, and widget Inspect as /dashboard. Example data stays separate from your journal; each metric keeps its own unit.',
    foot: 'seeded boards · range · inspect',
    accent: TOUR_ACCENTS.analytics,
    commands: [
      { key: 'board-training-block-review', label: 'Training Block Review' },
      { key: 'board-road-to-560-total', label: 'Road to 560 Total' },
      { key: 'board-polarized-base-marathon', label: 'Polarized Base Marathon' },
    ],
  },
  {
    id: 'wql-live',
    num: '04e',
    title: (
      <>
        It’s your data.{' '}
        <em className="italic text-foreground/80">Query anything, your way.</em>
      </>
    ),
    body: 'Every widget here runs the same WQL against the example dataset — log work of your own and the identical queries answer with your data. Open the Dashboards tab to query anything, your way.',
    foot: 'WQL queries · example dataset · your data',
    accent: TOUR_ACCENTS.analytics,
    actions: [
      {
        label: 'Browse the seeded boards',
        href: '/guide/dashboards#seeded-boards',
        event: HOME_EVENTS.behaviorsOpened,
      },
    ],
  },
]

export interface TourCaptionsProps {
  /** Index into the captions list (matches stage index within the section). */
  activeIndex: number
  /** Called when a workout choice is picked from the combo box (choose-your-own-adventure). */
  onChoice?: (wod: string) => void
  /** Called when a caption command button is pressed (stage-pane driver). */
  onCommand?: (captionId: string, key: string) => void
  /** Caption subset for a runway section; defaults to the full walkthrough list. */
  captions?: TourCaption[]
}

/** Desktop cross-fading caption column — sized by its parent's 40% zone. */
export function TourCaptions({ activeIndex, onChoice, onCommand, captions = TOUR_CAPTIONS }: TourCaptionsProps) {
  return (
    <div className="relative h-full w-full" data-testid="tour-captions">
      {captions.map((cap, i) => (
        <div
          key={cap.id}
          data-scroll-pane
          className="absolute inset-0 overflow-y-auto transition-opacity duration-300"
          style={{
            opacity: i === activeIndex ? 1 : 0,
            // Inactive captions are invisible but still stacked above the
            // active one — without this their links/buttons swallow clicks
            // (e.g. the analytics caption's links hijacking combo box taps).
            pointerEvents: i === activeIndex ? 'auto' : 'none',
          }}
          aria-hidden={i !== activeIndex}
          inert={i !== activeIndex}
        >
          <CaptionBody cap={cap} onChoice={onChoice} onCommand={onCommand} />
        </div>
      ))}
    </div>
  )
}

export function CaptionBody({ cap, onChoice, onCommand }: { cap: TourCaption; onChoice?: (wod: string) => void; onCommand?: (captionId: string, key: string) => void }) {
  return (
    <>
      {/* Section number kept subtly inline — no eyebrow prelabel. */}
      <h3 className="mb-3.5 xl:mb-5 text-[clamp(22px,2vw,32px)] font-extrabold leading-[1.12] tracking-[-0.03em]">
        <span className="mr-2 align-[0.2em] font-mono text-[0.5em] font-semibold tracking-[0.08em] text-muted-foreground/50">
          {cap.num}
        </span>
        {cap.title}
      </h3>
      <p className="text-[14.5px] sm:text-base xl:text-[17px] leading-[1.7] xl:leading-[1.75] text-muted-foreground">{cap.body}</p>
      {cap.bullets && cap.bullets.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm xl:text-[15px] leading-relaxed text-foreground/85">
          {cap.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-primary font-bold">›</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {cap.foot && (
        <div className="mt-4 xl:mt-6 border-t border-border pt-3 xl:pt-4 font-mono text-[10px] xl:text-[11px] tracking-[0.06em] text-muted-foreground/60">
          {cap.foot}
        </div>
      )}
      {cap.extra && <div className="mt-3">{cap.extra}</div>}
      {cap.choices && cap.choices.length > 0 && (
        <div className="mt-4 xl:mt-6" data-testid="tour-workout-choices">
          {cap.choicePrompt && (
            <div
              className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: cap.accent }}
              data-testid="tour-workout-choices-prompt"
            >
              {cap.choicePrompt}
            </div>
          )}
          <Combobox<TourCaptionChoice | null>
            options={cap.choices}
            value={null}
            by={(a, b) => a?.label === b?.label}
            immediate
            virtual={false}
            onChange={(choice) => {
              if (choice) onChoice?.(choice.wod)
            }}
            displayValue={(choice) => choice?.label}
            filter={(choice, query) => {
              const q = query.toLowerCase()
              return (
                (choice?.label.toLowerCase().includes(q) ?? false) ||
                (choice?.detail.toLowerCase().includes(q) ?? false)
              )
            }}
            placeholder="Load a workout into the demo…"
            aria-label="Load a workout into the demo"
          >
            {(choice) => (
              <ComboboxOption value={choice}>
                <ComboboxLabel>{choice.label}</ComboboxLabel>
                <ComboboxDescription>{choice.detail}</ComboboxDescription>
              </ComboboxOption>
            )}
          </Combobox>
        </div>
      )}
      {cap.commands && cap.commands.length > 0 && onCommand && (
        <div className="mt-4 xl:mt-6 flex flex-wrap items-center gap-2" data-testid={`tour-caption-commands-${cap.id}`}>
          {cap.commands.map((command) => (
            <button
              key={command.key}
              type="button"
              onClick={() => onCommand(cap.id, command.key)}
              className="inline-flex items-center rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid={`tour-caption-command-${cap.id}-${command.key}`}
            >
              {command.label}
            </button>
          ))}
        </div>
      )}
      {cap.actions && cap.actions.length > 0 && (
        <div className="mt-4 xl:mt-6 flex flex-wrap items-center gap-3">
          {cap.actions.map((action, i) => {
            const isPrimary = i === 0
            return (
              <Link
                key={action.label}
                to={action.href}
                onClick={() => telemetry.record(action.event, action.data)}
                data-testid={action.testId}
                className={
                  isPrimary
                    ? 'inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
                    : 'text-sm text-primary underline-offset-2 hover:underline'
                }
              >
                {action.label}
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
