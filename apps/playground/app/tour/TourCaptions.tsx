/**
 * TourCaptions.tsx — runway caption strip: caption types, the desktop
 * cross-fading column, and the shared caption body renderer. Sections
 * pass their own captions (the home walkthrough's stage captions retired
 * with the home runway).
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { telemetry, type HomeEventName } from '@/services/telemetry'

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

export interface TourCaptionsProps {
  /** Index into the captions list (matches stage index within the section). */
  activeIndex: number
  /** Called when a caption command button is pressed (stage-pane driver). */
  onCommand?: (captionId: string, key: string) => void
  /** Caption subset for a runway section. */
  captions: TourCaption[]
}

/** Desktop cross-fading caption column — sized by its parent's 40% zone. */
export function TourCaptions({ activeIndex, onCommand, captions }: TourCaptionsProps) {
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
        <span className="mr-2 align-[0.2em] font-mono text-[0.5em] font-semibold tracking-[0.08em] text-muted-foreground">
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
        <div className="mt-4 xl:mt-6 border-t border-border pt-3 xl:pt-4 font-mono text-[10px] xl:text-[11px] tracking-[0.06em] text-muted-foreground">
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
