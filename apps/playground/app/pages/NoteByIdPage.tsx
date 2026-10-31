import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { v7 as uuidv7 } from 'uuid'
import { Button } from '@/components/atoms/primitives/button'
import { CalendarCard } from '@/components/atoms/CalendarCard'
import { JournalPageShell } from '@/panels/page-shells'
import { NoteEditor, type EditorIdentitySnapshot } from '@/components/organisms/editor/NoteEditor'
import { BlockHistory, revertBlock } from '@/components/organisms/editor/BlockHistory'
import { WorkbenchSessionProvider } from '@/stores/workbenchSessionStore';
import { useNoteDraft } from '../hooks/useNoteDraft'
import { useNoteL1Zone } from '../nav/NavContext'
import { notePersistence } from '@/services/persistence'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { storageService } from '@/services/storage'
import { usePageSourcesReady } from '@/hooks/usePageSourcesReady'
import { refreshPageSources } from '@/services/queryService'
import { dayPath, notePath, pagePath, runPath } from '../lib/routes'
import { notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql'
import { isNoteEditable, reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core'
import { NotePlacementDialog, type NotePlacementMode } from '../components/organisms/journal/NotePlacementDialog'
import { localDateKey } from '@/lib/dateFormat'
import type { HistoryRecord } from '@/types/history'
import type { Session } from '@/types/storage'
import { onResultSaved } from '@/services/resultRecorder'
import { pendingRuntimes } from '../runtimeStore'
import { captureRun } from '@/services/runCapture';
import type { ScriptBlock } from '@/components/Editor/types'
import { useNotePageNav } from './shared/useNotePageNav'
import { appendTimerBlock } from './shared/pageUtils'
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
  const [missing, setMissing] = useState(false)
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const isReadOnly = location.pathname.startsWith('/page/')
    || (entry !== null && !isNoteEditable(entry, notebookOriginOfItem(entry)))
  // saveError is managed by useNoteDraft
  const [placement, setPlacement] = useState<NotePlacementMode | null>(null)
  const [copied, setCopied] = useState(false)
  const [sourceEntry, setSourceEntry] = useState<HistoryRecord | null>(null)
  const handleCopyLink = useCallback(() => {
    // ponytail: navigator.clipboard only; fallback textarea omitted for modern browsers.
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [])
  // Page-source datasets (@session/@today) populate before the first child
  // query block evaluates; a new page context re-populates (@today may have
  // changed since the previous page loaded).
  const sourcesReady = usePageSourcesReady()
  useEffect(() => {
    void refreshPageSources().catch(() => {
      // Failure stays on the cached promise — child queries surface it.
    })
  }, [noteId])

  useEffect(() => {
    let cancelled = false
    setEntry(null)
    setMissing(false)
    // saveError handled in draft
    contentProvider
      .getRecord(noteId)
      .then((loaded) => {
        if (cancelled) return
        if (!loaded) {
          setMissing(true)
          return
        }
        setEntry(loaded)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [noteId, searchParams])

  // Resolve the source lineage's title so it can link to the original note.
  const sourceId = entry?.sourceId
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
  const ownership = useMemo(
    () => (entry ? noteOwnership(entry) : { zone: null, up: null, stamps: [] }),
    [entry],
  )
  useNoteL1Zone(ownership.zone)

  // ── Outline (L3) + Run + result badges, wired like the other note pages
  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([])
  const [results, setResults] = useState<Session[]>([])
  const noteKey = entry?.id
  useEffect(() => {
    setResults([])
    setScriptBlocks([])
    if (!noteKey) return
    let cancelled = false
    const refresh = () => {
      storageService.getSessionsForNote(noteKey).then((rows) => {
        if (!cancelled) setResults(rows)
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
  }, [noteKey])

  const draft = useNoteDraft({
    noteId,
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
        const captured = await draft.captureForRun(block, uuidv7());
        pendingRuntimes.set(captured.session.id, { block: captured.block, noteId: entry.id, captured, returnTo: notePath(entry.id) });
        navigate(runPath(captured.session.id));
      } catch {
        // error is tracked and rendered by draft.saveError
      }
    },
    [entry, draft.captureForRun, navigate],
  );

  useNotePageNav({
    content: entry?.rawContent ?? '',
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
    results,
    helpfulActions: entry
      ? [
          { id: 'placements', label: 'Note placements', onRun: () => setPlacement('relationships') },
          { id: 'add-timer', label: 'Add timer', onRun: () => draft.onSourceMutate(appendTimerBlock(entry.rawContent)) },
          { id: 'clone', label: 'Clone', onRun: () => setPlacement('clone') },
          { id: 'copy-link', label: copied ? 'Copied' : 'Copy link', onRun: handleCopyLink },
        ]
      : [],
  });

  const contextLinks = useNoteContextLinks(
    entry ? { noteId: entry.id, stamps: ownership.stamps } : { noteId: '', stamps: [] },
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
  if (missing) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
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
      <WorkbenchSessionProvider notePersistence={notePersistence} provider={contentProvider}>
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
              {((entry.journalDate && entry.journalDate !== entry.title) || entry.slug || entry.sourceId) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {entry.journalDate && entry.journalDate !== entry.title && (
                    <Link to={dayPath(entry.journalDate)} className="underline-offset-2 hover:underline">
                      {entry.journalDate}
                    </Link>
                  )}
                  {entry.slug && (
                    <Link to={pagePath(entry.slug)} className="underline-offset-2 hover:underline">
                      /p/{entry.slug}
                    </Link>
                  )}
                  {entry.sourceId && (
                    <span>
                      Cloned from{' '}
                      {sourceEntry ? (
                        <Link to={notePath(sourceEntry.id)} className="underline-offset-2 hover:underline">
                          {sourceEntry.title || sourceEntry.id}
                        </Link>
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
              )}
              {sourcesReady ? (
                <div className="rounded-lg border border-border bg-card p-4 shadow-sm min-h-[240px] focus-within:border-accent/80 transition-colors">
                  <NoteEditor
                    value={draft.content}
                    onChange={draft.onSourceMutate}
                    onBlur={draft.onBlur}
                    noteId={entry.id}
                    noteBlocks={draft.committedBlocks}
                    sourceRevision={draft.committedRevision}
                    onIdentityChange={draft.onIdentityChange}
                    onSaved={draft.accept}
                    beforeRun={async () => { await draft.flush(); return draft.committedRevision; }}
                    onSaveRequest={draft.flush}
                    onCommitChange={draft.flush}
                    onCursorPositionChange={draft.onLineChange}
                    readonly={isReadOnly}
                    theme={theme}
                    showLineNumbers={false}
                    onCompleteWorkout={handleCompleteWorkout}
                    onBlocksChange={setScriptBlocks}
                    placeholder="Write workout or notes here…"
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center text-zinc-400 text-sm py-8">Loading…</div>
              )}
              <BlockHistory noteId={entry.id} blocks={draft.committedBlocks} sourceRevision={draft.committedRevision} onRevert={isReadOnly ? undefined : draft.restoreRevision} />
              {draft.saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {draft.saveError}
                </p>
              )}
            </div>
          }
        />
        {placement !== null && (
          <NotePlacementDialog
            open
            onOpenChange={(open) => {
              if (!open) setPlacement(null)
            }}
            entry={entry}
            mode={placement}
            provider={contentProvider}
            onSaved={(updated) =>
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
              )
            }
            onCloned={(created) => navigate(`${notePath(created.id)}?edit=1`)}
          />
        )}
      </WorkbenchSessionProvider>
    )
  }

  return body
}
