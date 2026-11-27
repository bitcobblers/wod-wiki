/**
 * WorkoutEditorPage — /notebook/:slug/:item
 *
 * Wrapper that loads workout content via IndexedDB (or falls back to the
 * bundled MD file). Keeps ScriptBlock IDs stable across page loads so results
 * stay linked.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { formatDateHeader } from '@/lib/dateFormat'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from '@/hooks/use-toast'
import { EditorView } from '@codemirror/view'
import { v7 as uuidv7 } from 'uuid'
import { NoteEditor } from '@/components/organisms/editor/NoteEditor'
import { captureRun, captureStoredRun } from '@/services/runCapture';
import { JournalPageShell } from '@/panels/page-shells'
import type { ScriptBlock } from '@/components/Editor/types'
import type { Note, Session } from '@/types/storage'
import { CalendarCard } from '@/components/atoms/CalendarCard'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import { Button } from '@bitcobblers/wod-wiki-ui/primitives'
import { toNotebookId } from '@bitcobblers/wod-wiki-core'
import { parseRemoteNoteId } from '@bitcobblers/wod-wiki-engine'
import { notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql'
import {
  ForkToMyNotesDialog,
  OwnershipPillBadge,
  WorkoutSessionsList,
  resolveOwnershipPresentation,
} from '@/components/molecules/PublicationPill'
import {
  lookupRemoteRecord,
  playgroundFeedCatalogStore,
  resolveRemoteWorkout,
  type ResolvedRemoteWorkout,
} from '@/services/feed/feedCatalog'
import { storageService } from '@/services/storage'
import { onResultSaved } from '@/services/resultRecorder'
import { GitFork, Play, RefreshCw } from 'lucide-react'
import { usePlaygroundContent } from '../hooks/usePlaygroundContent'
import { pageId } from '../services/playgroundContent'
import { pendingRuntimes } from '../runtimeStore'
import { dayPath, notePath, runPath, notebookItemPath } from '../lib/routes'
import { createJournalNoteFromWorkout } from '../services/journalWorkout'
import { PageActions } from './shared/PageActions'
import { useNotePageNav } from './shared/useNotePageNav'
import {
  NoteContextNav,
  noteOwnership,
  useNoteContextLinks,
} from './shared/noteContextLinks'
import { useScriptBlockCommands } from '../hooks/useScriptBlockCommands'
import { shareBlock, openBlockInPlayground } from '../services/openInPlayground'
import { useNav } from '../nav/NavContext'
import { ResponsiveActions } from '../nav/ResponsiveActions'
import {
  INLINE_RUNTIME_CATEGORIES,
  NOTEBOOK_EXCLUDED_CATEGORIES,
  appendTimerBlock,
} from './shared/pageUtils'

export interface WorkoutEditorPageProps {
  category: string
  name: string
  mdContent: string
  theme: string
  /**
   * Optional override for the run-button behavior.
   * - 'inline' opens the wall-clock popup in-place (useful for Storybook scenarios).
   * - 'journal' appends to the journal and navigates there (production default for collections).
   * When omitted, behavior is derived from the category.
   */
  runMode?: 'inline' | 'journal'
  /**
   * Strip non-runtime commands (Today, Schedule) from the WOD block action bar.
   * Useful in Storybook scenarios where journal persistence is out of scope.
   * Does not affect the production Playground pages.
   */
  hidePlanningCommands?: boolean
  onViewCreated?: (view: EditorView) => void
  onScrollToSection?: (id: string) => void
}

