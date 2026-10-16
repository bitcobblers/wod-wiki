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
  /** Optional node under the foot line (e.g. chapter quest progress). */
  extra?: ReactNode
}

export const TOUR_CAPTIONS: TourCaption[] = [
  {
    id: 'timer-intro',
    num: '02a',
    title: (
      <>
        Click Run to Start the Timer.{' '}
        <em className="italic text-foreground/80">The workout reads like plain text.</em>
      </>
    ),
    body: 'This workout is different but easy to read: 225lb and 24kg are weight, 400m is distance, 21-15-9 is repetitions and rounds, and easy / hard mark effort. Press the Run button to start the timer.',
    foot: 'weight & distance · repetitions & rounds · effort',
    accent: TOUR_ACCENTS.editor,
    actions: [
      {
        label: 'Read the syntax guide',
        href: '/guide/start',
        event: HOME_EVENTS.lessonStarted,
      },
    ],
  },
  {
    id: 'timer-wallclock',
    num: '02b',
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
    num: '02c',
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
    num: '02d',
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
    id: 'timer-output',
    num: '02e',
    title: (
      <>
        Stop and See What You Logged.{' '}
        <em className="italic text-foreground/80">The run becomes a note.</em>
      </>
    ),
    body: 'Stopping saves the run as a playground note — every split, rep, and effort you completed shows up right here, and stays queryable in your journal.',
    foot: 'saved playground · splits · recorded efforts',
    accent: TOUR_ACCENTS.timer,
  },
  {
    id: 'timer-dashboard',
    num: '02f',
    title: (
      <>
        Your Data Becomes a Dashboard.{' '}
        <em className="italic text-foreground/80">Every widget one query away.</em>
      </>
    ),
    body: 'The same recorded facts feed any WQL dashboard — totals, trends, and boards like this one update as you log more work.',
    foot: 'seeded boards · WQL · query anything',
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
  /** Called when a caption command button is pressed (stage-pane driver). */
  onCommand?: (captionId: string, key: string) => void
  /** Caption subset for a runway section; defaults to the full walkthrough list. */
  captions?: TourCaption[]
}

/** Desktop cross-fading caption column — sized by its parent's 40% zone. */
export function TourCaptions({ activeIndex, onCommand, captions = TOUR_CAPTIONS }: TourCaptionsProps) {
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
          <CaptionBody cap={cap} onCommand={onCommand} />
        </div>
      ))}
    </div>
  )
}

export function CaptionBody({ cap, onCommand }: { cap: TourCaption; onCommand?: (captionId: string, key: string) => void }) {
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
