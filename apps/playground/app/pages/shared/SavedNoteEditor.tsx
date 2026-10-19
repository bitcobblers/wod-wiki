import { useCallback, useEffect, useRef, useState } from 'react';
import { NoteEditor, type EditorIdentitySnapshot, type NoteEditorProps } from '@/components/organisms/editor/NoteEditor';
import { BlockHistory, revertBlock } from '@/components/organisms/editor/BlockHistory';
import { notePersistence } from '@/services/persistence';
import type { HistoryEntry } from '@/types/history';
import { useEditorSave } from '../../hooks/useEditorSave';
import { captureRun, type CapturedRun } from '@/services/runCapture';
import type { ScriptBlock } from '@/components/Editor/types';

export interface SavedNoteEditorProps extends Omit<NoteEditorProps, 'value' | 'onChange' | 'noteBlocks' | 'sourceRevision'> {
  entry: HistoryEntry;
  onChange: (rawContent: string) => void;
  registerRun?: (start: ((block: ScriptBlock, resultId: string) => Promise<CapturedRun>) | null) => void;
}

export function SavedNoteEditor(props: SavedNoteEditorProps) {
  return <SavedNoteEditorInstance key={props.entry.id} {...props} />;
}

function SavedNoteEditorInstance({ entry, onChange, registerRun, ...props }: SavedNoteEditorProps) {
  const [committed, setCommitted] = useState({ blocks: entry.blocks ?? {}, sourceRevision: entry.sourceRevision ?? 0 });
  const [restoredSource, setRestoredSource] = useState<string | null>(null);
  const revisionRef = useRef(committed.sourceRevision);
  const draftRef = useRef<EditorIdentitySnapshot>({ rawContent: entry.rawContent, ...committed });
  const accept = useCallback((saved: EditorIdentitySnapshot) => {
    revisionRef.current = saved.sourceRevision;
    const draft = draftRef.current;
    const sameDraft = draft.rawContent === saved.rawContent && JSON.stringify(Object.values(draft.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) === JSON.stringify(Object.values(saved.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport]));
    setCommitted(previous => ({ blocks: sameDraft ? saved.blocks : previous.blocks, sourceRevision: saved.sourceRevision }));
  }, []);
  const save = useCallback(async (snapshot: EditorIdentitySnapshot) => {
    const saved = await notePersistence.saveNote({ noteId: entry.id, rawContent: snapshot.rawContent, blocks: snapshot.blocks, expectedSourceRevision: revisionRef.current });
    const snapshotSaved = { rawContent: saved.rawContent, blocks: saved.blocks ?? {}, sourceRevision: saved.sourceRevision ?? 0 };
    accept(snapshotSaved);
    return snapshotSaved;
  }, [entry.id, accept]);
  const saves = useEditorSave<EditorIdentitySnapshot>({ onSave: async snapshot => { await save(snapshot); }, getSnapshotKey: snapshot => JSON.stringify([snapshot.rawContent, Object.values(snapshot.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])]) });
  const identityChanged = useCallback((snapshot: EditorIdentitySnapshot) => {
    const changed = draftRef.current.rawContent !== snapshot.rawContent || JSON.stringify(Object.values(draftRef.current.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) !== JSON.stringify(Object.values(snapshot.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport]));
    draftRef.current = snapshot;
    if (changed) saves.onChange(snapshot);
  }, [saves.onChange]);
  useEffect(() => {
    registerRun?.(async (block, resultId) => {
      await saves.flush();
      const draft = draftRef.current;
      const captured = await captureRun({ noteId: entry.id, rawContent: draft.rawContent, blocks: draft.blocks, expectedSourceRevision: revisionRef.current }, block, resultId);
      accept({ rawContent: captured.note.rawContent, blocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision });
      return captured;
    });
    return () => registerRun?.(null);
  }, [entry.id, registerRun, saves.flush, accept]);
  return <>
    <NoteEditor {...props} noteId={entry.id} value={restoredSource ?? entry.rawContent} noteBlocks={committed.blocks} sourceRevision={committed.sourceRevision}
      onIdentityChange={identityChanged} onSaved={accept} beforeRun={async () => { await saves.flush(); return revisionRef.current; }}
      onSaveRequest={() => { void saves.flush(); }} onChange={value => { setRestoredSource(null); onChange(value); }} onBlur={saves.onBlur} />
    {saves.error ? <p role="alert">Save failed. {saves.error instanceof Error ? saves.error.message : String(saves.error)} Your draft is kept.</p> : null}
    <BlockHistory noteId={entry.id} blocks={committed.blocks} sourceRevision={committed.sourceRevision} onRevert={async revision => {
      await saves.flush();
      const restored = revertBlock({ ...draftRef.current, sourceRevision: revisionRef.current }, revision);
      const saved = await save(restored);
      draftRef.current = saved;
      setRestoredSource(restored.rawContent);
      onChange(restored.rawContent);
    }} />
  </>;
}
