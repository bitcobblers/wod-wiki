import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { v7 as uuidv7 } from 'uuid'
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { CalendarCard } from '@/components/atoms/CalendarCard'
import { JournalPageShell } from '@/panels/page-shells'
import { NoteEditor } from '@/components/organisms/editor/NoteEditor'
import { BlockHistory } from '@/components/organisms/editor/BlockHistory'
import { useNoteDraft, waitForPendingNoteSave } from '../hooks/useNoteDraft'
import { useColdRouteResolution } from '../hooks/useColdRouteResolution'
import { useNoteL1Zone } from '../nav/NavContext'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { storageService } from '@/services/storage'
import { usePageSourcesReady } from '@/hooks/usePageSourcesReady'
import { queryService, refreshPageSources } from '@/services/queryService'
import { dayPath, notePath, pagePath, ROUTE_PATTERNS, runPath } from '../lib/routes'
import { appendWidget, notebookOriginOfItem, resolveEntityScope } from '@bitcobblers/wod-wiki-wql'
import { isNoteEditable, type Note, type NoteRevision, type ScheduleItem } from '@bitcobblers/wod-wiki-core'
import { journalSchedule, subscribeSchedule } from '../services/journalSchedule'
import { parseRemoteNoteId } from '@bitcobblers/wod-wiki-engine'
import {
  ForkToMyNotesDialog,
  PublicationPill,
  WorkoutSessionsList,
  resolveOwnershipPresentation,
} from '@/components/molecules/PublicationPill'
import {
  lookupRemoteRecord,
  resolveRemoteWorkout,
} from '@/services/feed/feedCatalog'
import { feedSourceById } from '@/services/feed/feedSources'
import { captureStoredRun } from '@/services/runCapture'
import { toast } from '@/hooks/use-toast'
import { GitFork, Play, RefreshCw } from 'lucide-react'
import { resolveNotePropertyStack } from '@/app/editor/runtimeTimerModel'
import { WidgetComposerDialog } from '../views/dashboards/WidgetComposerDialog'
import { HaltedRunNotice } from '@/components/organisms/editor/RuntimeTimerPanel'
import { slugifyRoute } from '../components/organisms/journal/CreateJournalNoteDialog'
import { localDateKey } from '@/lib/dateFormat'
import type { HistoryRecord } from '@/types/history'
import type { Session } from '@/types/storage'
import { onResultSaved } from '@/services/resultRecorder'
import { pendingRuntimes } from '../runtimeStore'
import type { ScriptBlock } from '@/components/Editor/types'
import { useNotePageNav } from './shared/useNotePageNav'
import { useNoteActions } from './shared/useNoteActions'
import { TEST_IDS } from '@/lib/testIds'
import { PageActions } from './shared/PageActions'
import {
  NoteContextNav,
  noteOwnership,
  provenanceLink,
  useJournalEntryDates,
  useNoteContextLinks,
} from './shared/noteContextLinks'
const contentProvider = new IndexedDBContentProvider()

export interface NoteByIdPageProps {
  noteId: string
  theme: string
}

/**
 * /notes/:noteId — the canonical single-note route.
 *
 * Loads exactly one note by id (any kind: journal, collection item,
 * playground, feed…) and renders it standalone. Read-first with the same
 * explicit Edit toggle the journal date page uses (?edit=1 opens in edit
 * mode); saves go through the content provider's guarded update path.
 */
