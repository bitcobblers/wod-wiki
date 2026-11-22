import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  GitFork,
  Layers,
  Link2,
  Play,
  Plus,
  Save,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import {
  formatDurationMMSS,
  type Note,
  type ScheduleItem,
  type ScheduleStatus,
} from '@bitcobblers/wod-wiki-core'
import {
  forkNoteToUserNotebook,
  type JournalDayOverlay,
} from '@bitcobblers/wod-wiki-engine'
import { Button } from '@bitcobblers/wod-wiki-ui/primitives'
import { TEST_IDS } from '@/lib/testIds'
import { storageService } from '@/services/storage'
import type { Entry } from '../../lib/entryMapper'
import { entryOpenHref } from '../../lib/entryActions'
import { dayPath, notePath, sessionDetailPath } from '../../lib/routes'
import { calendarNotebookKey, notebookAccent, parseDayKey } from '../../lib/calendarModel'
import {
  journalSchedule,
  notifyScheduleChanged,
  subscribeSchedule,
} from '../../services/journalSchedule'
import { useOptionalNav } from '../../nav/NavContext'

type ScheduleUpdatePatch = Parameters<typeof journalSchedule.updateItem>[1] & {
  blockId?: string | null
  notes?: string | null
}

function updateScheduleWithBlock(id: string, patch: ScheduleUpdatePatch): Promise<ScheduleItem> {
  return (
    journalSchedule.updateItem as (itemId: string, update: ScheduleUpdatePatch) => Promise<ScheduleItem>
  )(id, patch)
}

interface WodBlockOption {
  id: string
  label: string
}

function extractWodBlockOptions(note: Note | undefined): WodBlockOption[] {
  if (!note?.blocks) return []
  const wodBlocks = Object.values(note.blocks)
    .filter((block) => block.kind === 'wod')
    .sort((a, b) => a.from - b.from)

  return wodBlocks.map((block, index) => {
    const slice = note.rawContent.slice(block.from, block.to)
    const lines = slice
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('```'))
    const snippet = lines[0]
      ? lines[0].length > 36
        ? `${lines[0].slice(0, 35)}…`
        : lines[0]
      : `Workout block ${index + 1}`
    return {
      id: block.id,
      label: `Block ${index + 1}: ${snippet}`,
    }
  })
}

