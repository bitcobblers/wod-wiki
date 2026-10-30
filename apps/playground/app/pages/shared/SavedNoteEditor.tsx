import { useEffect } from 'react';
import { NoteEditor, type NoteEditorProps } from '@/components/organisms/editor/NoteEditor';
import { BlockHistory } from '@/components/organisms/editor/BlockHistory';
import type { HistoryRecord } from '@/types/history';
import { useNoteDraft } from '../../hooks/useNoteDraft';
import type { CapturedRun } from '@/services/runCapture';
import type { ScriptBlock } from '@/components/Editor/types';

export interface SavedNoteEditorProps extends Omit<NoteEditorProps, 'value' | 'onChange' | 'noteBlocks' | 'sourceRevision'> {
  entry: HistoryRecord;
  onChange: (rawContent: string) => void;
  registerRun?: (start: ((block: ScriptBlock, resultId: string) => Promise<CapturedRun>) | null) => void;
}

export function SavedNoteEditor(props: SavedNoteEditorProps) {
  return <SavedNoteEditorInstance key={props.entry.id} {...props} />;
}

function SavedNoteEditorInstance({ entry, onChange, registerRun, ...props }: SavedNoteEditorProps) {
  const draft = useNoteDraft({
    noteId: entry.id,
    initialContent: entry.rawContent,
    initialBlocks: entry.blocks ?? {},
    initialRevision: entry.sourceRevision ?? 0,
    onExternalChange: onChange,
  });

  useEffect(() => {
    registerRun?.(async (block, resultId) => {
      return draft.captureForRun(block, resultId);
    });
    return () => registerRun?.(null);
  }, [registerRun, draft.captureForRun]);

  return (
    <>
      <NoteEditor
        {...props}
        noteId={entry.id}
        value={draft.content}
        noteBlocks={draft.committedBlocks}
        sourceRevision={draft.committedRevision}
        onIdentityChange={draft.onIdentityChange}
        onSaved={draft.accept}
        beforeRun={async () => { await draft.flush(); return draft.committedRevision; }}
        onSaveRequest={draft.flush}
        onChange={draft.onSourceMutate}
        onBlur={draft.onBlur}
        onCursorPositionChange={draft.onLineChange}
        onCommitChange={draft.flush}
      />
      {draft.saveError ? <p role="alert">{draft.saveError}</p> : null}
      <BlockHistory
        noteId={entry.id}
        blocks={draft.committedBlocks}
        sourceRevision={draft.committedRevision}
        onRevert={draft.restoreRevision}
      />
    </>
  );
}
