/**
 * TourJumpSection.tsx — the "Know where you're going?" direct-exit section.
 *
 * A ~half-viewport sliding section right under the hero: three flat boxes
 * that jump straight into the app's sub views (Library, Playgrounds,
 * and creating a new journal note) for visitors who don't want the
 * full walkthrough.
 */
import { useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Library, FlaskConical, CalendarPlus, type LucideIcon } from 'lucide-react'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import { journalNotes } from '../services/journalNotes'
import { noteByIdPath } from '../lib/routes'
import { getTodayDateKey } from '../services/dateUtils'

const BOX_BASE =
  'group flex flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

function BoxFace(props: {
  icon: LucideIcon
  title: string
  description: string
  action: string
}) {
  const Icon = props.icon
  return (
    <>
      <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="mt-4 text-base font-semibold">{props.title}</span>
      <span className="mt-1 text-sm leading-6 text-muted-foreground">{props.description}</span>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium">
        {props.action}
        <ArrowRight
          className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden
        />
      </span>
    </>
  )
}

export function TourJumpSection() {
  const navigate = useNavigate()

  const handleLibrary = useCallback(() => {
    telemetry.record(HOME_EVENTS.libraryOpened)
  }, [])


  const handleNewNote = useCallback(async () => {
    const today = getTodayDateKey()
    const note = await journalNotes.create({
      journalDate: today,
      title: today,
      rawContent: '',
    })
    telemetry.record(HOME_EVENTS.noteCreated)
    navigate(noteByIdPath(note.id))
  }, [navigate])

  return (
    <section
      data-testid="tour-jump-section"
      className="flex flex-col items-center border-b border-border bg-muted/30 px-6 py-8 xl:py-14 2xl:py-16"
    >
      <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground xl:text-xs">
        Know where you&apos;re going?
      </h2>

      <div className="mx-auto mt-4 grid w-full max-w-3xl grid-cols-1 gap-4 xl:mt-6 sm:grid-cols-3">
        <Link to="/catalogs" onClick={handleLibrary} data-testid="jump-library" className={BOX_BASE}>
          <BoxFace
            icon={Library}
            title="Library"
            description="Curated workouts and sessions, organized by tag."
            action="Open the library"
          />
        </Link>

        <Link to="/playgrounds" data-testid="jump-playgrounds" className={BOX_BASE}>
          <BoxFace
            icon={FlaskConical}
            title="Playground"
            description="Find examples run from the homepage and explore scratchpads."
            action="Open playgrounds"
          />
        </Link>

        <button type="button" onClick={handleNewNote} data-testid="jump-new-note" className={BOX_BASE}>
          <BoxFace
            icon={CalendarPlus}
            title="Start your own journal"
            description="Create today's note and log your first workout."
            action="Create today's note"
          />
        </button>
      </div>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 xl:mt-6 xl:text-[11px]">
        — or keep scrolling ↓
      </p>
    </section>
  )
}
