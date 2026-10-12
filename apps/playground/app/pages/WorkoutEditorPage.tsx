/**
 * WorkoutEditorPage — /collections/:collection/:workout
 *
 * Wrapper that loads workout content via IndexedDB (or falls back to the
 * bundled MD file). Keeps ScriptBlock IDs stable across page loads so results
 * stay linked.
 */

import { useState, useMemo, useCallback } from 'react'
import { formatDateHeader } from '@/lib/dateFormat'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/atoms/primitives/toast'
import { EditorView } from '@codemirror/view'
import { v7 as uuidv7 } from 'uuid'
import { NoteEditor } from '@/components/organisms/editor/NoteEditor'
import { captureRun } from '@/services/runCapture';
import { JournalPageShell } from '@/panels/page-shells'
import type { ScriptBlock } from '@/components/Editor/types'
import { CalendarCard } from '@/components/atoms/CalendarCard'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import { usePlaygroundContent } from '../hooks/usePlaygroundContent'
import { pageId } from '../services/playgroundContent'
import { pendingRuntimes } from '../runtimeStore'
import { noteByIdPath, runPath, workoutPath, journalEntryAutoStartPath } from '../lib/routes'
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
import { ResponsiveActions } from '../nav/ResponsiveActions'
import { Button } from '@/components/atoms/primitives/button'
import {
  INLINE_RUNTIME_CATEGORIES,
  NON_COLLECTION_CATEGORIES,
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
  const isCollection = !NON_COLLECTION_CATEGORIES.has(category)
  const noteId = pageId(category, name)
  const navigate = useNavigate()
  // seedOnMount: collections are read-only bundled content — viewing one
  // must not create an undated ghost note in the library (#856). Journal
  // categories keep the seed (navigate-to-today creates the day's note).
  const { content, loading, entryId, noteBlocks, sourceRevision, onIdentityChange, onSaved, error, onChange, onLineChange, onBlur, flush, committedSourceRevision } = usePlaygroundContent({ category, name, mdContent, seedOnMount: !isCollection })
  const sourceNote = useMemo(() => {
    if (!isCollection) return null

    return {
      label: `${category}-${name}`,
      path: workoutPath(category, name),
    }
  }, [category, isCollection, name])

  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null)

  const handleStartWorkout = useCallback(
    async (block: ScriptBlock) => {
      const runtimeId = uuidv7()
      // For syntax/inline categories keep the original popup behaviour.
      if (usePopup) {
        try {
          await flush();
          const captured = await captureRun({ noteId: entryId ?? noteId, rawContent: content, blocks: noteBlocks, expectedSourceRevision: committedSourceRevision(), metadata: { title: name }, noteType: 'playground' }, block, runtimeId);
          onSaved({ rawContent: captured.note.rawContent, blocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision });
          pendingRuntimes.set(runtimeId, { block: captured.block, noteId: captured.session.noteId, captured });
          navigate(runPath(runtimeId));
        } catch (error) {
          toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
        }
        return
      }
      // Append the wod block to today's journal note and navigate there.
      try {
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: name,
          category,
          sourceNoteLabel: sourceNote?.label,
          sourceNotePath: sourceNote?.path,
          wodContent: block.content,
        })
        const occurrence = Object.values(journalNote.blocks ?? {}).find(candidate => candidate.kind === 'wod');
        if (!occurrence) throw new Error('The saved journal workout is unavailable.');
        pendingRuntimes.set(runtimeId, { block: { ...block, id: occurrence.id }, noteId: journalNote.id })
        navigate(journalEntryAutoStartPath(journalNote.journalDate ?? '', runtimeId))
      } catch (error) {
        toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
      }
    },
    [usePopup, noteId, entryId, name, category, sourceNote, navigate, content, noteBlocks, flush, committedSourceRevision, onSaved],
  )

  const handleScheduleBlock = useCallback(
    async (block: ScriptBlock, date: Date) => {
      const dateLabel = formatDateHeader(date);
      let journalNoteId: string
      let journalDate: string
      try {
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: name,
          category,
          sourceNoteLabel: sourceNote?.label,
          sourceNotePath: sourceNote?.path,
          wodContent: block.content,
          date,
          wrapInWod: true,
        })
        journalNoteId = journalNote.id
        journalDate = journalNote.journalDate ?? ''
      } catch {
        toast({
          variant: 'destructive',
          title: 'Could not save workout',
          description: `Failed to add "${name}" to ${dateLabel}. Please try again.`,
        })
        return
      }
      navigate(`/journal?s=${journalDate}`)
      const journalRoute = noteByIdPath(journalNoteId)
      toast({
        title: `Added to ${dateLabel}`,
        description: `"${name}" was added to your journal.`,
        action: (
          <ToastAction altText="View journal entry" onClick={() => navigate(journalRoute)}>
            View Note
          </ToastAction>
        ),
        duration: 7000,
      })
    },
    [name, category, sourceNote, navigate],
  )

  const commands = useScriptBlockCommands('collection-readonly', {
    onPlay: handleStartWorkout,
    onShare: shareBlock,
    onAddToToday: hidePlanningCommands ? undefined : (block) => handleScheduleBlock(block, new Date()),
    onSchedule: hidePlanningCommands ? undefined : setPendingScheduleBlock,
    onOpenInPlayground: (block) => openBlockInPlayground(block, navigate),
  })

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([])
  const handleEditNote = useCallback(() => {
    navigate(noteByIdPath(noteId))
  }, [navigate, noteId])
  const index = useNotePageNav({
    content,
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
    onEditNote: isCollection ? handleEditNote : undefined,
  })
  // Contextual links (efforts in script, sibling workouts sharing blocks,
  // journal copies) — only for real collection items, not journal/syntax ids.
  const ownership = useMemo(
    () => (isCollection ? noteOwnership({ id: noteId, type: 'feed' }) : null),
    [isCollection, noteId],
  )
  const contextData = useNoteContextLinks({
    noteId,
    stamps: ownership?.stamps ?? [],
  })
  const headerActions = (
    <ResponsiveActions>
      <PageActions mode="collection-readonly" currentWorkout={{ name: noteId, content }} index={index} />
    </ResponsiveActions>
  )

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400">
        Loading…
      </div>
    )
  }

  return (
    <>
      <JournalPageShell
        title={name}
        actions={headerActions}
        editor={
          /* Reconfigure read-only state without discarding cursor or undo history. */
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <NoteContextNav data={contextData} up={ownership?.up} />
            <NoteEditor
              value={content}
              onChange={onChange}
              onCursorPositionChange={onLineChange}
              onBlur={onBlur}
              noteId={noteId}
              noteBlocks={noteBlocks}
              sourceRevision={sourceRevision}
              onIdentityChange={snapshot => onIdentityChange({ rawContent: snapshot.rawContent, noteBlocks: snapshot.blocks, sourceRevision: snapshot.sourceRevision })}
              onSaved={onSaved}
              beforeRun={async () => { await flush(); return committedSourceRevision(); }}
              readonly={true}
              enableInlineRuntime={usePopup}
              commands={commands}
              onViewCreated={onViewCreated}
              theme={theme}
              showLineNumbers={false}
              onBlocksChange={setScriptBlocks}
            />
            {error ? <p role="alert">Save failed. {error instanceof Error ? error.message : String(error)} Your draft is kept.</p> : null}
          </div>
        }
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
                if (date) handleScheduleBlock(pendingScheduleBlock, date)
                setPendingScheduleBlock(null)
              }}
            />
        </EditorDialog>
      )}
    </>
  )
}
