import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Database, HardDrive, Server, User, Users } from 'lucide-react'
import { resetUserData } from '../../services/resetUserData'
import { ROUTE_PATTERNS, noteByIdPath } from '../../lib/routes'
import { getTodayDateKey } from '../../services/dateUtils'
import { journalNotes } from '../../services/journalNotes'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import { readDataSettings, storageBackend } from '@/services/storage'
import { TaglineHeader } from '../../tour/TaglineHeader'
import { TOUR_ACCENTS } from '../../tour/tourConstants'

// ponytail: form is a Google Form — swap for an in-app interest endpoint
// when the API grows one.
const REPO_URL = 'https://github.com/bitcobblers/wod-wiki'
const FORM_URL = 'https://forms.gle/6YHpxwAJh6PAsyAQ6'

const quietLink = 'underline-offset-4 transition-colors hover:text-foreground hover:underline'
function CardLink(props: { to?: string; href?: string; onClick?: () => void; children: React.ReactNode }) {
  const className = 'inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 transition-colors hover:underline'
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

function OfferingCard(props: {
  icon: typeof Database
  title: string
  text: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const Icon = props.icon
  return (
    <article className="flex flex-col rounded-xl border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
          <Icon className="size-5" aria-hidden />
        </span>
        {props.badge}
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{props.title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{props.text}</p>
      <div className="mt-4 flex flex-1 flex-col gap-2 text-sm">{props.children}</div>
    </article>
  )
}

export function OfferingTiers() {
  const [clearing, setClearing] = useState(false)
  const navigate = useNavigate()

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

  return (
    <>
      <section id="tour-section-offerings" data-testid="tour-section-offerings" aria-label="You own your data">
        <TaglineHeader
          index="06"
          before="You "
          accentText="Own the Data"
          after=""
          accent={TOUR_ACCENTS.library}
          blurb="Browser modes run from IndexedDB, with optional backup and sync to your own Turso database. API deployments use a server you choose."
        />

        <div className="mx-auto w-full max-w-[1500px] 2xl:max-w-[1720px] px-6 pb-16 pt-10 lg:px-12 xl:px-16">
          <p className="mx-auto mb-5 flex max-w-5xl flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground" role="status">
            <span>{activeMode === 'api' ? 'Current mode: API server' : activeMode === 'turso' ? 'Current mode: local browser with Turso backup and sync' : activeMode === 'turso-invalid' ? 'Current mode: local browser. Repair the Turso connection to resume sync.' : 'Current mode: local browser only'}</span>
            <Link to={ROUTE_PATTERNS.settingsStorage} className={quietLink}>Configure data storage</Link>
          </p>
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
              <OfferingCard
                icon={HardDrive}
                title="Browser only"
                badge={activeMode === 'browser' ? <ActiveBadge /> : undefined}
                text="Everything lives in this browser's IndexedDB — the default mode. Works offline, no account, no server copy."
              >
                <CardLink onClick={() => void createJournal()}>Create your journal</CardLink>
                <CardLink to={ROUTE_PATTERNS.playgroundRoot}>Start Writing in a Playground</CardLink>
                <CardLink to="/feeds">Explore the feeds</CardLink>
                <ul className="mt-1 space-y-1.5">
                  <Bullet>Offline and fast. Notes and results stay in this browser.</Bullet>
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
              </OfferingCard>

              <OfferingCard
                icon={Database}
                title="Browser + your Turso"
                badge={activeMode === 'turso' ? <ActiveBadge /> : activeMode === 'turso-invalid' ? (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-600">
                    Invalid config
                  </span>
                ) : undefined}
                text="Same local execution — plus a background backup of your data to a free Turso database you own, so multiple browsers stay in sync."
              >
                <CardLink to={ROUTE_PATTERNS.settingsStorage}>Configure backup &amp; sync</CardLink>
                <ul className="mt-1 space-y-1.5">
                  <Bullet>Queries still run locally in the browser — sync copies committed changes in the background.</Bullet>
                  <Bullet>Bring your own free Turso database — URL and auth token, kept in this browser only.</Bullet>
                  <Bullet>Sync needs network; without it you keep working locally and changes upload later.</Bullet>
                </ul>
              </OfferingCard>

              <OfferingCard
                icon={Server}
                title="API server"
                badge={activeMode === 'api' ? <ActiveBadge /> : undefined}
                text="Build the app for API storage and run the Wod Wiki server yourself — local or cloud data access through a server you administer."
              >
                <CardLink href={REPO_URL}>View source</CardLink>
                <ul className="mt-1 space-y-1.5">
                  <Bullet>Centralized data for a team or gym — one SQLite, Turso, or Postgres backend.</Bullet>
                  <Bullet>You run the server — network required, and server admin is on you.</Bullet>
                </ul>
              </OfferingCard>
          </div>
        </div>
      </section>

      <section id="tour-section-hosted" data-testid="tour-section-hosted" aria-label="Wod-Wiki hosted">
        <TaglineHeader
          index="08"
          before="Wod-Wiki "
          accentText="Hosted"
          after=""
          accent={TOUR_ACCENTS.library}
          blurb="Rather hand the caretaking to us? Wod-Wiki hosted is still taking shape — fill out the survey and help shape the plans."
        />

        <div className="mx-auto w-full max-w-[1500px] 2xl:max-w-[1720px] px-6 pb-16 pt-10 lg:px-12 xl:px-16">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-2">
            <OfferingCard
              icon={User}
              title="Individuals"
              text="For people who don't want dev-level configuration — we host the database for you and keep every device in sync."
            >
              <ul className="space-y-1.5">
                <Bullet>Managed hosting — we run the database; you just sign in.</Bullet>
                <Bullet>Profile page with a public feed.</Bullet>
                <Bullet>Sync across your apps and devices.</Bullet>
              </ul>
              <div className="mt-auto pt-3">
                <CardLink href={FORM_URL}>Fill out interest survey</CardLink>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Takes two minutes — tell us what you'd like in a hosted personal account.
                </span>
              </div>
            </OfferingCard>

            <OfferingCard
              icon={Users}
              title="Coaching & gyms"
              text="For gyms and coaches — member accounts, coach views, and your brand on the surface."
            >
              <ul className="space-y-1.5">
                <Bullet>Member accounts with coach views of athlete data.</Bullet>
                <Bullet>Coaches portal — programming dashboards and leaderboards.</Bullet>
                <Bullet>Athlete portal — private journals that roll up to their coach.</Bullet>
                <Bullet>Gym website hosting, competition timers, and whiteboard displays.</Bullet>
                <Bullet>Website branding — your gym's brand on pages and feeds.</Bullet>
              </ul>
              <div className="mt-auto pt-3">
                <CardLink href={FORM_URL}>Fill out interest survey</CardLink>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Takes two minutes — help shape our coaching and gym features.
                </span>
              </div>
            </OfferingCard>
          </div>
        </div>
      </section>
    </>
  )
}
