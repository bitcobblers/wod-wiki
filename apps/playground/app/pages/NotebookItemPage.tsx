/**
 * NotebookItemPage — /notebook/:slug/:itemDate/:item
 *
 * Renders a single dated notebook item in the JournalPageShell.
 * Content is read-only at source (build-time), but local edits are
 * saved to playgroundContent under `notebook/{slug}/{date}/{item}` so
 * scratch edits are preserved across sessions.
 * Action bar exposes:
 *   - Add to Today   → appends the wod block to today's journal
 *   - Plan for date  → appends to a specific date's journal (calendar picker)
 *   - Run Now        → adopts to today's journal + navigates to start timer
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';
import { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { JournalPageShell } from '@/panels/page-shells';
import type { ScriptBlock } from '@/components/Editor/types';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { buildScriptNotebooks, findNotebookItem } from '@/repositories/script-notebooks';
import { useSeedContent } from '@/services/content/seedContent';
import { usePlaygroundContent } from '../hooks/usePlaygroundContent';
import { createJournalNoteFromWorkout } from '../services/journalWorkout';
import { pendingRuntimes } from '../runtimeStore';
import { runPath, dayAutoStartPath, dayPath } from '../lib/routes';
import { useNotePageNav } from './shared/useNotePageNav';
import {
  NoteContextNav,
  noteOwnership,
  useNoteContextLinks,
} from './shared/noteContextLinks';
import { useScriptBlockCommands } from '../hooks/useScriptBlockCommands';
import { shareBlock, openBlockInPlayground } from '../services/openInPlayground';
import { PageActions } from './shared/PageActions';
import { ResponsiveActions } from '../nav/ResponsiveActions';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/atoms/primitives/toast';
import { localDateKey } from '@/lib/dateFormat';

export interface NotebookItemPageProps {
  slug: string;
  itemDate: string;
  item: string;
  theme: string;
  onViewCreated?: (view: EditorView) => void;
  onScrollToSection?: (id: string) => void;
}

export function NotebookItemPage({
  slug,
  itemDate,
  item,
  theme,
  onViewCreated,
}: NotebookItemPageProps) {
  const navigate = useNavigate();

  const files = useSeedContent();
  const notebookItem = useMemo(() => {
    if (!files) return undefined;
    return findNotebookItem(buildScriptNotebooks(files).find((n) => n.id === slug), itemDate, item);
  }, [files, slug, itemDate, item]);
  const playgroundCategory = `notebook/${slug}/${itemDate}`;
  // Store local edits under a deterministic key in playgroundContent.
  // The notebook item's canonical content is the mdContent fallback.
  // seedOnMount: false — viewing a notebook item is read-only against the
  // local index; seeding created undated ghost notes in the library (#856).
  const { content, noteBlocks, sourceRevision, onIdentityChange, onSaved, onChange, onLineChange, onBlur, flush } = usePlaygroundContent({
    category: playgroundCategory,
    name: item,
    mdContent: notebookItem?.content ?? `# ${item}\n\n*Notebook item not found.*\n`,
    seedOnMount: false,
  });

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([]);
  const noteId = `notebook/${slug}/${itemDate}/${item}`;

  const itemPath = `/notebook/${encodeURIComponent(slug)}/${itemDate}/${encodeURIComponent(item)}`;

  const handleStartWorkout = useCallback(
    async (block: ScriptBlock) => {
      try {
        const runtimeId = uuidv7();
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: notebookItem?.name ?? item,
          category: slug,
          sourceNoteLabel: slug,
          sourceNotePath: itemPath,
          wodContent: block.content,
        });
        const occurrence = Object.values(journalNote.blocks ?? {}).find(candidate => candidate.kind === 'wod');
        if (!occurrence) throw new Error('The saved journal workout is unavailable.');
        pendingRuntimes.set(runtimeId, { block: { ...block, id: occurrence.id }, noteId: journalNote.id });
        navigate(dayAutoStartPath(journalNote.journalDate ?? '', runtimeId));
      } catch (error) {
        toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
      }
    },
    [slug, item, itemPath, notebookItem, navigate],
  );

  const handleAddToToday = useCallback(async (block: ScriptBlock) => {
    try {
      const journalNote = await createJournalNoteFromWorkout({
        workoutName: notebookItem?.name ?? item,
        category: slug,
        sourceNoteLabel: slug,
        sourceNotePath: itemPath,
        wodContent: block.content,
      });
      const today = localDateKey(new Date());
      toast({
        title: 'Added to journal',
        description: journalNote.journalDate === today ? `Added to today's journal` : `Added to ${journalNote.journalDate}`,
        action: (
          <ToastAction altText="Open journal" onClick={() => navigate(dayPath(journalNote.journalDate ?? today))}>
            Open
          </ToastAction>
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Could not add to journal', variant: 'destructive' });
    }
  }, [slug, item, itemPath, notebookItem, navigate]);

  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null);

  const handleScheduleBlock = useCallback(async (block: ScriptBlock, date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    try {
      await createJournalNoteFromWorkout({
        workoutName: notebookItem?.name ?? item,
        category: slug,
        sourceNoteLabel: slug,
        sourceNotePath: itemPath,
        wodContent: block.content,
        date: date,
      });
      navigate(dayPath(dateKey));
      toast({
        title: 'Scheduled',
        description: `Added to journal for ${dateKey}`,
        action: (
          <ToastAction altText="Open journal" onClick={() => navigate(dayPath(dateKey))}>
            Open
          </ToastAction>
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Could not schedule workout', variant: 'destructive' });
    }
  }, [slug, item, itemPath, notebookItem, navigate]);

  const index = useNotePageNav({
    content,
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
  });

  // Canonical corpus id (`notebook/<slug>/<date>/<item>`) drives ownership
  // and the block indexes. Notebook runs stamp the listing path as
  // sourceNote, so per-item journal-copy backlinks don't exist in the data.
  const corpusId = `notebook/${slug}/${itemDate}/${item}`;
  const ownership = useMemo(() => noteOwnership({ id: corpusId, type: 'note' }), [corpusId]);
  const contextData = useNoteContextLinks({ noteId: corpusId, stamps: ownership.stamps });

  const commands = useScriptBlockCommands('notebook-readonly', {
    onPlay: handleStartWorkout,
    onShare: shareBlock,
    onAddToToday: handleAddToToday,
    onSchedule: setPendingScheduleBlock,
    onOpenInPlayground: (block) => openBlockInPlayground(block, navigate),
  });

  return (
    <>
      <JournalPageShell
        title={notebookItem?.name ?? item}
        actions={
          <ResponsiveActions label="Workout actions">
          <PageActions
            mode="notebook-readonly"
            currentWorkout={{ name: notebookItem?.name ?? item, content }}
            index={index}
          />
          </ResponsiveActions>
        }
        editor={
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <NoteContextNav data={contextData} up={ownership.up} />
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
              onSaveRequest={flush}
              onCommitChange={flush}
              commands={commands}
              enableInlineRuntime={false}
              onViewCreated={onViewCreated}
              theme={theme}
              showLineNumbers={false}
              onBlocksChange={setScriptBlocks}
            />
          </div>
        }
      />
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
    </>
  );
}
