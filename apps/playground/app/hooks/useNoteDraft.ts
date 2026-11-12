import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteBlock } from '@/types/storage';
import { reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import { revertBlock } from '@/components/organisms/editor/BlockHistory';
import { captureRun } from '@/services/runCapture';
import { notePersistence } from '@/services/persistence';
import type { EditorIdentitySnapshot } from '@/components/organisms/editor/NoteEditor';
import { useEditorSave } from './useEditorSave';

import {
  clearStagedNoteSave,
  pendingNoteSaves,
  readStagedNoteSaves,
  replayStagedNoteSaves,
  stageNoteSave,
  waitForAllPendingNoteSaves,
  waitForPendingNoteSave,
  type StagedNoteSave,
} from '@/services/persistence/pendingNoteSaves';

export {
  replayStagedNoteSaves,
  waitForAllPendingNoteSaves,
  waitForPendingNoteSave,
  type StagedNoteSave,
};

/** Title derivation shared by live saves and staged replays: a leading H1
 *  wins over the loaded metadata title. */
function derivedTitle(rawContent: string, metadata?: { title?: string }): { title?: string } | undefined {
  const headingMatch = rawContent.match(/^#\s+(.+)$/m);
  const title = headingMatch ? headingMatch[1].trim() : metadata?.title;
  return title ? { title } : undefined;
}
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
  const savedSnapshotRef = useRef<EditorIdentitySnapshot | null>(null);
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const loadedNoteIdRef = useRef<string | null>(null);

  // When a note finishes loading, install its source and blocks once
  if (loadedNoteIdRef.current !== noteId && initialRevision > 0) {
    loadedNoteIdRef.current = noteId;
    committedRevisionRef.current = initialRevision;
    draftRef.current = { rawContent: initialContent, blocks: initialBlocks, sourceRevision: initialRevision };
    savedSnapshotRef.current = draftRef.current;
    setCommitted({ blocks: initialBlocks, sourceRevision: initialRevision });
  }

  const accept = useCallback((saved: EditorIdentitySnapshot) => {
    committedRevisionRef.current = saved.sourceRevision;
    savedSnapshotRef.current = saved;
    const draft = draftRef.current;
    const sameDraft = draft.rawContent === saved.rawContent && areBlocksEqual(draft.blocks, saved.blocks);
    setCommitted(prev => ({ blocks: sameDraft ? saved.blocks : prev.blocks, sourceRevision: saved.sourceRevision }));
    onSavedRecord?.(saved);
  }, [onSavedRecord]);

  const save = useCallback(async (snapshot: EditorIdentitySnapshot) => {
    const effectiveMetadata = { ...metadata, ...derivedTitle(snapshot.rawContent, metadata) };
    const savePromise = notePersistence.saveNote({
      noteId,
      rawContent: snapshot.rawContent,
      blocks: snapshot.blocks,
      expectedSourceRevision: committedRevisionRef.current,
      metadata: effectiveMetadata,
      noteType,
    });
    pendingNoteSaves.set(noteId, savePromise);
    const updated = await savePromise.finally(() => {
      if (pendingNoteSaves.get(noteId) === savePromise) {
        pendingNoteSaves.delete(noteId);
      }
    });
    // This exact snapshot is durable now — drop the staged pagehide copy of it.
    const staged = readStagedNoteSaves()[noteId];
    if (staged && staged.rawContent === snapshot.rawContent) clearStagedNoteSave(noteId);
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

  const stageDirtyDraft = useCallback((draft: EditorIdentitySnapshot) => {
    const title = derivedTitle(draft.rawContent, metadataRef.current);
    stageNoteSave({
      noteId,
      rawContent: draft.rawContent,
      blocks: draft.blocks,
      expectedSourceRevision: committedRevisionRef.current,
      ...(title ? { metadata: title } : {}),
      noteType,
      stagedAt: Date.now(),
    });
  }, [noteId, noteType]);

  // Hard unload race: the async IndexedDB save dies with the document, so the
  // dirty draft is parked in localStorage synchronously and replayed on the
  // next page load (waitForPendingNoteSave / IndexedDBContentProvider reads).
  useEffect(() => {
    const onUnload = () => {
      const draft = draftRef.current;
      const saved = savedSnapshotRef.current;
      if (!draft) return;
      if (saved && saved.rawContent === draft.rawContent && areBlocksEqual(saved.blocks, draft.blocks)) return;
      stageDirtyDraft(draft);
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [stageDirtyDraft]);

  const onIdentityChange = useCallback((snapshot: EditorIdentitySnapshot) => {
    const changed = draftRef.current.rawContent !== snapshot.rawContent || !areBlocksEqual(draftRef.current.blocks, snapshot.blocks);
    draftRef.current = snapshot;
    if (changed) {
      saves.onChange(snapshot);
      stageDirtyDraft(snapshot);
    }
  }, [saves.onChange, stageDirtyDraft]);

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

  const flush = useCallback(async (): Promise<void> => {
    await saves.flush();
  }, [saves.flush]);

  return {
    content: restoredContent ?? draftRef.current.rawContent,
    committedBlocks: committed.blocks,
    committedRevision: committed.sourceRevision,
    committedSourceRevision: useCallback(() => committedRevisionRef.current, []),
    draftSnapshot: draftRef.current,
    saveError: actionError ?? (saves.error ? `Save failed. ${saves.error instanceof Error ? saves.error.message : String(saves.error)} Your draft is kept. Retry saving.` : null),
    flush,
    onLineChange: saves.onLineChange,
    onBlur: saves.onBlur,
    onIdentityChange,
    onSourceMutate,
    restoreRevision,
    captureForRun,
    accept,
  };
}