export function NoteByIdPage({ noteId, theme }: NoteByIdPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [entry, setEntry] = useState<HistoryRecord | null>(null)
  const [rawNote, setRawNote] = useState<Note | null>(null)
  const [missing, setMissing] = useState(false)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [remoteRetryTick, setRemoteRetryTick] = useState(0)
  const [forkOpen, setForkOpen] = useState(false)
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const isPageView = location.pathname.startsWith('/page/')
  const parsedRemote = parseRemoteNoteId(noteId)
  const remoteUuid = parsedRemote.isRemote ? parsedRemote.uuid : undefined
  const feedParam = searchParams.get('feed') ?? (parsedRemote.isRemote ? parsedRemote.feedId : undefined)
  const remoteParam = searchParams.get('remote') ?? remoteUuid
  const ownershipMeta = useMemo(() => {
    const stub = rawNote ?? entry
    return resolveOwnershipPresentation(stub, {
      noteId,
      notebookOrigin: stub ? notebookOriginOfItem(stub) : undefined,
      resolvedNotebookId: entry?.notebookId ?? rawNote?.notebookIds?.[0],
      resolveFeedLabel: (id) => feedSourceById(id)?.label,
    })
  }, [rawNote, entry, noteId])
  const isReadOnly = isPageView
    || ownershipMeta.isNonOwned
    || (entry !== null && (
      entry.seedOrigin === 'seed'
      || !isNoteEditable(rawNote ?? entry, notebookOriginOfItem(rawNote ?? entry))
    ))
  // saveError is managed by useNoteDraft
  const [editingPageSlug, setEditingPageSlug] = useState(false)
  const [pageSlugInput, setPageSlugInput] = useState('')
  const [savingPageSlug, setSavingPageSlug] = useState(false)
  const [widgetComposerOpen, setWidgetComposerOpen] = useState(false)
  const [sourceEntry, setSourceEntry] = useState<HistoryRecord | null>(null)
  // Page-source datasets (@session/@today) populate before the first child
  // query block evaluates; a new page context re-populates (@today may have
  // changed since the previous page loaded).
  const sourcesReady = usePageSourcesReady()
  const { isSettling, settlementTick } = useColdRouteResolution({
    loading: (!entry && !missing && !remoteError) || remoteLoading,
    missing,
  })
  const prevLookupKeyRef = useRef<string | null>(null)
  const loadedEntryRef = useRef<HistoryRecord | null>(null)
  loadedEntryRef.current = entry
  useEffect(() => {
    void refreshPageSources().catch(() => {
      // Failure stays on the cached promise — child queries surface it.
    })
  }, [noteId])

  useEffect(() => {
    let cancelled = false
    const lookupRouteKey = `${noteId}|${remoteUuid ?? ''}|${feedParam ?? ''}|${remoteParam ?? ''}|${remoteRetryTick}`
    const routeChanged = prevLookupKeyRef.current !== lookupRouteKey
    prevLookupKeyRef.current = lookupRouteKey
    if (!routeChanged && loadedEntryRef.current) {
      return
    }
    if (routeChanged) {
      setEntry(null)
      setMissing(false)
      setRemoteError(null)
      setRemoteLoading(false)
    }
    // saveError handled in draft
    // Await any in-flight draft flush for this noteId (e.g. Ctrl+S / unmount right before Back).
    const lookupKey = remoteUuid ?? noteId
    waitForPendingNoteSave(lookupKey)
      .then(async () => {
        const [loaded, fetchedRaw] = await Promise.all([
          contentProvider.getRecord(lookupKey),
          storageService.getNote(lookupKey),
        ])
        if (cancelled) return
        if (loaded) {
          setRawNote(fetchedRaw ?? null)
          setEntry(loaded)
          setMissing(false)
          return
        }
        if (parsedRemote.isRemote || feedParam || remoteParam) {
          setRemoteLoading(true)
          const locator = parsedRemote.isRemote
            ? noteId
            : feedParam
              ? `remote:${feedParam}:${remoteParam ?? noteId}`
              : (remoteParam ?? noteId)
          const resolved = await resolveRemoteWorkout(locator, {
            storage: storageService.storage,
            ...(feedParam ? { feedId: feedParam } : {}),
          })
          if (cancelled) return
          if (!resolved) {
            setRemoteError('This remote workout could not be fetched from its feed.')
            setRemoteLoading(false)
            return
          }
          const [afterRecord, afterRaw] = await Promise.all([
            contentProvider.getRecord(resolved.canonicalNoteId),
            storageService.getNote(resolved.canonicalNoteId),
          ])
          if (cancelled) return
          setRawNote(afterRaw ?? resolved.note)
          if (afterRecord) {
            setEntry(afterRecord)
          } else {
            setEntry({
              id: resolved.canonicalNoteId,
              type: 'note',
              title: resolved.note.title,
              rawContent: resolved.note.rawContent,
              blocks: resolved.note.blocks,
              tags: resolved.note.tags ?? [],
              createdAt: resolved.note.createdAt,
              updatedAt: resolved.note.createdAt ?? Date.now(),
              targetDate: resolved.note.date ?? resolved.note.createdAt ?? Date.now(),
              schemaVersion: 1,
              sourceRevision: resolved.note.sourceRevision,
              sourceId: resolved.note.sourceId,
              seedOrigin: 'seed',
              notebookId: resolved.note.notebookIds?.[0],
            })
          }
          setMissing(false)
          setRemoteLoading(false)
          return
        }
        setMissing(true)
      })
      .catch((err) => {
        if (cancelled) return
        if (parsedRemote.isRemote || feedParam || remoteParam) {
          setRemoteError(err instanceof Error ? err.message : 'Unable to load this remote workout.')
          setRemoteLoading(false)
        } else {
          setMissing(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [noteId, searchParams, parsedRemote.isRemote, remoteUuid, feedParam, remoteParam, remoteRetryTick, settlementTick])

  // Resolve the source lineage's title so it can link to the original note.
  const sourceId = entry?.provenance?.sourceNoteId ?? entry?.sourceId
  useEffect(() => {
    setSourceEntry(null)
    if (!sourceId) return
    let cancelled = false
    contentProvider
      .getRecord(sourceId)
      .then((src) => {
        if (!cancelled) setSourceEntry(src)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sourceId])

  // ── Source-aware navigation: owning list ("Up"), L1 zone, sourceNote stamps
  const hasEntryForOwnership = Boolean(entry)
  const ownershipId = entry?.id
  const ownershipType = entry?.type
  const ownershipSourceId = entry?.sourceId
  const ownershipJournalDate = entry?.journalDate
  const ownershipSlug = entry?.slug
  const ownershipPageId = entry?.pageId
  const ownershipNotebookId = entry?.notebookId
  const ownership = useMemo(
    () =>
      hasEntryForOwnership && ownershipId !== undefined
        ? noteOwnership({
            id: ownershipId,
            type: ownershipType,
            sourceId: ownershipSourceId,
            journalDate: ownershipJournalDate,
            slug: ownershipSlug,
            pageId: ownershipPageId,
            notebookId: ownershipNotebookId,
          })
        : { zone: null, up: null, stamps: [] },
    [
      hasEntryForOwnership,
      ownershipId,
      ownershipType,
      ownershipSourceId,
      ownershipJournalDate,
      ownershipSlug,
      ownershipPageId,
      ownershipNotebookId,
    ],
  )
  useNoteL1Zone(ownership.zone)

  // ── Outline (L3) + Run + result badges, wired like the other note pages
  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([])
  const [results, setResults] = useState<Session[]>([])
  const [noteSchedules, setNoteSchedules] = useState<ScheduleItem[]>([])
  const [noteRevisions, setNoteRevisions] = useState<NoteRevision[]>([])
  const [scheduleTick, setScheduleTick] = useState(0)
  useEffect(() => subscribeSchedule(() => setScheduleTick(t => t + 1)), [])
  const noteKey = entry?.id
  const prevNoteKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    setResults([])
    setNoteSchedules([])
    setNoteRevisions([])
    if (prevNoteKeyRef.current !== undefined && prevNoteKeyRef.current !== noteKey) {
      setScriptBlocks([])
    }
    prevNoteKeyRef.current = noteKey
    if (!noteKey) return
    let cancelled = false
    const refresh = () => {
      storageService.getSessionsForNote(noteKey).then((rows) => {
        if (!cancelled) setResults(rows)
      }).catch(() => {})
      journalSchedule.listForNote(noteKey).then((items) => {
        if (!cancelled) setNoteSchedules(items)
      }).catch(() => {})
      journalSchedule.listNoteRevisions(noteKey).then((revs) => {
        if (!cancelled) setNoteRevisions(revs)
      }).catch(() => {})
    }
    refresh()
    const unsubscribe = onResultSaved((saved) => {
      if (!cancelled && saved.noteId === noteKey) refresh()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [noteKey, scheduleTick])

  const firstRunnableBlock = useMemo(
    () => scriptBlocks.find(b => b.dialect === 'time') ?? scriptBlocks[0] ?? null,
    [scriptBlocks],
  )

  const draft = useNoteDraft({
    noteId: entry?.id ?? noteId,
    initialContent: entry?.rawContent ?? '',
    initialBlocks: entry?.blocks ?? {},
    initialRevision: entry?.sourceRevision ?? 0,
    metadata: entry ? { title: entry.title } : undefined,
    onExternalChange: (nextContent) => {
      setEntry(prev => prev ? { ...prev, rawContent: nextContent } : prev);
    },
    onSavedRecord: (saved) => {
      const headingMatch = saved.rawContent.match(/^#\s+(.+)$/m);
      setEntry(prev => prev ? {
        ...prev,
        rawContent: saved.rawContent,
        blocks: saved.blocks,
        sourceRevision: saved.sourceRevision,
        ...(headingMatch ? { title: headingMatch[1].trim() } : {}),
      } : prev);
    },
  });
  flushRef.current = draft.flush;

  const handleStartWorkout = useCallback(
    async (block: ScriptBlock) => {
      if (!entry) return;
      try {
        if (ownershipMeta.isNonOwned) {
          const runTargetId = parsedRemote.isRemote ? noteId : entry.id;
          const resolveRemote = async (id: string) => {
            const res = await resolveRemoteWorkout(id, {
              storage: storageService.storage,
              ...(feedParam ? { feedId: feedParam } : {}),
            }).catch(() => undefined);
            if (!res) return undefined;
            const meta = lookupRemoteRecord(id);
            return {
              ...(res.note ? { note: res.note } : {}),
              row: res.row,
              canonicalNoteId: res.canonicalNoteId,
              remoteNoteId: res.remoteNoteId,
              feedId: res.feedId,
              notebookSlug: meta?.notebookSlug,
              record: meta?.record,
            };
          };
          const captured = await captureStoredRun(
            runTargetId,
            block,
            uuidv7(),
            'journal',
            { resolveRemoteWorkout: resolveRemote },
          );
          const refreshedRaw = await storageService.getNote(captured.note.id).catch(() => undefined);
          if (refreshedRaw) setRawNote(refreshedRaw);
          pendingRuntimes.set(captured.session.id, {
            block: captured.block,
            noteId: captured.note.id,
            captured,
            returnTo: notePath(captured.note.id),
          });
          void navigate(runPath(captured.session.id));
          return;
        }
        const captured = await draft.captureForRun(block, uuidv7());
        const targetNoteId = captured.note.id;
        pendingRuntimes.set(captured.session.id, { block: captured.block, noteId: targetNoteId, captured, returnTo: notePath(targetNoteId) });
        void navigate(runPath(captured.session.id));
      } catch (err) {
        toast({
          title: 'Workout not started',
          description: err instanceof Error ? err.message : 'Unable to start workout.',
          variant: 'destructive',
        });
      }
    },
    [entry, ownershipMeta.isNonOwned, parsedRemote.isRemote, noteId, feedParam, draft.captureForRun, navigate],
  );

  const liveContent = isReadOnly && entry ? entry.rawContent : draft.content

  const noteActions = useNoteActions({
    entry,
    liveContent,
    isReadOnly,
    onBeforeDelete: () => draft.cancel(),
    deleteRedirectTo:
      ownership.up?.to ??
      (entry?.journalDate ? dayPath(entry.journalDate) : ROUTE_PATTERNS.journal),
    provider: contentProvider,
    onMutateContent: (_note, nextContent) => draft.onSourceMutate(nextContent),
    onEditPageSlug: (target) => {
      setPageSlugInput(target.slug || slugifyRoute(target.title) || `page-${target.id.slice(0, 8)}`)
      setEditingPageSlug(true)
    },
    onAddWidget: () => setWidgetComposerOpen(true),
    onUpdated: (updated) =>
      setEntry((prev) =>
        prev && prev.id === updated.id
          ? {
              ...prev,
              journalDate: updated.journalDate,
              slug: updated.slug,
              sourceId: updated.sourceId,
              placements: updated.placements,
            }
          : prev,
      ),
  })

  const noteScope = useMemo(
    () => (entry ? resolveEntityScope({ noteId: entry.id, label: entry.title, rawContent: liveContent }) : null),
    [entry, liveContent],
  );
  const stackedWidgets = useMemo(
    () => (entry ? resolveNotePropertyStack(liveContent, { noteId: entry.id }).dashboardWidgets : []),
    [entry, liveContent],
  );

  useNotePageNav({
    content: liveContent,
    scriptBlocks,
    onStartWorkout: (block) => {
      void handleStartWorkout(block);
    },
    results,
    noteId: entry?.id,
    helpfulActions: noteActions.helpfulActions,
  });
  const [contextVersion, setContextVersion] = useState(0)
  const placementRevision = entry
    ? `${entry.sourceRevision ?? 0}:${contextVersion}:${(entry.placements ?? [])
        .map(p => `${p.pageId}:${p.slug ?? ''}:${p.date ?? ''}`)
        .join(',')}`
    : undefined;
  const contextLinks = useNoteContextLinks(
    entry
      ? {
          noteId: entry.id,
          stamps: ownership.stamps,
          liveContent,
          revision: placementRevision,
        }
      : { noteId: '', stamps: [] },
  );
  const journalDates = useJournalEntryDates();
  const calendar = entry?.journalDate ? (
    <CalendarCard
      selectedDate={new Date(`${entry.journalDate}T12:00:00`)}
      onDateSelect={(date) => navigate(dayPath(localDateKey(date)))}
      entryDates={journalDates}
    />
  ) : undefined;

  const handleCompleteWorkout = useCallback(() => Promise.resolve(), []);

  let body: ReactNode
  if (remoteLoading) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <p>Loading workout from feed…</p>
      </div>
    )
  } else if (remoteError) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
        <p className="text-sm font-semibold text-foreground">Workout unavailable</p>
        <p className="max-w-md text-xs text-muted-foreground">{remoteError}</p>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={() => setRemoteRetryTick(t => t + 1)} className="gap-1.5">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/feeds')}>
            Browse feeds
          </Button>
        </div>
      </div>
    )
  } else if (missing && isSettling) {
    body = (
      <div role="status" data-testid={TEST_IDS.NOTE_LOADING_SETTLING} className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <p>Loading library content…</p>
      </div>
    )
  } else if (missing) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>Note not found.</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    )
  } else if (!entry) {
    body = <div className="flex flex-1 items-center justify-center text-zinc-400">Loading…</div>
  } else {
    // Whiteboard "canonical note" sticky: only Cast + shared chrome + page
    // options — Placements/Clone/Copy link live in L3 (helpfulActions above,
    // mirrored into the ⋯ menu via NavContext l3Items).
    const pageActions = (
      <PageActions
        mode="notebook-readonly"
        currentWorkout={{ name: entry.title || entry.id, content: entry.rawContent }}
        index={[]}
      />
    )

    body = (
      <>
        <JournalPageShell
          title={entry.title}
          subtitle={
            ownership.up ? (
              <Link to={ownership.up.to} className="underline-offset-2 hover:underline">
                {ownership.up.title}
              </Link>
            ) : undefined
          }
          actions={pageActions}
          editor={
            <div className="flex flex-col gap-4 px-4 py-6 sm:px-6 min-w-0 max-w-full">
              <NoteContextNav data={contextLinks} up={ownership.up} calendar={calendar} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/50 pb-3 text-xs text-muted-foreground" data-testid="note-header-meta-row">
                <PublicationPill
                  noteId={entry.id}
                  notebookId={entry.notebookId}
                  sessions={results}
                  isReadOnlyFeedNote={isReadOnly}
                  note={rawNote ?? entry}
                  ownershipOverride={ownershipMeta.ownership}
                  resolveFeedLabel={(id) => feedSourceById(id)?.label}
                  resolveRemoteWorkoutFn={async (id) => {
                    const res = await resolveRemoteWorkout(id, { storage: storageService.storage, ...(feedParam ? { feedId: feedParam } : {}) }).catch(() => undefined);
                    if (!res) return undefined;
                    const meta = lookupRemoteRecord(id);
                    return { row: res.row, canonicalNoteId: res.canonicalNoteId, remoteNoteId: res.remoteNoteId, feedId: res.feedId, notebookSlug: meta?.notebookSlug, record: meta?.record };
                  }}
                  open={noteActions.promotionOpen}
                  onOpenChange={noteActions.setPromotionOpen}
                  onCloneRequest={() => noteActions.setPlacement('clone')}
                  onForked={(forked) => { void navigate(`${notePath(forked.id)}?edit=1`) }}
                  onChanged={() => setContextVersion((v) => v + 1)}
                />
                {!isReadOnly && (noteSchedules.length > 0 || results.length > 0 || (entry.notebookIds?.length ?? 0) > 1 || (entry.notebookIds?.length ?? -1) === 0) && (
                  <div
                    data-testid={TEST_IDS.NOTE_SHARED_BANNER}
                    className="mt-1 flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                        {entry.notebookIds?.length === 0 ? (
                          <span>Unfiled note · not in a Notebook</span>
                        ) : (
                          <span>
                            In {entry.notebookIds?.length ?? (entry.notebookId ? 1 : 0)} notebook
                            {(entry.notebookIds?.length ?? (entry.notebookId ? 1 : 0)) === 1 ? '' : 's'}
                          </span>
                        )}
                        {noteSchedules.length > 0 && (
                          <span>· Scheduled on {noteSchedules.length} day{noteSchedules.length === 1 ? '' : 's'}</span>
                        )}
                        {results.length > 0 && (
                          <span>· {results.length} logged session{results.length === 1 ? '' : 's'}</span>
                        )}
                      </div>
                      {results.length > 0 && (
                        <p data-testid={TEST_IDS.NOTE_REVISIONS_NOTICE} className="text-[11px] text-muted-foreground">
                          Edits create a new version (v{(entry.sourceRevision ?? 1) + 1}). Your {results.length} historical session
                          {results.length === 1 ? '' : 's'} remain pinned to v{entry.sourceRevision ?? 1}
                          {noteRevisions.length > 0 ? ` (${noteRevisions.length} archived revision${noteRevisions.length === 1 ? '' : 's'})` : ''}.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {entry.notebookIds?.length === 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => noteActions.setPromotionOpen(true)}
                          className="h-7 px-2.5 text-[11px]"
                        >
                          Add to notebook
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => noteActions.setPlacement('clone')}
                        className="h-7 px-2.5 text-[11px]"
                      >
                        Fork copy
                      </Button>
                    </div>
                  </div>
                )}
                {ownershipMeta.isNonOwned && !isPageView && (
                  <div className="flex flex-wrap items-center gap-2">
                    {firstRunnableBlock && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleStartWorkout(firstRunnableBlock)}
                        className="h-8 gap-1.5 px-3 text-xs"
                      >
                        <Play className="size-3.5" aria-hidden="true" />
                        Start / Log Workout
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setForkOpen(true)}
                      className="h-8 gap-1.5 px-3 text-xs"
                    >
                      <GitFork className="size-3.5" aria-hidden="true" />
                      Fork to My Notes
                    </Button>
                  </div>
                )}
                {entry.journalDate && entry.journalDate !== entry.title && (
                    <Link to={dayPath(entry.journalDate)} className="underline-offset-2 hover:underline">
                      {entry.journalDate}
                    </Link>
                  )}
                  {editingPageSlug && !isReadOnly ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault()
                        const nextSlug = slugifyRoute(pageSlugInput)
                        if (!nextSlug || savingPageSlug) return
                        setSavingPageSlug(true)
                        try {
                          const existingPagePlacement = entry.placements?.find(p => p.slug && !p.date)
                          const updated = existingPagePlacement
                            ? existingPagePlacement.slug === nextSlug
                              ? entry
                              : await contentProvider.moveRecordPlacement(entry.id, existingPagePlacement.pageId, { slug: nextSlug })
                            : await contentProvider.addRecordPlacement(entry.id, { slug: nextSlug })
                          setEntry(prev => prev ? { ...prev, slug: updated.slug, placements: updated.placements } : prev)
                          setEditingPageSlug(false)
                        } finally {
                          setSavingPageSlug(false)
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5"
                      data-testid="note-page-slug-form"
                    >
                      <span className="font-mono text-muted-foreground">/page/</span>
                      <input
                        type="text"
                        value={pageSlugInput}
                        onChange={e => setPageSlugInput(e.target.value)}
                        autoFocus
                        disabled={savingPageSlug}
                        aria-label="Page slug"
                        placeholder="slug"
                        data-testid="note-page-slug-input"
                        className="w-36 bg-transparent font-mono text-xs text-foreground focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!slugifyRoute(pageSlugInput) || savingPageSlug}
                        data-testid="note-page-slug-save"
                        className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPageSlug(false)}
                        disabled={savingPageSlug}
                        className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : entry.slug ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Link to={pagePath(entry.slug)} className="font-mono underline-offset-2 hover:underline">
                        /p/{entry.slug}
                      </Link>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setPageSlugInput(entry.slug!)
                            setEditingPageSlug(true)
                          }}
                          data-testid="note-edit-page-slug-btn"
                          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        >
                          Edit slug
                        </button>
                      )}
                    </span>
                  ) : !isReadOnly ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPageSlugInput(slugifyRoute(entry.title) || `page-${entry.id.slice(0, 8)}`)
                        setEditingPageSlug(true)
                      }}
                      data-testid="note-upgrade-to-page-btn"
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      + Upgrade to Page
                    </button>
                  ) : null}
                  {(entry.provenance || entry.sourceId) && (
                    <span data-testid="note-provenance-banner">
                      Cloned from{' '}
                      {sourceEntry ? (
                        <Link to={notePath(sourceEntry.id)} className="underline-offset-2 hover:underline">
                          {sourceEntry.title || sourceEntry.id}
                          {entry.provenance?.sourceVersion !== undefined ? ` (v${entry.provenance.sourceVersion})` : ''}
                        </Link>
                      ) : entry.provenance ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {entry.provenance.sourceNotebookId
                            ? `${entry.provenance.sourceNotebookId.replace(/^notebook\//, '')}`
                            : entry.provenance.sourceNoteId}
                          {entry.provenance.sourceVersion !== undefined ? ` · v${entry.provenance.sourceVersion}` : ''}
                          {' (original unavailable)'}
                        </span>
                      ) : (
                        (() => {
                          const stamped = provenanceLink(entry.sourceId!)
                          return stamped ? (
                            <Link to={stamped.to} className="underline-offset-2 hover:underline">
                              {stamped.title}
                            </Link>
                          ) : (
                            entry.sourceId
                          )
                        })()
                      )}
                    </span>
                  )}
              </div>
              {!isReadOnly && stackedWidgets.length > 0 && (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs"
                  data-testid="note-stacked-widgets-tray"
                >
                  <span className="font-semibold text-muted-foreground">Attach widget from tags/summaries:</span>
                  {stackedWidgets.map((sw) => (
                    <button
                      key={sw.key}
                      type="button"
                      onClick={() => {
                        draft.onSourceMutate(appendWidget(draft.content, {
                          title: sw.title,
                          type: sw.type,
                          wql: sw.wql,
                        }))
                      }}
                      className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      + {sw.title} ({sw.type})
                    </button>
                  ))}
                </div>
              )}
              {!sourcesReady ? <HaltedRunNotice noteId={entry.id} /> : null}
              {sourcesReady ? (
                <>
                  <div className="min-h-[240px] min-w-0">
                    <NoteEditor
                      key={entry.id}
                      value={isReadOnly ? entry.rawContent : draft.content}
                      onChange={isReadOnly ? () => {} : draft.onSourceMutate}
                      {...(isReadOnly
                        ? {}
                        : {
                            onBlur: draft.onBlur,
                            onIdentityChange: draft.onIdentityChange,
                            onSaved: draft.accept,
                            beforeRun: async () => { await draft.flush(); return draft.committedSourceRevision(); },
                            onSaveRequest: draft.flush,
                            onCommitChange: draft.flush,
                            onCursorPositionChange: draft.onLineChange,
                          })}
                      noteId={entry.id}
                      noteBlocks={isReadOnly ? (entry.blocks ?? {}) : draft.committedBlocks}
                      sourceRevision={isReadOnly ? (entry.sourceRevision ?? 1) : draft.committedRevision}
                      readonly={isReadOnly}
                      enableInlineRuntime={!ownershipMeta.isNonOwned}
                      onStartWorkout={ownershipMeta.isNonOwned ? handleStartWorkout : undefined}
                      theme={theme}
                      showLineNumbers={false}
                      onCompleteWorkout={handleCompleteWorkout}
                      onBlocksChange={setScriptBlocks}
                      placeholder="Write workout or notes here…"
                    />
                  </div>
                  {!isReadOnly && draft.saveError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {draft.saveError}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="flex items-center justify-center text-zinc-400 text-sm py-8">Loading…</div>
              )}
              <WorkoutSessionsList sessions={results} />
              <BlockHistory noteId={entry.id} blocks={isReadOnly ? (entry.blocks ?? {}) : draft.committedBlocks} sourceRevision={isReadOnly ? (entry.sourceRevision ?? 1) : draft.committedRevision} onRevert={isReadOnly ? undefined : draft.restoreRevision} />
              <ForkToMyNotesDialog
                open={forkOpen}
                onOpenChange={setForkOpen}
                sourceNoteId={parsedRemote.isRemote ? noteId : entry.id}
                sourceTitle={entry.title}
                storageInstance={storageService.storage}
                resolveRemoteWorkoutFn={async (id) => {
                  const res = await resolveRemoteWorkout(id, { storage: storageService.storage, ...(feedParam ? { feedId: feedParam } : {}) }).catch(() => undefined);
                  if (!res) return undefined;
                  const meta = lookupRemoteRecord(id);
                  return { row: res.row, canonicalNoteId: res.canonicalNoteId, remoteNoteId: res.remoteNoteId, feedId: res.feedId, notebookSlug: meta?.notebookSlug, record: meta?.record };
                }}
                onForked={(forked) => { void navigate(`${notePath(forked.id)}?edit=1`) }}
              />
            </div>
          }
        />
        {noteActions.dialogs}
        <WidgetComposerDialog
          open={widgetComposerOpen}
          onClose={() => setWidgetComposerOpen(false)}
          mode="add"
          initialWql={noteScope?.primaryWql ?? ':session{}'}
          subsetQuery={noteScope?.notesWql ?? null}
          executor={queryService}
          tokenValues={noteScope?.tokens}
          onApply={(spec) => {
            draft.onSourceMutate(appendWidget(draft.content, spec))
          }}
        />
      </>
    )
  }

  return body
}
