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
import { queryService, refreshPageSources } from '@/services/queryService'
import { dayPath, notePath, pagePath, runPath } from '../lib/routes'
import { appendWidget, notebookOriginOfItem, resolveEntityScope } from '@bitcobblers/wod-wiki-wql'
import { isNoteEditable, reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core'
import { resolveNotePropertyStack } from '@/app/editor/runtimeTimerModel'
import { WidgetComposerDialog } from '../views/dashboards/WidgetComposerDialog'
import { NotePlacementDialog, type NotePlacementMode } from '../components/organisms/journal/NotePlacementDialog'
import { slugifyRoute } from '../components/organisms/journal/CreateJournalNoteDialog'
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
  const [editingPageSlug, setEditingPageSlug] = useState(false)
  const [pageSlugInput, setPageSlugInput] = useState('')
  const [savingPageSlug, setSavingPageSlug] = useState(false)
  const [copied, setCopied] = useState(false)
  const [widgetComposerOpen, setWidgetComposerOpen] = useState(false)
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

  const noteScope = useMemo(
    () => (entry ? resolveEntityScope({ noteId: entry.id, label: entry.title, rawContent: draft.content }) : null),
    [entry, draft.content],
  );
  const stackedWidgets = useMemo(
    () => (entry ? resolveNotePropertyStack(draft.content, { noteId: entry.id }).dashboardWidgets : []),
    [entry, draft.content],
  );

  useNotePageNav({
    content: entry?.rawContent ?? '',
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
    results,
    helpfulActions: entry
      ? [
          ...(!isReadOnly
            ? [
                {
                  id: 'upgrade-to-page',
                  label: entry.slug ? 'Edit page route' : 'Upgrade to Page',
                  onRun: () => {
                    setPageSlugInput(entry.slug || slugifyRoute(entry.title) || `page-${entry.id.slice(0, 8)}`)
                    setEditingPageSlug(true)
                  },
                },
                {
                  id: 'add-widget',
                  label: 'Add widget',
                  onRun: () => setWidgetComposerOpen(true),
                },
              ]
            : []),
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
              {((entry.journalDate && entry.journalDate !== entry.title) || entry.slug || entry.sourceId || !isReadOnly) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
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
                          className="text-[11px] text-muted-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
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
                      className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      + Upgrade to Page
                    </button>
                  ) : null}
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
                    beforeRun={async () => { await draft.flush(); return draft.committedSourceRevision(); }}
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
      </WorkbenchSessionProvider>
    )
  }

  return body
}