function formatDayHeading(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey
  const date = parseDayKey(dateKey)
  if (Number.isNaN(date.getTime())) return dateKey
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Forks a canonical Note into an editable user copy in `notebook/journal` and
 * repoints ONLY this `ScheduleItem` to the fork so all other scheduled dates
 * on the canonical Note remain untouched.
 */
export async function forkScheduleItemForDay(params: {
  scheduleItemId: string
  sourceNoteId: string
  date: string
  fallbackTitle?: string
}): Promise<Note> {
  const sourceNote = await storageService.getNote(params.sourceNoteId).catch(() => undefined)
  const baseTitle = (sourceNote?.title || params.fallbackTitle || 'Workout').trim()
  const forkTitle = params.date ? `${baseTitle} (${params.date})` : `${baseTitle} (Copy)`

  const forked = await forkNoteToUserNotebook(
    storageService.storage,
    params.sourceNoteId,
    'notebook/journal',
    { title: forkTitle },
  )

  await storageService.storage.transaction(['schedule_items'], 'readwrite', async (tx) => {
    const current = await tx.readonly('schedule_items').get(params.scheduleItemId)
    if (!current) return
    const updated: ScheduleItem = {
      ...current,
      noteId: forked.id,
      fallbackTitle: forked.title,
      sourceNotebookId: forked.notebookId ?? 'notebook/journal',
      updatedAt: Date.now(),
    }
    delete updated.blockId
    await tx.readwrite('schedule_items').put(updated)
  })

  notifyScheduleChanged()
  return forked
}

export interface SchedulePeekDrawerProps {
  entry: Entry | null
  /** Civil date (`YYYY-MM-DD`) for Day-level peek mode when no individual entry is active. */
  dayDate?: string | null
  /** Optional pre-projected calendar overlay entries for `dayDate` (fallback when storage is empty). */
  dayEntries?: readonly Entry[]
  onClose: () => void
  onRunEntry?: (entry: Entry) => void
  /** Trigger the Plan-for-date flow from Day-level peek mode. */
  onPlanForDate?: (dateKey: string) => void
  /** Drill from Day-level peek into a specific entry peek. */
  onSelectEntry?: (entry: Entry) => void
  onMutated?: () => void
}

export function SchedulePeekDrawer({
  entry,
  dayDate = null,
  dayEntries,
  onClose,
  onRunEntry,
  onPlanForDate,
  onSelectEntry,
  onMutated,
}: SchedulePeekDrawerProps) {
  const navigate = useNavigate()
  const nav = useOptionalNav()
  const navDispatch = nav?.dispatch
  const rightDrawerOpen = Boolean(nav?.navState?.rightDrawerOpen)
  const hasExternalPeek = Boolean(
    (nav?.navState as { peekTarget?: unknown } | undefined)?.peekTarget,
  )
  const isOpen = Boolean(entry || dayDate)
  const prevRightDrawerRef = useRef(rightDrawerOpen)
  const prevExternalPeekRef = useRef(hasExternalPeek)
  const yieldedToExternalRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const [targetDate, setTargetDate] = useState('')
  const [dayCue, setDayCue] = useState('')
  const [savedDayCue, setSavedDayCue] = useState('')
  const [cueSavedNotice, setCueSavedNotice] = useState(false)
  const [wodBlocks, setWodBlocks] = useState<WodBlockOption[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nearbyPlans, setNearbyPlans] = useState<ScheduleItem[]>([])

  const [dayOverlay, setDayOverlay] = useState<JournalDayOverlay | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [dayTick, setDayTick] = useState(0)

  // Coordinate mutually exclusively with SidebarLayout's 340px right-edge slot.
  useEffect(() => {
    if (!isOpen || !navDispatch) return
    yieldedToExternalRef.current = false
    navDispatch({ type: 'SET_INSPECTOR_DRAWER', open: true })
    return () => {
      if (!yieldedToExternalRef.current) {
        navDispatch({ type: 'SET_INSPECTOR_DRAWER', open: false })
      }
    }
  }, [isOpen, navDispatch])

  // Yield cleanly if L3 rightDrawer or EntityPeekDrawer opens while SchedulePeekDrawer is open.
  useEffect(() => {
    const rightJustOpened = !prevRightDrawerRef.current && rightDrawerOpen
    const peekJustOpened = !prevExternalPeekRef.current && hasExternalPeek
    prevRightDrawerRef.current = rightDrawerOpen
    prevExternalPeekRef.current = hasExternalPeek
    if (!isOpen) return
    if (peekJustOpened) {
      yieldedToExternalRef.current = true
      onCloseRef.current()
    } else if (rightJustOpened) {
      onCloseRef.current()
    }
  }, [isOpen, rightDrawerOpen, hasExternalPeek])

  // Subscribe to schedule updates while Day-level peek is open.
  useEffect(() => {
    if (!dayDate || entry) return
    return subscribeSchedule(() => setDayTick((t) => t + 1))
  }, [dayDate, entry])

  const entryId = entry?.id
  const entryDate = entry?.date
  const entryScheduleItemId = entry?.scheduleItemId
  const entryScheduleNotes = entry?.scheduleNotes
  const entryAdHocSessionId = entry?.adHocSessionId

  // Hydrate entry-level peek state (nearby matches, live ScheduleItem notes/blockId, multi-block list).
  useEffect(() => {
    const initialNotes = entryScheduleNotes ?? ''
    setTargetDate(entryDate ?? '')
    setDayCue(initialNotes)
    setSavedDayCue(initialNotes)
    setCueSavedNotice(false)
    setWodBlocks([])
    setSelectedBlockId('')
    setError(null)
    setNearbyPlans([])

    if (!entryId) return
    let cancelled = false

    if (entryAdHocSessionId) {
      storageService
        .getSessionById(entryAdHocSessionId)
        .then((sess) => (sess ? journalSchedule.findNearbyMatches(sess, 2) : []))
        .then((matches) => {
          if (!cancelled) setNearbyPlans(matches)
        })
        .catch(() => {})
    }

    if (entryScheduleItemId) {
      Promise.all([
        storageService.getNote(entryId).catch(() => undefined),
        storageService.storage.readonly('schedule_items').get(entryScheduleItemId).catch(() => undefined),
      ])
        .then(([note, liveItem]) => {
          if (cancelled) return
          const options = extractWodBlockOptions(note)
          setWodBlocks(options)
          const resolvedBlockId = liveItem?.blockId ?? ''
          setSelectedBlockId(resolvedBlockId)
          if (liveItem && liveItem.notes !== undefined && !initialNotes) {
            setDayCue(liveItem.notes)
            setSavedDayCue(liveItem.notes)
          }
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [entryId, entryDate, entryScheduleItemId, entryScheduleNotes, entryAdHocSessionId])

  // Hydrate Day-level peek overlay when dayDate is active.
  useEffect(() => {
    if (!dayDate || entry) {
      setDayOverlay(null)
      setDayLoading(false)
      return
    }
    let cancelled = false
    setDayLoading(true)
    setError(null)
    journalSchedule
      .getDayOverlay(dayDate)
      .then((overlay) => {
        if (!cancelled) {
          setDayOverlay(overlay)
          setDayLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDayOverlay(null)
          setDayLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [dayDate, entry, dayTick])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const backdrop = (
    <div
      aria-hidden="true"
      data-testid={TEST_IDS.CALENDAR_PEEK_BACKDROP}
      onClick={onClose}
      className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px] xl:hidden"
    />
  )

  // ── Day-level peek mode ────────────────────────────────────────────────────
  if (!entry && dayDate) {
    const plannedRows = dayOverlay?.planned ?? []
    const pairedSessions = plannedRows.flatMap(({ item, note, pairedSessions: sessions }) =>
      sessions.map((sess) => ({ sess, item, note })),
    )
    const adhocSessions = dayOverlay?.adhocSessions ?? []
    const hasStorageRows =
      plannedRows.length > 0 || pairedSessions.length > 0 || adhocSessions.length > 0
    const fallbackEntries = !hasStorageRows ? (dayEntries ?? []) : []

    return (
      <>
        {backdrop}
        <aside
          data-testid={TEST_IDS.CALENDAR_PEEK_DRAWER}
          data-peek-mode="day"
          aria-label={`Day schedule for ${dayDate}`}
          className="fixed inset-y-0 right-0 z-40 flex w-[340px] max-w-full flex-col border-l border-border bg-background shadow-2xl"
        >
          <header className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                  Day Summary
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{dayDate}</span>
              </div>
              <h2 className="truncate text-base font-bold text-foreground">
                {formatDayHeading(dayDate)}
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close peek drawer"
              data-testid={TEST_IDS.CALENDAR_PEEK_CLOSE}
              className="size-8 max-lg:size-11 shrink-0"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {dayLoading ? (
              <p className="text-xs text-muted-foreground">Loading day schedule…</p>
            ) : !hasStorageRows && fallbackEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
                Nothing scheduled or logged for {formatDayHeading(dayDate)} yet.
              </div>
            ) : (
              <>
                {plannedRows.length > 0 && (
                  <section className="space-y-2" aria-label="Planned workouts">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Planned ({plannedRows.length})
                    </h3>
                    <ul className="space-y-2">
                      {plannedRows.map(({ item, note, pairedSessions: linked }) => {
                        const completed = item.status === 'completed' || linked.length > 0
                        const skipped = item.status === 'skipped'
                        return (
                          <li
                            key={item.id}
                            className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Link
                                to={notePath(item.noteId)}
                                onClick={onClose}
                                className="min-w-0 flex-1 truncate font-semibold text-foreground hover:underline"
                              >
                                {note?.title || item.fallbackTitle || 'Untitled Workout'}
                              </Link>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  completed
                                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                                    : skipped
                                      ? 'bg-muted text-muted-foreground line-through'
                                      : 'bg-primary/10 text-primary'
                                }`}
                              >
                                {completed ? 'Completed' : skipped ? 'Skipped' : 'Planned'}
                              </span>
                            </div>
                            {item.slot && (
                              <div className="text-[11px] font-medium text-muted-foreground">
                                Slot: {item.slot}
                              </div>
                            )}
                            {item.notes && (
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                {item.notes}
                              </p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}

                {(pairedSessions.length > 0 || adhocSessions.length > 0) && (
                  <section className="space-y-2" aria-label="Logged sessions">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Logged Sessions ({pairedSessions.length + adhocSessions.length})
                    </h3>
                    <ul className="space-y-2">
                      {pairedSessions.map(({ sess, note }) => (
                        <li
                          key={sess.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs"
                        >
                          <Link
                            to={sessionDetailPath(sess.id)}
                            onClick={onClose}
                            className="min-w-0 flex-1 truncate font-semibold text-foreground hover:underline"
                          >
                            {note?.title || 'Logged Session'}
                          </Link>
                          {typeof sess.duration === 'number' && sess.duration > 0 && (
                            <span className="shrink-0 font-mono text-[11px] text-emerald-800 dark:text-emerald-200">
                              {formatDurationMMSS(sess.duration)}
                            </span>
                          )}
                        </li>
                      ))}
                      {adhocSessions.map(({ session: sess, note }) => (
                        <li
                          key={sess.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <Link
                              to={sessionDetailPath(sess.id)}
                              onClick={onClose}
                              className="block truncate font-semibold text-foreground hover:underline"
                            >
                              {note?.title || 'Ad-hoc Workout'}
                            </Link>
                            <span className="text-[11px] text-muted-foreground">Ad-hoc log</span>
                          </div>
                          {typeof sess.duration === 'number' && sess.duration > 0 && (
                            <span className="shrink-0 font-mono text-[11px] text-sky-900 dark:text-sky-200">
                              {formatDurationMMSS(sess.duration)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {fallbackEntries.length > 0 && (
                  <section className="space-y-2" aria-label="Entries on this date">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Entries ({fallbackEntries.length})
                    </h3>
                    <ul className="space-y-1.5">
                      {fallbackEntries.map((item, idx) => (
                        <li key={item.scheduleItemId ?? `${item.id}-${idx}`}>
                          {onSelectEntry ? (
                            <button
                              type="button"
                              onClick={() => onSelectEntry(item)}
                              className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted/60 max-lg:min-h-11"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {item.title || 'Untitled Workout'}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                Inspect
                              </span>
                            </button>
                          ) : (
                            <Link
                              to={entryOpenHref(item)}
                              onClick={onClose}
                              className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/60"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {item.title || 'Untitled Workout'}
                              </span>
                              <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>

          <footer className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
            {onPlanForDate && (
              <Button
                type="button"
                onClick={() => {
                  onClose()
                  onPlanForDate(dayDate)
                }}
                data-testid={TEST_IDS.SCHEDULE_PEEK_PLAN_FOR_DATE}
                className="w-full justify-center gap-1.5 max-lg:min-h-11"
              >
                <Plus className="size-4" aria-hidden />
                <span>Plan for date</span>
              </Button>
            )}
            <Link
              to={dayPath(dayDate)}
              onClick={onClose}
              data-testid={TEST_IDS.SCHEDULE_PEEK_OPEN_DAY}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted max-lg:min-h-11"
            >
              <span>Open day →</span>
            </Link>
          </footer>
        </aside>
      </>
    )
  }

  // ── Entry-level peek mode ──────────────────────────────────────────────────
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

  const cueDirty = dayCue.trim() !== savedDayCue.trim()

  const handleSaveDayCue = async () => {
    if (!entry.scheduleItemId) return
    setBusy(true)
    setError(null)
    setCueSavedNotice(false)
    try {
      const trimmed = dayCue.trim()
      await journalSchedule.updateItem(entry.scheduleItemId, { notes: trimmed })
      setSavedDayCue(trimmed)
      setDayCue(trimmed)
      setCueSavedNotice(true)
      onMutated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save day cue.')
    } finally {
      setBusy(false)
    }
  }

  const handleSelectBlock = async (nextBlockId: string) => {
    if (!entry.scheduleItemId) return
    setSelectedBlockId(nextBlockId)
    setBusy(true)
    setError(null)
    try {
      await updateScheduleWithBlock(entry.scheduleItemId, {
        blockId: nextBlockId || null,
      })
      onMutated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update target block.')
    } finally {
      setBusy(false)
    }
  }

  const handleForkForDay = async () => {
    if (!entry.scheduleItemId) return
    setBusy(true)
    setError(null)
    try {
      const forked = await forkScheduleItemForDay({
        scheduleItemId: entry.scheduleItemId,
        sourceNoteId: entry.id,
        date: entry.date ?? targetDate,
        fallbackTitle: entry.title,
      })
      onMutated?.()
      onClose()
      void navigate(`${notePath(forked.id)}?edit=1`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fork copy for this day.')
    } finally {
      setBusy(false)
    }
  }

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
    <>
      {backdrop}
      <aside
        data-testid={TEST_IDS.CALENDAR_PEEK_DRAWER}
        data-peek-mode="entry"
        aria-label={`Schedule details for ${entry.title || 'Workout'}`}
        className="fixed inset-y-0 right-0 z-40 flex w-[340px] max-w-full flex-col border-l border-border bg-background shadow-2xl"
      >
        <header className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-block h-2.5 w-1 rounded-full ${accent.bar}`} aria-hidden />
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${accent.chip}`}>
                {nbKey === 'journal' && entry.notebookIds?.length === 0 ? 'Unfiled' : nbKey}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {statusLabel}
              </span>
              {entry.scheduleSlot && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
                  {entry.scheduleSlot}
                </span>
              )}
            </div>
            <h2 className="truncate text-base font-bold text-foreground">
              {entry.title || 'Untitled Workout'}
            </h2>
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
            className="size-8 max-lg:size-11 shrink-0"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}

          {hasScheduleItem ? (
            <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="peek-day-cue"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Day Cue
                </label>
                {cueSavedNotice && !cueDirty && (
                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Saved
                  </span>
                )}
              </div>
              <textarea
                id="peek-day-cue"
                rows={2}
                value={dayCue}
                onChange={(e) => {
                  setDayCue(e.target.value)
                  if (cueSavedNotice) setCueSavedNotice(false)
                }}
                disabled={busy}
                placeholder="Add a day-specific cue (canonical Note stays unchanged)…"
                data-testid={TEST_IDS.SCHEDULE_PEEK_DAY_CUE_INPUT}
                className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring max-lg:min-h-11"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Applies only to this date.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !cueDirty}
                  onClick={() => void handleSaveDayCue()}
                  data-testid={TEST_IDS.SCHEDULE_PEEK_DAY_CUE_SAVE}
                  className="h-8 gap-1.5 px-2.5 text-xs max-lg:min-h-11"
                >
                  <Save className="size-3.5" aria-hidden />
                  <span>Save cue</span>
                </Button>
              </div>
            </div>
          ) : (
            entry.scheduleNotes && (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Day Cue
                </div>
                <p className="mt-0.5 whitespace-pre-wrap">{entry.scheduleNotes}</p>
              </div>
            )
          )}

          {hasScheduleItem && wodBlocks.length >= 2 && (
            <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3">
              <label
                htmlFor="peek-block-select"
                className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                <Layers className="size-3.5" aria-hidden />
                <span>Target workout block</span>
              </label>
              <select
                id="peek-block-select"
                value={selectedBlockId}
                onChange={(e) => void handleSelectBlock(e.target.value)}
                disabled={busy}
                data-testid={TEST_IDS.SCHEDULE_PEEK_BLOCK_SELECT}
                className="h-9 max-lg:min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Whole note (all {wodBlocks.length} blocks)</option>
                {wodBlocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.label}
                  </option>
                ))}
              </select>
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
                  onClick={onClose}
                  className="inline-flex items-center gap-1 font-medium text-emerald-800 underline dark:text-emerald-200"
                >
                  <span>Open session results</span>
                  <ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </div>
            </div>
          )}

          {entry.adHocSessionId && (
            <div className="space-y-2 rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-sky-900 dark:text-sky-200">
                <Clock className="size-3.5" aria-hidden />
                <span>Unlinked Session Log</span>
                {entry.noteSourceRevision && (
                  <span className="ml-auto font-mono text-[11px]">v{entry.noteSourceRevision}</span>
                )}
              </div>
              <Link
                to={sessionDetailPath(entry.adHocSessionId)}
                onClick={onClose}
                className="inline-flex items-center gap-1 font-medium text-sky-900 underline dark:text-sky-200"
              >
                <span>Inspect session & attribute</span>
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
              {nearbyPlans.length > 0 && (
                <div className="space-y-1 border-t border-sky-500/20 pt-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
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
                      className="h-8 max-lg:min-h-11 w-full justify-start gap-1.5 text-xs"
                    >
                      <Link2 className="size-3" aria-hidden />
                      <span>
                        Pair with {plan.date}
                        {plan.slot ? ` (${plan.slot})` : ''}
                      </span>
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
                className="w-full justify-start gap-2 max-lg:min-h-11"
              >
                <Play className="size-3.5" aria-hidden />
                <span>Run workout now</span>
              </Button>
            )}
            <div className="flex gap-2">
              <Link
                to={entryOpenHref(entry)}
                onClick={onClose}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted max-lg:min-h-11"
              >
                <span>Open note</span>
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
              {entry.date && (
                <Link
                  to={dayPath(entry.date)}
                  onClick={onClose}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted max-lg:min-h-11"
                >
                  <span>Open day</span>
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
            {hasScheduleItem && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleForkForDay()}
                data-testid={TEST_IDS.SCHEDULE_PEEK_FORK_BTN}
                className="w-full justify-start gap-2 text-xs max-lg:min-h-11"
              >
                <GitFork className="size-3.5" aria-hidden />
                <span>Fork copy for this day</span>
              </Button>
            )}
          </div>

          {hasScheduleItem && (
            <div className="space-y-3 border-t border-border/60 pt-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="peek-reschedule-date"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Move to date
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="peek-reschedule-date"
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    disabled={busy}
                    className="h-9 max-lg:min-h-11 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !targetDate || targetDate === entry.date}
                    onClick={() => void handleReschedule()}
                    className="max-lg:min-h-11"
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
                    className="gap-1.5 text-xs max-lg:min-h-11"
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
                    className="gap-1.5 text-xs max-lg:min-h-11"
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
                  className="gap-1.5 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 max-lg:min-h-11"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  <span>Unschedule</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Unscheduling removes only this calendar slot — the canonical Note stays intact.
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
