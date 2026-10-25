import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Cloud, HardDrive, Server } from 'lucide-react'
import { resetUserData } from '../../services/resetUserData'
import { ROUTE_PATTERNS, noteByIdPath } from '../../lib/routes'
import { getTodayDateKey } from '../../services/dateUtils'
import { journalNotes } from '../../services/journalNotes'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import { Button } from '@/components/atoms/primitives/button'
import { readDataSettings, storageBackend } from '@/services/storage'
import { TaglineHeader } from '../../tour/TaglineHeader'
import { TOUR_ACCENTS } from '../../tour/tourConstants'

// ponytail: form is a Google Form — swap for an in-app interest endpoint
// when the API grows one.
const REPO_URL = 'https://github.com/bitcobblers/wod-wiki'
const FORM_URL = 'https://forms.gle/6YHpxwAJh6PAsyAQ6'
const TURSO_SIGNUP_URL = 'https://app.turso.tech/signup'
/** Turso brand mark (simple-icons, CC0). */
const TURSO_ICON_PATH =
  'm23.31.803-.563-.42-1.11 1.189-.891-1.286-.512.235.704 1.798-.326.35L18.082 0l-.574.284 2.25 4.836-2.108.741h-.05l-1.143-1.359-1.144 1.36H8.687l-1.144-1.36-1.146 1.363H6.36l-2.12-.745L6.491.284 5.919 0l-2.53 2.668-.327-.349.705-1.798-.512-.236-.89 1.287L1.253.382.69.804 2.42 3.69l-.89.939.311 2.375 2.061.787L3.9 8.817H1.947v.444l.755 1.078 1.197.433v6.971l3.057 4.55L7.657 24l1.101-1.606L9.9 24l.999-1.606L12 24l1.102-1.606L14.1 24l1.141-1.606L16.343 24l.701-1.706 3.058-4.55v-6.972l1.196-.433.756-1.078v-.444h-1.952l.003-1.03 2.054-.784.311-2.375-.89-.939zm-8.93 18.718H8.033l.793-1.615.794 1.615.793-1.083.793 1.083.794-1.083.793 1.083.794-1.083.793 1.083.793-1.615.794 1.615zm3.886-7.39-3.3 1.084-.143 3.061-2.827.627-2.826-.627-.142-3.06-3.3-1.085v-1.635l4.266 1.21-.052 4.126h4.109l-.052-4.127 4.266-1.209z'

/** Hosted quiz: the survey's feature question, inline. The ids are
 *  the `feature` payload sent to analytics — stable, never rename. */
const INDIVIDUAL_FEATURES = [
  { id: 'managed-hosting', label: 'Managed hosting — we run the database.' },
  { id: 'public-profile', label: 'Profile page with a public feed.' },
  { id: 'device-sync', label: 'Sync across your apps and devices.' },
]
const TEAM_FEATURES = [
  { id: 'coach-views', label: 'Member accounts with coach views.' },
  { id: 'coaches-portal', label: 'Programming dashboards and leaderboards.' },
  { id: 'athlete-portal', label: 'Private journals that roll up to their coach.' },
  { id: 'gym-hosting', label: 'Gym website, competition timers, whiteboard displays.' },
  { id: 'branding', label: "Your gym's brand on pages and feeds." },
]

const quietLink = 'underline-offset-4 transition-colors hover:text-foreground hover:underline'
function CardLink(props: { to?: string; href?: string; onClick?: () => void; children: React.ReactNode }) {
  const className = 'inline-flex w-fit items-center gap-1.5 font-medium text-foreground underline-offset-4 transition-colors hover:underline'
  const inner = (
    <>
      {props.children}
      <ArrowRight className="size-3.5 text-muted-foreground/50" aria-hidden />
    </>
  )
  if (props.href !== undefined) {
    return (
      <a href={props.href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    )
  }
  if (props.onClick !== undefined) {
    return (
      <button type="button" onClick={props.onClick} className={`text-left ${className}`}>
        {inner}
      </button>
    )
  }
  return (
    <Link to={props.to!} className={className}>
      {inner}
    </Link>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
      <span aria-hidden className="mt-[11px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
      <span>{children}</span>
    </li>
  )
}

function ActiveBadge() {
  return (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-600">
      Active
    </span>
  )
}

/** One quiz row: the feature text plus its Interested latch. Clicking records
 *  `home:hosted_interest_clicked` (payload: feature id) and unlocks the survey. */
function FeatureRow(props: {
  feature: { id: string; label: string }
  interested: boolean
  onInterested: (id: string) => void
}) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex gap-2.5 text-[13px] leading-5 text-muted-foreground">
        <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
        <span>{props.feature.label}</span>
      </span>
      <button
        type="button"
        data-testid={`hosted-interest-${props.feature.id}`}
        onClick={() => props.onInterested(props.feature.id)}
        disabled={props.interested}
        aria-pressed={props.interested}
        className={`ml-[13px] w-fit shrink-0 rounded-full border px-2 py-px text-[11px] font-medium transition-colors ${
          props.interested
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
            : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
        }`}
      >
        {props.interested ? '✓ Interested' : 'Interested'}
      </button>
    </li>
  )
}