function slugifyNoteTitle(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function WorkoutEditorPage({
  category,
  name,
  mdContent,
  theme,
  runMode,
  hidePlanningCommands,
  onViewCreated,
}: WorkoutEditorPageProps) {
  const usePopup = runMode ? runMode === 'inline' : INLINE_RUNTIME_CATEGORIES.has(category)
  const isNotebookItem = !NOTEBOOK_EXCLUDED_CATEGORIES[category]
  const hasBundledContent = mdContent.trim().length > 0
  // Deep links to `/notebook/:slug/:target` (including `journal` / `playground`)
  // must resolve existing member notes instead of fabricating empty placeholder
  // notes in IndexedDB when no bundled markdown exists.
  const shouldResolveLocalNotebook = isNotebookItem || (!hasBundledContent && category !== 'canvas' && category !== 'syntax')
  const noteId = pageId(category, name)
  const navigate = useNavigate()
  const { openPeek, closePeek } = useNav()
  const [searchParams] = useSearchParams()
  const feedParam = searchParams.get('feed') ?? undefined
  const remoteParam = searchParams.get('remote') ?? undefined
  const [storedNote, setStoredNote] = useState<Note | null>(null)
  const [resolvedRemote, setResolvedRemote] = useState<ResolvedRemoteWorkout | null>(null)
  const [resolvingNote, setResolvingNote] = useState(shouldResolveLocalNotebook)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [remoteRetryTick, setRemoteRetryTick] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const [forkOpen, setForkOpen] = useState(false)
  // seedOnMount: never fabricate an empty ghost note in IndexedDB when a
  // deep link has no bundled markdown content (e.g. `/notebook/journal/my-workout`).
  const { content, loading, entryId, noteBlocks, sourceRevision, onIdentityChange, onSaved, error, onChange, onLineChange, onBlur, flush, committedSourceRevision } = usePlaygroundContent({ category, name, mdContent, seedOnMount: !isNotebookItem && hasBundledContent })

  useEffect(() => {
    if (!shouldResolveLocalNotebook) {
      setStoredNote(null)
      setResolvedRemote(null)
      setRemoteError(null)
      setRemoteLoading(false)
      setResolvingNote(false)
      return
    }
    let cancelled = false
    setResolvingNote(true)
    setStoredNote(null)
    setResolvedRemote(null)
    setRemoteError(null)
    const resolveLocalOrRemote = async () => {
      try {
        const decodedName = (() => {
          try { return decodeURIComponent(name) } catch { return name }
        })()
        const targetId = remoteParam ?? noteId
        const direct =
          (await storageService.getNote(targetId).catch(() => undefined)) ??
          (decodedName !== targetId ? await storageService.getNote(decodedName).catch(() => undefined) : undefined)
        if (cancelled) return
        if (direct) {
          setStoredNote(direct)
          setResolvedRemote(null)
          return
        }
        const allNotes = await storageService.getAllNotes().catch(() => [] as Note[])
        if (cancelled) return
        const nbId = toNotebookId(category)
        const nameLower = decodedName.toLowerCase()
        const nameSlug = slugifyNoteTitle(decodedName)
        const inNotebook = (n: Note): boolean =>
          n.notebookId === nbId ||
          Boolean(n.notebookIds?.includes(nbId)) ||
          (category === 'journal' && (n.type === 'journal' || !n.notebookId))
        const matched = allNotes.find((n) =>
          (remoteParam && n.id === remoteParam) ||
          n.id === decodedName ||
          (n.sourceId === `notebook:${category}/${decodedName}`) ||
          (inNotebook(n) && (
            n.title?.toLowerCase() === nameLower ||
            (nameSlug.length > 0 && slugifyNoteTitle(n.title ?? '') === nameSlug)
          )),
        )
        if (matched) {
          setStoredNote(matched)
          setResolvedRemote(null)
          return
        }
        if (mdContent && mdContent.trim().length > 0) {
          return
        }
        if (!isNotebookItem) {
          return
        }
        const remoteCandidates = await playgroundFeedCatalogStore
          .getRemoteNotebookNotes(category, feedParam)
          .catch(() => [] as Note[])
        if (cancelled) return
        const matchedRemote = remoteCandidates.find((r) => {
          const parsed = parseRemoteNoteId(r.id)
          const uuid = parsed.isRemote ? parsed.uuid : r.id
          return (
            (remoteParam && (uuid === remoteParam || r.id === remoteParam)) ||
            r.title.toLowerCase() === name.toLowerCase() ||
            r.sourceId?.toLowerCase().endsWith(`/${name.toLowerCase()}`) ||
            r.sourcePath?.toLowerCase().includes(`/${name.toLowerCase()}.`)
          )
        })
        const locator = remoteParam && feedParam
          ? `remote:${feedParam}:${remoteParam}`
          : matchedRemote
            ? matchedRemote.id
            : remoteParam
        if (!locator) return
        setRemoteLoading(true)
        try {
          const res = await resolveRemoteWorkout(locator, {
            storage: storageService.storage,
            ...(feedParam ? { feedId: feedParam } : {}),
          })
          if (cancelled) return
          if (!res) {
            setRemoteError('This workout could not be fetched from its feed.')
          } else {
            setResolvedRemote(res)
            setStoredNote(res.note)
          }
        } catch (err) {
          if (!cancelled) {
            setRemoteError(err instanceof Error ? err.message : 'Unable to fetch workout from feed.')
          }
        } finally {
          if (!cancelled) setRemoteLoading(false)
        }
      } finally {
        if (!cancelled) setResolvingNote(false)
      }
    }
    void resolveLocalOrRemote()
    return () => {
      cancelled = true
    }
  }, [shouldResolveLocalNotebook, isNotebookItem, remoteParam, feedParam, noteId, category, name, mdContent, remoteRetryTick])

  const effectiveContent = resolvedRemote?.note.rawContent ?? storedNote?.rawContent ?? content
  const effectiveBlocks = resolvedRemote?.note.blocks ?? storedNote?.blocks ?? noteBlocks
  const effectiveRevision = resolvedRemote?.note.sourceRevision ?? storedNote?.sourceRevision ?? sourceRevision
  const effectiveTitle = resolvedRemote?.note.title || storedNote?.title || name
  const canonicalNoteId = resolvedRemote?.canonicalNoteId ?? storedNote?.id ?? entryId ?? noteId
  const runTargetId = resolvedRemote?.remoteNoteId ?? canonicalNoteId

  useEffect(() => {
    setSessions([])
    const refresh = () => {
      void storageService.getSessionsForNote(canonicalNoteId).then(setSessions).catch(() => {})
    }
    refresh()
    const unsub = onResultSaved((saved) => {
      if (saved.noteId === canonicalNoteId) refresh()
    })
    return () => {
      unsub()
    }
  }, [canonicalNoteId])

  const ownershipMeta = useMemo(() => {
    const stub = resolvedRemote?.note ?? storedNote
    return resolveOwnershipPresentation(stub, {
      noteId: runTargetId,
      notebookOrigin: stub ? notebookOriginOfItem(stub) : feedParam ? 'feed' : undefined,
      resolvedNotebookId: isNotebookItem ? toNotebookId(category) : undefined,
      fallbackReadOnly: isNotebookItem,
    })
  }, [resolvedRemote?.note, storedNote, runTargetId, feedParam, isNotebookItem, category])

  const buildRemoteResolver = useCallback(
    () => async (id: string) => {
      const res = await resolveRemoteWorkout(id, {
        storage: storageService.storage,
        ...(feedParam ? { feedId: feedParam } : {}),
      }).catch(() => undefined)
      if (!res) return undefined
      const meta = lookupRemoteRecord(id)
      return {
        ...(res.note ? { note: res.note } : {}),
        row: res.row,
        canonicalNoteId: res.canonicalNoteId,
        remoteNoteId: res.remoteNoteId,
        feedId: res.feedId,
        notebookSlug: meta?.notebookSlug ?? category,
        record: meta?.record,
      }
    },
    [feedParam, category],
  )

  const sourceNote = useMemo(() => {
    if (!isNotebookItem) return null

    return {
      label: `${category}-${name}`,
      path: notebookItemPath(category, name),
    }
  }, [category, isNotebookItem, name])

  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null)

  const handleStartWorkout = useCallback(
    async (block: ScriptBlock) => {
      const runtimeId = uuidv7()
      // For syntax/inline categories or non-notebook playground pages keep direct captureRun.
      if (usePopup || !isNotebookItem) {
        try {
          await flush();
          const captured = await captureRun({ noteId: canonicalNoteId, rawContent: effectiveContent, blocks: effectiveBlocks, expectedSourceRevision: committedSourceRevision(), metadata: { title: effectiveTitle }, noteType: 'playground' }, block, runtimeId, undefined, undefined, { deferPersist: true });
          onSaved({ rawContent: captured.note.rawContent, blocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision });
          pendingRuntimes.set(runtimeId, { block: captured.block, noteId: captured.session.noteId, captured });
          void navigate(runPath(runtimeId));
        } catch (error) {
          toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
        }
        return
      }
      // Unified external/feed/system session logger: pin single canonical local copy, never spawn duplicate user note.
      try {
        const resolveRemote = buildRemoteResolver()
        const noteExists = Boolean(storedNote || resolvedRemote)
        if (noteExists) {
          const captured = await captureStoredRun(runTargetId, block, runtimeId, 'journal', {
            resolveRemoteWorkout: resolveRemote,
          })
          const refreshed = await storageService.getNote(captured.note.id).catch(() => undefined)
          if (refreshed) setStoredNote(refreshed)
          pendingRuntimes.set(runtimeId, { block: captured.block, noteId: captured.note.id, captured, returnTo: notebookItemPath(category, name) })
          void navigate(runPath(captured.session.id))
          return
        }
        const captured = await captureRun({
          noteId: canonicalNoteId,
          rawContent: effectiveContent,
          blocks: effectiveBlocks,
          expectedSourceRevision: effectiveRevision,
          metadata: { title: effectiveTitle },
        }, block, runtimeId, 'journal', undefined, { deferPersist: true })
        pendingRuntimes.set(runtimeId, { block: captured.block, noteId: captured.note.id, captured, returnTo: notebookItemPath(category, name) })
        void navigate(runPath(captured.session.id))
      } catch (error) {
        toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
      }
    },
    [usePopup, isNotebookItem, canonicalNoteId, runTargetId, effectiveContent, effectiveBlocks, effectiveRevision, effectiveTitle, storedNote, resolvedRemote, buildRemoteResolver, name, category, navigate, flush, committedSourceRevision, onSaved],
  )

  const handleScheduleBlock = useCallback(
    async (block: ScriptBlock, date: Date) => {
      const dateLabel = formatDateHeader(date);
      let journalDate: string
      try {
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: effectiveTitle,
          category,
          sourceNoteId: runTargetId,
          sourceNoteLabel: ownershipMeta.feedLabel ?? sourceNote?.label,
          sourceNotePath: sourceNote?.path,
          wodContent: block.content,
          date,
          wrapInWod: true,
          resolveRemoteWorkout: buildRemoteResolver(),
        })
        journalDate = journalNote.journalDate ?? ''
      } catch {
        toast({
          variant: 'destructive',
          title: 'Could not save workout',
          description: `Failed to add "${name}" to ${dateLabel}. Please try again.`,
        })
        return
      }
      void navigate(dayPath(journalDate))
      const journalRoute = dayPath(journalDate)
      toast({
        title: `Added to ${dateLabel}`,
        description: `"${effectiveTitle}" was added to your journal.`,
        action: {
          label: 'View Note',
          onAction: () => navigate(journalRoute),
        },
        duration: 7000,
      })
    },
    [effectiveTitle, category, runTargetId, ownershipMeta.feedLabel, buildRemoteResolver, sourceNote, navigate],
  )

  const commands = useScriptBlockCommands('notebook-readonly', {
    onPlay: (block) => {
      void handleStartWorkout(block)
    },
    onShare: shareBlock,
    onAddToToday: hidePlanningCommands ? undefined : (block) => { void handleScheduleBlock(block, new Date()) },
    onSchedule: hidePlanningCommands ? undefined : setPendingScheduleBlock,
    onOpenInPlayground: (block) => { void openBlockInPlayground(block, navigate) },
  })

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([])
  const handleEditNote = useCallback(() => {
    void navigate(notePath(noteId))
  }, [navigate, noteId])
  // Whiteboard notebook-member L3: Add to today, Plan, Open in playground
  // after the outline — page-level shortcuts over the first runnable block
  // (every block keeps its own command bar). Index deps on scriptBlocks keep
  // the published closures fresh.
  const firstWodBlock = useMemo(
    () => scriptBlocks.find(b => b.dialect === 'time' || b.dialect === 'log') ?? null,
    [scriptBlocks],
  )
  const helpfulActions = useMemo(() => {
    const actions = isNotebookItem
      ? []
      : [{ id: 'add-timer', label: 'Add timer', onRun: () => onChange(appendTimerBlock(effectiveContent)) }]
    if (!firstWodBlock) return actions
    return [
      ...actions,
      ...(hidePlanningCommands ? [] : [
        { id: 'add-to-today', label: 'Add to today', onRun: () => void handleScheduleBlock(firstWodBlock, new Date()) },
        { id: 'plan', label: 'Plan for a date', onRun: () => setPendingScheduleBlock(firstWodBlock) },
      ]),
      { id: 'open-in-playground', label: 'Open in playground', onRun: () => void openBlockInPlayground(firstWodBlock, navigate) },
    ]
  }, [isNotebookItem, firstWodBlock, effectiveContent, hidePlanningCommands, handleScheduleBlock, navigate, onChange])
  useNotePageNav({
    content: effectiveContent,
    scriptBlocks,
    onStartWorkout: (block) => {
      void handleStartWorkout(block)
    },
    onEditNote: isNotebookItem ? handleEditNote : undefined,
    noteId: canonicalNoteId,
    helpfulActions,
  })
  // Contextual links (efforts in script, sibling workouts sharing blocks,
  // journal copies) — only for real notebook items, not journal/syntax ids.
  const ownership = useMemo(
    () => (isNotebookItem ? noteOwnership({ id: noteId, type: 'note' }) : null),
    [isNotebookItem, noteId],
  )
  const contextData = useNoteContextLinks({
    noteId,
    stamps: ownership?.stamps ?? [],
    liveContent: isNotebookItem ? effectiveContent : undefined,
    revision: effectiveRevision,
  })
  const headerActions = (
    <div className="flex items-center gap-2">
      <ResponsiveActions />
      <PageActions mode="notebook-readonly" currentWorkout={{ name: effectiveTitle, content: effectiveContent }} index={[]} />
    </div>
  )

  const resolvedOwnershipBar = (isNotebookItem || ownershipMeta.isNonOwned) ? (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <OwnershipPillBadge presentation={ownershipMeta} />
        <span className="text-xs text-muted-foreground">{ownershipMeta.guidanceCopy}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {firstWodBlock && (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleStartWorkout(firstWodBlock)}
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
    </div>
  ) : null

  if (loading || resolvingNote || remoteLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground" role="status">
        {remoteLoading ? 'Loading workout from feed…' : 'Loading…'}
      </div>
    )
  }

  if (remoteError || (isNotebookItem && !effectiveContent.trim())) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
        <p className="text-sm font-semibold text-foreground">Workout unavailable</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {remoteError ?? `Could not find "${name}" in notebook "${category}".`}
        </p>
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
  }

  return (
    <>
      <JournalPageShell
        title={effectiveTitle}
        actions={headerActions}
        editor={
          /* Reconfigure read-only state without discarding cursor or undo history. */
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <NoteContextNav data={contextData} up={ownership?.up} peekMode onPeekEntity={openPeek} />
            {resolvedOwnershipBar}
            <NoteEditor
              key={canonicalNoteId}
              value={effectiveContent}
              onChange={isNotebookItem ? () => {} : onChange}
              {...(!isNotebookItem && usePopup
                ? {
                    onCursorPositionChange: onLineChange,
                    onBlur,
                    onIdentityChange: (snapshot) =>
                      onIdentityChange({
                        rawContent: snapshot.rawContent,
                        noteBlocks: snapshot.blocks,
                        sourceRevision: snapshot.sourceRevision,
                      }),
                    onSaved,
                    beforeRun: async () => {
                      await flush()
                      return committedSourceRevision()
                    },
                    onSaveRequest: flush,
                    onCommitChange: flush,
                  }
                : {})}
              noteId={canonicalNoteId}
              noteBlocks={effectiveBlocks}
              sourceRevision={effectiveRevision}
              readonly={true}
              enableInlineRuntime={usePopup}
              commands={commands}
              onViewCreated={onViewCreated}
              theme={theme}
              showLineNumbers={false}
              onBlocksChange={setScriptBlocks}
              onPeekEntity={openPeek}
              onClosePeek={closePeek}
            />
            {error ? <p role="alert">Save failed. {error instanceof Error ? error.message : String(error)} Your draft is kept.</p> : null}
            <WorkoutSessionsList sessions={sessions} />
          </div>
        }
      />

      <ForkToMyNotesDialog
        open={forkOpen}
        onOpenChange={setForkOpen}
        sourceNoteId={runTargetId}
        sourceTitle={effectiveTitle}
        storageInstance={storageService.storage}
        resolveRemoteWorkoutFn={buildRemoteResolver()}
        fallbackRemote={!storedNote && effectiveContent ? {
          title: effectiveTitle,
          content: effectiveContent,
          feedId: feedParam,
          notebookSlug: category,
        } : undefined}
        onForked={(forked) => { void navigate(`${notePath(forked.id)}?edit=1`) }}
      />

      {/* Date picker modal for "Plan" command on collection WOD blocks */}
      {pendingScheduleBlock && (
        <EditorDialog
          open
          onClose={() => setPendingScheduleBlock(null)}
          title={`Schedule ${name}`}
        >
            <CalendarCard
              selectedDate={null}
              onDateSelect={(date) => {
                if (date) void handleScheduleBlock(pendingScheduleBlock, date)
                setPendingScheduleBlock(null)
              }}
            />
        </EditorDialog>
      )}
    </>
  )
}
