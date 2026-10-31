import { useCallback, useRef, useState } from 'react';
import type { NoteBlock } from '@/types/storage';
import { reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import { revertBlock } from '@/components/organisms/editor/BlockHistory';
import { captureRun } from '@/services/runCapture';
import { notePersistence } from '@/services/persistence';
import type { EditorIdentitySnapshot } from '@/components/organisms/editor/NoteEditor';
import { useEditorSave } from './useEditorSave';

export interface UseNoteDraftOptions {
  noteId: string;
  initialContent: string;
  initialBlocks?: Record<string, NoteBlock>;
  initialRevision?: number;
  metadata?: { title?: string };
  noteType?: 'note' | 'playground' | 'journal';
  onExternalChange?: (content: string) => void;
  onSavedRecord?: (saved: EditorIdentitySnapshot) => void;
}

export function areBlocksEqual(a?: Record<string, NoteBlock>, b?: Record<string, NoteBlock>): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const bBlock = b[key];
    const aBlock = a[key];
    if (!bBlock || aBlock.from !== bBlock.from || aBlock.to !== bBlock.to || aBlock.kind !== bBlock.kind || aBlock.dialect !== bBlock.dialect || aBlock.sport !== bBlock.sport) {
      return false;
    }
  }
  return true;
}

export function useNoteDraft({
  noteId,
  initialContent,
  initialBlocks = {},
  initialRevision = 0,
  metadata,
  noteType = 'note',
  onExternalChange,
  onSavedRecord,
}: UseNoteDraftOptions) {
  const [committed, setCommitted] = useState({ blocks: initialBlocks, sourceRevision: initialRevision });
  const [restoredContent, setRestoredContent] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const committedRevisionRef = useRef(committed.sourceRevision);
  const draftRef = useRef<EditorIdentitySnapshot>({
    rawContent: initialContent,
    blocks: committed.blocks,
    sourceRevision: committed.sourceRevision,
  });
  const loadedNoteIdRef = useRef<string | null>(null);

  // When a note finishes loading, install its source and blocks once
  if (loadedNoteIdRef.current !== noteId && initialRevision > 0) {
    loadedNoteIdRef.current = noteId;
    committedRevisionRef.current = initialRevision;
    draftRef.current = { rawContent: initialContent, blocks: initialBlocks, sourceRevision: initialRevision };
    setCommitted({ blocks: initialBlocks, sourceRevision: initialRevision });
  }

  const accept = useCallback((saved: EditorIdentitySnapshot) => {
    committedRevisionRef.current = saved.sourceRevision;
    const draft = draftRef.current;
    const sameDraft = draft.rawContent === saved.rawContent && areBlocksEqual(draft.blocks, saved.blocks);
    setCommitted(prev => ({ blocks: sameDraft ? saved.blocks : prev.blocks, sourceRevision: saved.sourceRevision }));
    onSavedRecord?.(saved);
  }, [onSavedRecord]);

  const save = useCallback(async (snapshot: EditorIdentitySnapshot) => {
    const headingMatch = snapshot.rawContent.match(/^#\s+(.+)$/m);
    const derivedTitle = headingMatch ? headingMatch[1].trim() : metadata?.title;
    const effectiveMetadata = { ...metadata, ...(derivedTitle ? { title: derivedTitle } : {}) };
    const updated = await notePersistence.saveNote({
      noteId,
      rawContent: snapshot.rawContent,
      blocks: snapshot.blocks,
      expectedSourceRevision: committedRevisionRef.current,
      metadata: effectiveMetadata,
      noteType,
    });
    const snapshotSaved: EditorIdentitySnapshot = {
      rawContent: updated.rawContent,
      blocks: updated.blocks ?? {},
      sourceRevision: updated.sourceRevision ?? committedRevisionRef.current,
    };
    accept(snapshotSaved);
    setActionError(null);
    return snapshotSaved;
  }, [noteId, metadata, noteType, accept]);
  const saves = useEditorSave<EditorIdentitySnapshot>({
    onSave: async snapshot => { await save(snapshot); },
    getSnapshotKey: snapshot => JSON.stringify([snapshot.rawContent, Object.values(snapshot.blocks).map(b => [b.id, b.from, b.to, b.kind, b.dialect, b.sport])]),
    onError: err => setActionError(`Save failed. ${err instanceof Error ? err.message : String(err)} Your draft is kept. Retry saving.`),
  });

  const onIdentityChange = useCallback((snapshot: EditorIdentitySnapshot) => {
    const changed = draftRef.current.rawContent !== snapshot.rawContent || !areBlocksEqual(draftRef.current.blocks, snapshot.blocks);
    draftRef.current = snapshot;
    if (changed) saves.onChange(snapshot);
  }, [saves.onChange]);

  const onSourceMutate = useCallback((nextContent: string) => {
    setRestoredContent(null);
    const rev = Math.max(1, committedRevisionRef.current);
    const blocks = draftRef.current.rawContent === nextContent
      ? draftRef.current.blocks
      : reconcileNoteBlocks(nextContent, { sourceRevision: rev, blocks: draftRef.current.blocks, registeredWidgets: KNOWN_SECTION_WIDGETS });
    onIdentityChange({ rawContent: nextContent, blocks, sourceRevision: committedRevisionRef.current });
    onExternalChange?.(nextContent);
  }, [onIdentityChange, onExternalChange]);

  const restoreRevision = useCallback(async (revision: Parameters<typeof revertBlock>[1]) => {
    await saves.flush();
    const current = draftRef.current;
    if (!current) throw new Error('The note draft is unavailable.');
    const restored = revertBlock({ ...current, sourceRevision: committedRevisionRef.current }, revision);
    const saved = await save(restored);
    draftRef.current = saved;
    setRestoredContent(restored.rawContent);
    onExternalChange?.(restored.rawContent);
  }, [saves.flush, save, onExternalChange]);

  const captureForRun = useCallback(async (block: Parameters<typeof captureRun>[1], runtimeId: string) => {
    setActionError(null);
    try {
      await saves.flush();
      const draft = draftRef.current;
      const captured = await captureRun(
        { noteId, rawContent: draft.rawContent, blocks: draft.blocks, expectedSourceRevision: committedRevisionRef.current, metadata, noteType },
        block,
        runtimeId,
      );
      accept({ rawContent: captured.note.rawContent, blocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision });
      return captured;
    } catch (err) {
      const msg = `Workout not started. ${err instanceof Error ? err.message : String(err)} Your draft is kept.`;
      setActionError(msg);
      throw err;
    }
  }, [saves.flush, noteId, metadata, noteType, accept]);

  return {
    content: restoredContent ?? draftRef.current.rawContent,
    committedBlocks: committed.blocks,
    committedRevision: committed.sourceRevision,
    draftSnapshot: draftRef.current,
    saveError: actionError ?? (saves.error ? `Save failed. ${saves.error instanceof Error ? saves.error.message : String(saves.error)} Your draft is kept. Retry saving.` : null),
    flush: saves.flush,
    onLineChange: saves.onLineChange,
    onBlur: saves.onBlur,
    onIdentityChange,
    onSourceMutate,
    restoreRevision,
    captureForRun,
    accept,
  };
}
