import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Link2,
  Play,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import { formatDurationMMSS, type ScheduleItem, type ScheduleStatus } from '@bitcobblers/wod-wiki-core'
import { Button } from '@bitcobblers/wod-wiki-ui/primitives'
import { TEST_IDS } from '@/lib/testIds'
import { storageService } from '@/services/storage'
import type { Entry } from '../../lib/entryMapper'
import { entryOpenHref } from '../../lib/entryActions'
import { dayPath, sessionDetailPath } from '../../lib/routes'
import { calendarNotebookKey, notebookAccent } from '../../lib/calendarModel'
import { journalSchedule } from '../../services/journalSchedule'

export interface SchedulePeekDrawerProps {
  entry: Entry | null
  onClose: () => void
  onRunEntry?: (entry: Entry) => void
  onMutated?: () => void
}

export function SchedulePeekDrawer({
  entry,
  onClose,
  onRunEntry,
  onMutated,
}: SchedulePeekDrawerProps) {
  const [targetDate, setTargetDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nearbyPlans, setNearbyPlans] = useState<ScheduleItem[]>([])

  useEffect(() => {
    setTargetDate(entry?.date ?? '')
    setError(null)
    setNearbyPlans([])
    if (!entry?.adHocSessionId) return
    let cancelled = false
    storageService
      .getSessionById(entry.adHocSessionId)
      .then((sess) => (sess ? journalSchedule.findNearbyMatches(sess, 2) : []))
      .then((matches) => {
        if (!cancelled) setNearbyPlans(matches)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entry?.id, entry?.date, entry?.adHocSessionId])

  useEffect(() => {
    if (!entry) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [entry, onClose])

  if (!entry) return null

  const nbKey = calendarNotebookKey(entry)
  const accent = notebookAccent(nbKey)
  const hasScheduleItem = Boolean(entry.scheduleItemId)
  const paired = entry.pairedSessions?.[0]
  const statusLabel =
    entry.scheduleStatus === 'completed' || (entry.pairedSessions?.length ?? 0) > 0
      ? 'Completed'
      : entry.scheduleStatus === 'skipped'
        ? 'Skipped'
        : entry.overlayKind === 'logged'
          ? 'Ad-hoc Logged'
          : 'Planned'

  const handleReschedule = async () => {
    if (!entry.scheduleItemId || !targetDate.trim()) return
    setBusy(true)
    setError(null)
    try {
      await journalSchedule.updateItem(entry.scheduleItemId, { date: targetDate.trim() })
      onMutated?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move schedule item.')
    } finally {
      setBusy(false)
    }
  }

  const handleSetStatus = async (status: ScheduleStatus) => {
    if (!entry.scheduleItemId) return
    setBusy(true)
    setError(null)
    try {
      await journalSchedule.updateItem(entry.scheduleItemId, { status })
      onMutated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    if (!entry.scheduleItemId) return
    setBusy(true)
    setError(null)
    try {
      await journalSchedule.removeItem(entry.scheduleItemId)
      onMutated?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove from schedule.')
    } finally {
      setBusy(false)
    }
  }

  const handleLinkNearby = async (plan: ScheduleItem) => {
    if (!entry.adHocSessionId) return
    setBusy(true)
    setError(null)
    try {
      await journalSchedule.attributeSession({
        sessionId: entry.adHocSessionId,
        sessionDate: plan.date,
        scheduleItemId: plan.id,
      })
      onMutated?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link session to plan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      data-testid={TEST_IDS.CALENDAR_PEEK_DRAWER}
      aria-label={`Schedule details for ${entry.title || 'Workout'}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[340px] max-w-full flex-col border-l border-border bg-background shadow-2xl"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-block h-2.5 w-1 rounded-full ${accent.bar}`} aria-hidden />
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${accent.chip}`}>
              {nbKey === 'journal' && entry.notebookIds?.length === 0 ? 'Unfiled' : nbKey}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {statusLabel}
            </span>
            {entry.scheduleSlot && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                {entry.scheduleSlot}
              </span>
            )}
          </div>
          <h2 className="text-base font-bold text-foreground truncate">{entry.title || 'Untitled Workout'}</h2>
          {entry.date && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="size-3.5" aria-hidden />
              <span>{entry.date}</span>
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close peek drawer"
          data-testid={TEST_IDS.CALENDAR_PEEK_CLOSE}
          className="size-8 shrink-0"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {entry.scheduleNotes && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Plan notes</div>
            <p className="mt-0.5 whitespace-pre-wrap">{entry.scheduleNotes}</p>
          </div>
        )}

        {paired && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="size-3.5" aria-hidden />
              <span>Logged Session</span>
              {typeof paired.duration === 'number' && paired.duration > 0 && (
                <span className="ml-auto font-mono">{formatDurationMMSS(paired.duration)}</span>
              )}
            </div>
            <div className="mt-2">
              <Link
                to={sessionDetailPath(paired.sessionId)}
                className="inline-flex items-center gap-1 font-medium text-emerald-800 underline dark:text-emerald-200"
              >
                <span>Open session results</span>
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
        )}

        {entry.adHocSessionId && (
          <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-sky-900 dark:text-sky-200">
              <Clock className="size-3.5" aria-hidden />
              <span>Unlinked Session Log</span>
              {entry.noteSourceRevision && (
                <span className="ml-auto font-mono text-[10px]">v{entry.noteSourceRevision}</span>
              )}
            </div>
            <Link
              to={sessionDetailPath(entry.adHocSessionId)}
              className="inline-flex items-center gap-1 font-medium text-sky-900 underline dark:text-sky-200"
            >
              <span>Inspect session & attribute</span>
              <ArrowUpRight className="size-3" aria-hidden />
            </Link>
            {nearbyPlans.length > 0 && (
              <div className="space-y-1 border-t border-sky-500/20 pt-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Match nearby plan (±2d)
                </div>
                {nearbyPlans.map((plan) => (
                  <Button
                    key={plan.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleLinkNearby(plan)}
                    className="h-8 w-full justify-start gap-1.5 text-xs"
                  >
                    <Link2 className="size-3" aria-hidden />
                    <span>Pair with {plan.date}{plan.slot ? ` (${plan.slot})` : ''}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {onRunEntry && (
            <Button
              type="button"
              onClick={() => {
                onRunEntry(entry)
                onClose()
              }}
              disabled={busy}
              className="w-full justify-start gap-2"
            >
              <Play className="size-3.5" aria-hidden />
              <span>Run workout now</span>
            </Button>
          )}
          <div className="flex gap-2">
            <Link
              to={entryOpenHref(entry)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              <span>Open note</span>
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
            {entry.date && (
              <Link
                to={dayPath(entry.date)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                <span>Open day</span>
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </div>

        {hasScheduleItem && (
          <div className="space-y-3 border-t border-border/60 pt-3">
            <div className="space-y-1.5">
              <label htmlFor="peek-reschedule-date" className="text-[11px] font-semibold text-muted-foreground">
                Move to date
              </label>
              <div className="flex gap-1.5">
                <input
                  id="peek-reschedule-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  disabled={busy}
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2.5 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !targetDate || targetDate === entry.date}
                  onClick={() => void handleReschedule()}
                >
                  Move
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {entry.scheduleStatus !== 'skipped' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleSetStatus('skipped')}
                  className="gap-1.5 text-xs"
                >
                  <SkipForward className="size-3.5" aria-hidden />
                  <span>Mark skipped</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleSetStatus('planned')}
                  className="gap-1.5 text-xs"
                >
                  <Calendar className="size-3.5" aria-hidden />
                  <span>Restore to planned</span>
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleRemove()}
                className="gap-1.5 border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" aria-hidden />
                <span>Unschedule</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Unscheduling removes only this calendar slot — the canonical Note stays intact.
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
