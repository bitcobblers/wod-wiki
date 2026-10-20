/**
 * FeedItemPage — /feeds/:feedSlug/:feedDate/:feedItem
 *
 * Renders a single feed workout in the JournalPageShell.
 * Content is read-only at source (build-time), but local edits are
 * saved to playgroundContent under `feed/{slug}/{date}/{item}` so scratch
 * edits are preserved across sessions.
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
import { buildScriptFeeds } from '@/repositories/script-feeds';
import { useSeedContent } from '@/services/content/seedContent';
import { usePlaygroundContent } from '../hooks/usePlaygroundContent';
import { createJournalNoteFromWorkout } from '../services/journalWorkout';
import { pendingRuntimes } from '../runtimeStore';
import { runPath, journalEntryAutoStartPath, journalEntryPath } from '../lib/routes';
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
import { localDateKey } from '../views/queriable-list/JournalDateScroll';

export interface FeedItemPageProps {
  feedSlug: string;
  feedDate: string;
  feedItem: string;
  theme: string;
  onViewCreated?: (view: EditorView) => void;
  onScrollToSection?: (id: string) => void;
}

export function FeedItemPage({
  feedSlug,
  feedDate,
  feedItem,
  theme,
  onViewCreated,
}: FeedItemPageProps) {
  const navigate = useNavigate();

  const files = useSeedContent();
  const { item, feed } = useMemo(() => {
    if (!files) return { item: undefined, feed: undefined };
    const feeds = buildScriptFeeds(files);
    const feed = feeds.find((f) => f.id === feedSlug);
    const item = feed?.items.find((i) => i.feedDate === feedDate && i.id === feedItem);
    return { item, feed };
  }, [files, feedSlug, feedDate, feedItem]);
  const playgroundCategory = `feed/${feedSlug}/${feedDate}`;
  // Store local edits under a deterministic key in playgroundContent.
  // The feed item's canonical content is the mdContent fallback.
  // seedOnMount: false — viewing a feed item is read-only against the local
  // index; seeding created undated ghost notes in the library (#856).
  const { content, noteBlocks, sourceRevision, onIdentityChange, onSaved, onChange, onLineChange, onBlur, flush } = usePlaygroundContent({
    category: playgroundCategory,
    name: feedItem,
    mdContent: item?.content ?? `# ${feedItem}\n\n*Feed item not found.*\n`,
    seedOnMount: false,
  });

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([]);
  const noteId = `feed/${feedSlug}/${feedDate}/${feedItem}`;

  const handleStartWorkout = useCallback(
    async (block: ScriptBlock) => {
      try {
        const runtimeId = uuidv7();
        const journalNote = await createJournalNoteFromWorkout({
          workoutName: item?.name ?? feedItem,
          category: feedSlug,
          sourceNoteLabel: feed?.name,
          sourceNotePath: `/feeds/${encodeURIComponent(feedSlug)}/${feedDate}/${encodeURIComponent(feedItem)}`,
          wodContent: block.content,
        });
        const occurrence = Object.values(journalNote.blocks ?? {}).find(candidate => candidate.kind === 'wod');
        if (!occurrence) throw new Error('The saved journal workout is unavailable.');
        pendingRuntimes.set(runtimeId, { block: { ...block, id: occurrence.id }, noteId: journalNote.id });
        navigate(journalEntryAutoStartPath(journalNote.journalDate ?? '', runtimeId));
      } catch (error) {
        toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
      }
    },
    [feed, feedDate, feedItem, feedSlug, item, navigate, noteId],
  );

  const handleAddToToday = useCallback(async (block: ScriptBlock) => {
    try {
      const journalNote = await createJournalNoteFromWorkout({
        workoutName: item?.name ?? feedItem,
        category: feedSlug,
        sourceNoteLabel: feed?.name,
        sourceNotePath: `/feeds/${encodeURIComponent(feedSlug)}/${feedDate}/${encodeURIComponent(feedItem)}`,
        wodContent: block.content,
      });
      const today = localDateKey(new Date());
      toast({
        title: 'Added to journal',
        description: journalNote.journalDate === today ? `Added to today's journal` : `Added to ${journalNote.journalDate}`,
        action: (
          <ToastAction altText="Open journal" onClick={() => navigate(journalEntryPath(journalNote.journalDate ?? today))}>
            Open
          </ToastAction>
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Could not add to journal', variant: 'destructive' });
    }
  }, [feed, feedDate, feedItem, feedSlug, item, navigate]);

  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null);

  const handleScheduleBlock = useCallback(async (block: ScriptBlock, date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    try {
      await createJournalNoteFromWorkout({
        workoutName: item?.name ?? feedItem,
        category: feedSlug,
        sourceNoteLabel: feed?.name,
        sourceNotePath: `/feeds/${encodeURIComponent(feedSlug)}/${feedDate}/${encodeURIComponent(feedItem)}`,
        wodContent: block.content,
        date: date,
      });
      navigate(journalEntryPath(dateKey));
      toast({
        title: 'Scheduled',
        description: `Added to journal for ${dateKey}`,
        action: (
          <ToastAction altText="Open journal" onClick={() => navigate(journalEntryPath(dateKey))}>
            Open
          </ToastAction>
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Could not schedule workout', variant: 'destructive' });
    }
  }, [feed, feedDate, feedItem, feedSlug, item, navigate]);

  const index = useNotePageNav({
    content,
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
  });

  // Canonical corpus id (`feeds/<slug>/<date>/<item>`) drives ownership and
  // the block indexes. Feed runs stamp the FEED listing path as sourceNote,
  // so per-item journal-copy backlinks don't exist in the data.
  const corpusId = `feeds/${feedSlug}/${feedDate}/${feedItem}`;
  const ownership = useMemo(() => noteOwnership({ id: corpusId, type: 'collection' }), [corpusId]);
  const contextData = useNoteContextLinks({ noteId: corpusId, stamps: ownership.stamps });

  const commands = useScriptBlockCommands('collection-readonly', {
    onPlay: handleStartWorkout,
    onShare: shareBlock,
    onAddToToday: handleAddToToday,
    onSchedule: setPendingScheduleBlock,
    onOpenInPlayground: (block) => openBlockInPlayground(block, navigate),
  });

  return (
    <>
      <JournalPageShell
        title={item?.name ?? feedItem}
        actions={
          <ResponsiveActions label="Workout actions">
          <PageActions
            mode="collection-readonly"
            currentWorkout={{ name: item?.name ?? feedItem, content }}
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