/** The quiz's answer slot — a full-width strip under the three cards, mounted
 *  only once a feature is marked interested. The CTA opens the survey in a
 *  new tab. */
function SurveyFooter() {
  return (
    <div
      role="status"
      data-testid="hosted-survey-footer"
      className="mx-auto mt-5 max-w-5xl animate-in fade-in slide-in-from-bottom-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 duration-500"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-foreground">Thanks for showing interest — please fill out the survey and give us feedback.</p>
            <p className="text-xs text-muted-foreground">Opens the interest survey in a new tab.</p>
          </div>
        </div>
        <Button
          type="button"
          data-testid="hosted-survey-button"
          onClick={() => {
            telemetry.record(HOME_EVENTS.hostedSurveyOpened)
            window.open(FORM_URL, '_blank', 'noopener,noreferrer')
          }}
        >
          Fill out interest survey
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function OfferingCard(props: {
  icon: typeof HardDrive
  title: string
  text: string
  badge?: React.ReactNode
  /** Answer chip above the title — who holds the data on this path. */
  eyebrow?: string
  /** Tinted variant marking the hosted (we-run-it) card. */
  us?: boolean
  className?: string
  children: React.ReactNode
}) {
  const Icon = props.icon
  return (
    <article
      className={`flex flex-col rounded-xl border border-border p-5 ${
        props.us ? 'bg-muted/40' : 'bg-background'
      } ${props.className ?? ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
          <Icon className="size-5" aria-hidden />
        </span>
        {props.badge}
      </div>
      {props.eyebrow && (
        <p className={`mt-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${props.us ? 'text-emerald-600' : 'text-muted-foreground'}`}>
          {props.eyebrow}
        </p>
      )}
      <h3 className={`${props.eyebrow ? 'mt-1' : 'mt-4'} text-base font-semibold text-foreground`}>{props.title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{props.text}</p>
      <div className="mt-4 flex flex-1 flex-col gap-2 text-sm">{props.children}</div>
    </article>
  )
}

function FeatureGroup({ label, features, interested, onInterested }: {
  label: string
  features: Array<{ id: string; label: string }>
  interested: ReadonlySet<string>
  onInterested: (id: string) => void
}) {
  return (
    <>
      <p className="mt-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:mt-0">{label}</p>
      <ul className="space-y-2">
        {features.map((feature) => (
          <FeatureRow key={feature.id} feature={feature} interested={interested.has(feature.id)} onInterested={onInterested} />
        ))}
      </ul>
    </>
  )
}

export function OfferingTiers() {
  const [clearing, setClearing] = useState(false)
  const navigate = useNavigate()
  // Hosted quiz state — one or more interested features reveal the survey
  // footer. ponytail: per-mount only; persist to localStorage if repeat
  // visitors complain about re-tapping.
  const [interested, setInterested] = useState<ReadonlySet<string>>(new Set())
  const markInterested = (id: string) => {
    setInterested((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    telemetry.record(HOME_EVENTS.hostedInterestClicked, { feature: id })
  }

  // Sync reads — localStorage-backed, read once per mount (settings switches
  // reload the page).
  const [dataSettings] = useState(readDataSettings)
  const isApiBuild = storageBackend === 'api'
  const activeMode: 'browser' | 'turso' | 'turso-invalid' | 'api' = isApiBuild
    ? 'api'
    : dataSettings.state === 'turso'
      ? 'turso'
      : dataSettings.state === 'invalid'
        ? 'turso-invalid'
        : 'browser'

  const clearData = async () => {
    if (!window.confirm('Wipe every note, result, and setting stored in this browser? This cannot be undone.')) return
    setClearing(true)
    await resetUserData()
    window.location.reload()
  }

  const createJournal = async () => {
    const today = getTodayDateKey()
    const note = await journalNotes.create({ journalDate: today, title: today, rawContent: '' })
    telemetry.record(HOME_EVENTS.noteCreated)
    navigate(noteByIdPath(note.id))
  }

  const playgroundBadge =
    activeMode === 'turso-invalid' ? (
      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-600">
        Invalid config
      </span>
    ) : activeMode === 'api' ? undefined : (
      <ActiveBadge />
    )

  return (
    <section id="tour-section-offerings" data-testid="tour-section-offerings" aria-label="You own your data">
      <TaglineHeader
        index="04"
        before="Who owns the data? "
        accentText="You!!!"
        after=""
        accent={TOUR_ACCENTS.library}
        blurb="Run it in your browser, back it up to your own database, or host it on your own server — and if you'd rather hand the caretaking to us, mark the hosted features you want below and the interest survey unlocks."
      />

      <div className="mx-auto w-full max-w-[1500px] 2xl:max-w-[1720px] px-6 pb-16 pt-10 lg:px-12 xl:px-16">
        <p className="mx-auto mb-5 flex max-w-5xl flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground" role="status">
          <span>{activeMode === 'api' ? 'Current mode: API server' : activeMode === 'turso' ? 'Current mode: local browser with Turso backup and sync' : activeMode === 'turso-invalid' ? 'Current mode: local browser. Repair the Turso connection to resume sync.' : 'Current mode: local browser only'}</span>
          <Link to={ROUTE_PATTERNS.settingsStorage} className={quietLink}>Configure data storage</Link>
        </p>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
          <OfferingCard
            icon={HardDrive}
            eyebrow="You own it"
            title="Playground in your browser"
            badge={playgroundBadge}
            text="Everything runs locally in this browser's IndexedDB — offline, no account, no server copy."
          >
            <CardLink onClick={() => void createJournal()}>Create your journal</CardLink>
            <CardLink to={ROUTE_PATTERNS.playgroundRoot}>Start Writing in a Playground</CardLink>
            <CardLink to="/feeds">Explore the notebooks</CardLink>
            <ul className="mt-1 space-y-1.5">
              <Bullet>Offline and fast — notes and results never leave this browser by default.</Bullet>
              <Bullet>Tied to this browser — export or back it up before switching browsers or clearing site data.</Bullet>
            </ul>
            <button
              type="button"
              onClick={clearData}
              disabled={clearing}
              className={`mt-1 text-left text-xs text-muted-foreground disabled:opacity-50 ${quietLink}`}
            >
              {clearing ? 'Clearing…' : 'Clear my data'}
            </button>
            {/* Horizontal split: the optional Turso backup offer. */}
            <div className="mt-auto border-t border-border pt-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden><path d={TURSO_ICON_PATH} /></svg>
                </span>
                <div className="text-sm">
                  <p className="font-medium text-foreground">Backup &amp; sync, optional</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Add a free Turso database you own — committed changes back up in the background;
                    without network you keep working and upload later.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <CardLink href={TURSO_SIGNUP_URL}>Create a free Turso account</CardLink>
                <CardLink to={ROUTE_PATTERNS.settingsStorage}>Configure backup &amp; sync</CardLink>
              </div>
            </div>
          </OfferingCard>

          <OfferingCard
            icon={Server}
            eyebrow="You own it"
            title="Self-hosted"
            badge={activeMode === 'api' ? <ActiveBadge /> : undefined}
            text="Build the app for API storage and run the Wod Wiki server yourself — local or cloud data access through a server you administer."
          >
            <ul className="mt-1 space-y-1.5">
              <Bullet>Centralized data for a team or gym — one SQLite, Turso, or Postgres backend.</Bullet>
              <Bullet>Publish your notebooks as a feed with <code className="font-mono text-xs">wod build</code> — every browser subscribes and syncs.</Bullet>
              <Bullet>You run the server — network required, and server admin is on you.</Bullet>
            </ul>
            <div className="mt-auto border-t border-border pt-4">
              <CardLink href={REPO_URL}>View source</CardLink>
            </div>
          </OfferingCard>

          <OfferingCard
            icon={Cloud}
            us
            eyebrow="Us — we'd host it"
            title="Wod-Wiki hosted"
            text="Mark the features you want — the survey unlocks below."
          >
            <FeatureGroup label="Individuals" features={INDIVIDUAL_FEATURES} interested={interested} onInterested={markInterested} />
            <FeatureGroup label="Coaching & gyms" features={TEAM_FEATURES} interested={interested} onInterested={markInterested} />
          </OfferingCard>
        </div>

        {interested.size > 0 && <SurveyFooter />}
      </div>
    </section>
  )
}
