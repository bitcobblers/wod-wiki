/**
 * PlaygroundNotePage — /playground/:id
 *
 * Loads a personal note page by ID from IndexedDB, renders it in the editor,
 * and places the cursor at the $CURSOR token position on first mount.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { v7 as uuidv7 } from 'uuid'
import { NoteEditor } from '@/components/organisms/editor/NoteEditor'
import { WorkbenchSessionProvider } from '@/stores/workbenchSessionStore'
import { notePersistence } from '@/services/persistence'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { JournalPageShell } from '@/panels/page-shells'
import type { WidgetRegistry } from '@/components/Editor/widgets/types'
import { PlaygroundRunTipWidget } from '../components/molecules/PlaygroundRunTipWidget'
import {
  createAttentionWidgetWrapper,
  createCodeExampleWidgetWrapper,
  createSyntaxGroupWidgetWrapper,
} from '../components/widgets/widgetWrappers'
import type { ScriptBlock } from '@/components/Editor/types'
import type { Session } from '@/types/storage'
import { usePlaygroundContent } from '../hooks/usePlaygroundContent'
import { pageId } from '../services/playgroundContent'
import { storageService } from '@/services/storage'
import { pendingRuntimes } from '../runtimeStore'
import { noteByIdPath, runPath, sessionDetailPath } from '../lib/routes'
import { formatDurationSmart } from '@/lib/formatTime'
import { formatDateShort } from '@/lib/dateFormat'
import { PageActions } from './shared/PageActions'
import { useNotePageNav } from './shared/useNotePageNav'
import {
  NoteContextNav,
  noteOwnership,
  useNoteContextLinks,
} from './shared/noteContextLinks'
import { useScriptBlockCommands } from '../hooks/useScriptBlockCommands'
import { shareBlock } from '../services/openInPlayground'
import { movePlaygroundToJournal } from '../services/createPlaygroundPage'
import { createJournalNoteFromWorkout } from '../services/journalWorkout'
import { CalendarCard } from '@/components/atoms/CalendarCard'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/atoms/primitives/toast'
import { DEFAULT_PLAYGROUND_CONTENT } from '../templates/defaultPlaygroundContent'
import { formatPlaygroundPageTitle } from '@/lib/playgroundDisplay'
import { localDateKey } from '../views/queriable-list/JournalDateScroll'
import { useOnboardingEvents } from '../hooks/useOnboardingEvents'
import { CalendarPlus } from 'lucide-react'
import { ResponsiveActions } from '../nav/ResponsiveActions'
import { provenanceLink, type ContextNoteLink } from './shared/noteContextLinks'

const contentProvider = new IndexedDBContentProvider()

export interface PlaygroundNotePageProps {
  theme: string
  onViewCreated?: (view: EditorView) => void
  onScrollToSection?: (id: string) => void
  onSearch?: () => void
}

export function PlaygroundNotePage({
  theme,
  onViewCreated,
  onScrollToSection,
  onSearch,
}: PlaygroundNotePageProps) {
  const { id } = useParams<{ id: string }>()
  const pageName = id ?? 'playground'
  // Route composite — the /playground/:id lookup key. Results and runtimes
  // join on the canonical Note UUID instead: entryId from the loaded page
  // (V8 notes), with the composite as the legacy fallback.
  const noteId = pageId('playground', pageName)
  const pageTitle = useMemo(() => (id ? formatPlaygroundPageTitle(id) : 'Playground'), [id])
  const navigate = useNavigate()
  const { content, loading, entryId, onChange: persistOnChange, onLineChange, onBlur, resetToOriginal } = usePlaygroundContent({
    category: 'playground',
    name: pageName,
    mdContent: DEFAULT_PLAYGROUND_CONTENT.content,
  })
  const runtimeNoteId = entryId ?? noteId

  // Onboarding (ADR-0010, Goal Gradient) — see useOnboardingEvents for the
  // typed event API. The hook owns the step-string mapping; the page
  // calls semantic handlers (onEditNote / onRunWorkout / onLogEffort)
  // that wrap the corresponding mark(step) calls.
  const { onEditNote, onRunWorkout, onLogEffort } = useOnboardingEvents()
  const onChange = useCallback(
    (value: string) => {
      onEditNote()
      persistOnChange(value)
    },
    [onEditNote, persistOnChange],
  )

  const [results, setResults] = useState<Session[]>([])

  const refreshResults = useCallback(() => {
    storageService.getSessionsForNote(runtimeNoteId)
      .then(results => setResults(results))
      .catch(() => {})
  }, [runtimeNoteId])

  useEffect(() => {
    refreshResults()
  }, [refreshResults])

  // Place cursor at the $CURSOR token position on first mount.
  const cursorPlaced = useRef(false)
  const handleInternalViewCreated = useCallback((view: EditorView) => {
    onViewCreated?.(view)
    if (cursorPlaced.current) return
    cursorPlaced.current = true
    const offset = Math.min(DEFAULT_PLAYGROUND_CONTENT.cursorOffset, view.state.doc.length)
    view.dispatch({ selection: EditorSelection.cursor(offset) })
  }, [onViewCreated])

  const handleStartWorkout = useCallback(
    (block: ScriptBlock) => {
      onRunWorkout()
      const runtimeId = uuidv7()
      pendingRuntimes.set(runtimeId, {
        block,
        noteId: runtimeNoteId,
        origin: 'playground',
        returnTo: `/playground/${encodeURIComponent(pageName)}`,
      })
      navigate(runPath(runtimeId))
    },
    [runtimeNoteId, pageName, navigate, onRunWorkout],
  )

  const handleAddToToday = useCallback(
    async (block: ScriptBlock) => {
      try {
        onLogEffort()
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: pageTitle,
          category: 'playground',
          sourceNoteLabel: pageTitle,
          sourceNotePath: `/playground/${pageName}`,
          wodContent: block.content,
        })
        const today = localDateKey(new Date())
        toast({
          title: 'Added to journal',
          description: journalNote.journalDate === today ? "Added to today's journal" : `Added to ${journalNote.journalDate}`,
          action: (
            <ToastAction altText="Open journal" onClick={() => navigate(noteByIdPath(journalNote.id))}>
              Open
            </ToastAction>
          ),
        })
      } catch {
        toast({ title: 'Error', description: 'Could not add to journal', variant: 'destructive' })
      }
    },
    [pageTitle, pageName, navigate, onLogEffort],
  )

  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null)

  // Move the whole playground entry onto a journal date — the SAME Note
  // (UUID, blocks, results, attachments) joins the journal page; nothing is
  // copied, so no duplicate playground entry remains.
  const [moveToJournalOpen, setMoveToJournalOpen] = useState(false)

  const handleMoveToJournal = useCallback(
    async (date: Date) => {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      const dateKey = `${y}-${m}-${d}`
      try {
        await movePlaygroundToJournal(runtimeNoteId, dateKey)
        toast({
          title: 'Moved to journal',
          description: `This playground now lives on ${dateKey}.`,
          action: (
            <ToastAction altText="Open journal" onClick={() => navigate(noteByIdPath(runtimeNoteId))}>
              Open
            </ToastAction>
          ),
        })
        navigate(noteByIdPath(runtimeNoteId))
      } catch {
        toast({ title: 'Error', description: 'Could not move to journal', variant: 'destructive' })
      }
    },
    [runtimeNoteId, navigate],
  )

  const handleScheduleBlock = useCallback(
    async (block: ScriptBlock, date: Date) => {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      const dateKey = `${y}-${m}-${d}`
      try {
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: pageTitle,
          category: 'playground',
          sourceNoteLabel: pageTitle,
          sourceNotePath: `/playground/${pageName}`,
          wodContent: block.content,
          date: date,
        })
        navigate(`/journal?s=${dateKey}`)
        toast({
          title: 'Scheduled',
          description: `Added to journal for ${dateKey}`,
          action: (
            <ToastAction altText="Open journal" onClick={() => navigate(noteByIdPath(journalNote.id))}>
              Open
            </ToastAction>
          ),
        })
      } catch {
        toast({ title: 'Error', description: 'Could not schedule workout', variant: 'destructive' })
      }
    },
    [pageTitle, pageName, navigate],
  )

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([])
  const index = useNotePageNav({ content, scriptBlocks, onStartWorkout: handleStartWorkout, results })

  // Contextual links: back to the Playgrounds list + efforts/related. The
  // runtime note is UUID-keyed; ownership derives the /playground/<name>
  // stamp journal copies carry.
  const ownership = useMemo(() => noteOwnership({ id: runtimeNoteId, type: 'playground' }), [runtimeNoteId])
  const contextData = useNoteContextLinks({ noteId: runtimeNoteId, stamps: ownership.stamps })

  // Spawn provenance — "Open in Playground" stamps the source page path into
  // sourceId (path-like); the bare 'playground' intake marker renders nothing.
  const [spawnLink, setSpawnLink] = useState<{ noteId: string; link: ContextNoteLink } | null>(null)
  useEffect(() => {
    let cancelled = false
    storageService.getNote(runtimeNoteId).then((note) => {
      if (cancelled || !note?.sourceId) return
      const stamped = provenanceLink(note.sourceId)
      if (stamped) setSpawnLink({ noteId: runtimeNoteId, link: stamped })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [runtimeNoteId])

  // The page header is hidden below lg — ResponsiveActions relocates the
  // primary action to the shared thumb dock and the rest to its overflow
  // sheet on mobile; on desktop (and standalone) everything renders inline.
  // Single declaration per breakpoint, no portal duplication.
  const headerActions = (
    <ResponsiveActions label="Playground actions">
      <button
        type="button"
        onClick={() => setMoveToJournalOpen(true)}
        title="Move this playground to a journal date"
        className="inline-flex items-center gap-1 rounded-pill border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent"
      >
        <CalendarPlus className="size-3.5" aria-hidden="true" />
        Move to journal
      </button>
      <PageActions
        mode="playground"
        currentWorkout={{ name: pageTitle, content }}
        index={index}
        onReset={resetToOriginal}
      />
    </ResponsiveActions>
  )

  const commands = useScriptBlockCommands('playground', {
    onPlay: handleStartWorkout,
    onShare: shareBlock,
    onAddToToday: handleAddToToday,
    onSchedule: setPendingScheduleBlock,
  })

  const handleAttentionAction = useCallback(
    (action: 'scroll-to-workout' | 'open-search') => {
      if (action === 'scroll-to-workout') {
        const firstWorkout = index.find(item => item.type === 'time' || item.type === 'log')
        if (firstWorkout) {
          onScrollToSection?.(firstWorkout.id)
        }
      } else if (action === 'open-search') {
        onSearch?.()
      }
    },
    [index, onScrollToSection, onSearch],
  )

  const handleCodeExampleRun = useCallback(
    (script: string) => {
      // Parse the script as a time block and start workout
      const exampleBlock: ScriptBlock = {
        id: 'code-example-block',
        line: 0,
        endLine: script.split('\n').length,
        content: script,
      }
      handleStartWorkout(exampleBlock)
    },
    [handleStartWorkout],
  )

  const handleOpenDocs = useCallback(
    (docsPath: string) => {
      // Navigate to docs page
      if (docsPath.startsWith('/')) {
        window.open(docsPath, '_blank')
      } else {
        navigate(docsPath)
      }
    },
    [navigate],
  )

  const handleButtonAction = useCallback(
    (action: string, params: Record<string, string>) => {
      if (action === 'route' && params['route']) {
        navigate(params['route'])
      } else if (action === 'start-workout') {
        // Start the first available workout block
        const firstBlock = scriptBlocks[0]
        if (firstBlock) handleStartWorkout(firstBlock)
      } else if (action === 'new-note') {
        navigate('/playground')
      }
    },
    [navigate, scriptBlocks, handleStartWorkout],
  )

  const widgetComponents: WidgetRegistry = useMemo(
    () => new Map([
      ['playground-run-tip', PlaygroundRunTipWidget],
      ['attention', createAttentionWidgetWrapper(handleAttentionAction)],
      ['code-example', createCodeExampleWidgetWrapper(theme === 'dark', handleCodeExampleRun)],
      ['syntax-group', createSyntaxGroupWidgetWrapper(handleOpenDocs)],
    ]),
    [handleAttentionAction, handleCodeExampleRun, handleOpenDocs, theme],
  )

  useEffect(() => {
    document.title = `Wod.Wiki - ${pageTitle}`
  }, [pageTitle])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400">
        Loading…
      </div>
    )
  }

  return (
    <>
      {/* The provider wires the persistence port the editor's block companions
        use to load results — without it playground notes never display them. */}
      <WorkbenchSessionProvider notePersistence={notePersistence} provider={contentProvider}>
      <JournalPageShell
        title={pageTitle}
        actions={headerActions}
        editor={
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <NoteContextNav data={contextData} up={ownership.up} source={spawnLink?.noteId === runtimeNoteId ? spawnLink.link : null} />
            <NoteEditor
              value={content}
              onChange={onChange}
              onCursorPositionChange={onLineChange}
              onBlur={onBlur}
              noteId={runtimeNoteId}
              commands={commands}
              enableInlineRuntime={false}
              onViewCreated={handleInternalViewCreated}
              theme={theme}
              showLineNumbers={false}
              onBlocksChange={setScriptBlocks}
              onButtonAction={handleButtonAction}
              widgetComponents={widgetComponents}
            />
            {results.length > 0 && (
              <section aria-label="Workout results">
                <h2 className="text-sm font-semibold text-muted-foreground">Results</h2>
                <ul className="mt-1 divide-y divide-border/60">
                  {results.map((result) => (
                    <li key={result.id}>
                      <Link
                        to={sessionDetailPath(result.id)}
                        className="flex items-center gap-2 py-1.5 text-sm hover:underline"
                      >
                        <span className="font-mono">{formatDurationSmart(result.duration)}</span>
                        <span className="text-muted-foreground">
                          {formatDateShort(new Date(result.createdAt))}
                        </span>
                        {!result.completed && (
                          <span className="text-muted-foreground/70">partial</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        }
      />
      </WorkbenchSessionProvider>
      {pendingScheduleBlock && (
        <EditorDialog
          open
          onClose={() => setPendingScheduleBlock(null)}
          title="Schedule workout"
        >
            <CalendarCard
              selectedDate={null}
              onDateSelect={(date) => {
                handleScheduleBlock(pendingScheduleBlock, date)
                setPendingScheduleBlock(null)
              }}
            />
        </EditorDialog>
      )}
      {moveToJournalOpen && (
        <EditorDialog
          open
          onClose={() => setMoveToJournalOpen(false)}
          title="Move playground to Journal"
          description="Choose a date. This keeps the workout's existing results and attachments."
        >
            <CalendarCard
              selectedDate={null}
              onDateSelect={(date) => {
                setMoveToJournalOpen(false)
                void handleMoveToJournal(date)
              }}
            />
        </EditorDialog>
      )}
    </>
  )
}
