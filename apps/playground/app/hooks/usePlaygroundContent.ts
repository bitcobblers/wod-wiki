import { useState, useEffect, useCallback, useRef } from 'react';
import { playgroundContent, pageId as makePageId } from '../services/playgroundContent';
import { notePersistence } from '@/services/persistence';
import type { NoteBlock, Note } from '@/types/storage';
import { reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import { useEditorSave } from './useEditorSave';

interface UsePlaygroundContentOptions {
  category: string;
  name: string;
  mdContent: string;
  seedOnMount?: boolean;
}

export interface PlaygroundContentSnapshot {
  rawContent: string;
  noteBlocks: Record<string, NoteBlock>;
  sourceRevision: number;
}

export const LOAD_TIMEOUT_MS = 8000;

export function usePlaygroundContent({ category, name, mdContent, seedOnMount = true }: UsePlaygroundContentOptions) {
  const pageId = makePageId(category, name);
  const [content, setContent] = useState(mdContent);
  const [loading, setLoading] = useState(true);
  const [entryId, setEntryId] = useState<string>();
  const [noteBlocks, setNoteBlocks] = useState<Record<string, NoteBlock>>({});
  const [sourceRevision, setSourceRevision] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const committed = useRef({ id: pageId, revision: 0 });
  const currentRoute = useRef(pageId);
  currentRoute.current = pageId;
  const draft = useRef<PlaygroundContentSnapshot>({ rawContent: mdContent, noteBlocks: {}, sourceRevision: 0 });

  const onSaved = useCallback((saved: Pick<Note, 'rawContent' | 'blocks' | 'sourceRevision'>) => {
    committed.current.revision = saved.sourceRevision;
    setSourceRevision(saved.sourceRevision);
    if (draft.current.rawContent === saved.rawContent
      && Object.keys(draft.current.noteBlocks).length === Object.keys(saved.blocks).length
      && Object.values(draft.current.noteBlocks).every(block => {
        const persisted = saved.blocks[block.id];
        return persisted && persisted.from === block.from && persisted.to === block.to && persisted.kind === block.kind;
      })) {
      draft.current = { rawContent: saved.rawContent, noteBlocks: saved.blocks, sourceRevision: saved.sourceRevision };
      setNoteBlocks(saved.blocks);
    }
  }, []);

  const handleSave = useCallback(async (snapshot: PlaygroundContentSnapshot & { routeId: string; noteId: string; title: string }) => {
    if (snapshot.routeId === currentRoute.current && loadError) throw loadError;
    const saved = await notePersistence.saveNote({ noteId: snapshot.noteId, rawContent: snapshot.rawContent,
      blocks: snapshot.noteBlocks, expectedSourceRevision: committed.current.id === snapshot.noteId ? committed.current.revision : snapshot.sourceRevision,
      metadata: { title: snapshot.title }, noteType: 'playground' });
    if (currentRoute.current !== snapshot.routeId) return;
    committed.current.id = saved.id;
    setEntryId(saved.id);
    onSaved({ rawContent: saved.rawContent, blocks: saved.blocks ?? {}, sourceRevision: saved.sourceRevision ?? 1 });
  }, [onSaved, loadError]);

  const saves = useEditorSave({ onSave: handleSave,
    getSnapshotKey: snapshot => JSON.stringify([snapshot.noteId, snapshot.rawContent, Object.values(snapshot.noteBlocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])]) });

  useEffect(() => {
    let cancelled = false;
    committed.current = { id: pageId, revision: 0 };
    setLoading(true);
    setLoadError(null);
    const fallback = reconcileNoteBlocks(mdContent, { sourceRevision: 1, registeredWidgets: KNOWN_SECTION_WIDGETS });
    const install = (rawContent: string, blocks: Record<string, NoteBlock>, revision: number, id?: string) => {
      setContent(rawContent);
      setNoteBlocks(blocks);
      setSourceRevision(revision);
      setEntryId(id);
      committed.current = { id: id ?? pageId, revision };
      draft.current = { rawContent, noteBlocks: blocks, sourceRevision: revision };
    };
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      install(mdContent, fallback, 0);
      setLoadError(new Error('Note load timed out. Reload before saving to avoid overwriting stored content.'));
      setLoading(false);
    }, LOAD_TIMEOUT_MS);
    void (async () => {
      try {
        const page = await playgroundContent.getPage(pageId);
        if (cancelled) return;
        if (page) install(page.content, page.noteBlocks ?? {}, page.sourceRevision ?? 1, page.id);
        else if (seedOnMount) {
          const saved = await notePersistence.saveNote({ noteId: pageId, rawContent: mdContent, blocks: fallback,
            expectedSourceRevision: 0, metadata: { title: name }, noteType: 'playground' });
          if (!cancelled) install(saved.rawContent, saved.blocks ?? {}, saved.sourceRevision ?? 1, saved.id);
        } else install(mdContent, fallback, 0);
      } catch (error) {
        if (!cancelled) { install(mdContent, fallback, 0); setLoadError(error); }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pageId, mdContent, name, seedOnMount]);

  const onIdentityChange = useCallback((snapshot: PlaygroundContentSnapshot) => {
    const unchanged = draft.current.rawContent === snapshot.rawContent
      && JSON.stringify(Object.values(draft.current.noteBlocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) === JSON.stringify(Object.values(snapshot.noteBlocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport]));
    if (unchanged) return;
    draft.current = snapshot;
    setContent(snapshot.rawContent);
    setNoteBlocks(snapshot.noteBlocks);
    saves.onChange({ ...snapshot, routeId: pageId, noteId: committed.current.id, title: name });
  }, [saves.onChange, pageId, name]);

  const onChange = useCallback((value: string) => {
    setContent(value);
    if (draft.current.rawContent === value) return;
    const blocks = reconcileNoteBlocks(value, { sourceRevision: committed.current.revision || 1, registeredWidgets: KNOWN_SECTION_WIDGETS });
    onIdentityChange({ rawContent: value, noteBlocks: blocks, sourceRevision: committed.current.revision });
  }, [onIdentityChange]);

  const resetToOriginal = useCallback(async () => {
    onIdentityChange({ rawContent: mdContent, sourceRevision: committed.current.revision,
      noteBlocks: reconcileNoteBlocks(mdContent, { sourceRevision: committed.current.revision || 1, registeredWidgets: KNOWN_SECTION_WIDGETS }) });
    await saves.flush();
  }, [mdContent, onIdentityChange, saves.flush]);

  // ponytail: stable callback identity — consumers put this in useCallback
  // dep arrays; a fresh arrow per render would invalidate them every render.
  const committedSourceRevision = useCallback(() => committed.current.revision, []);

  return { content, loading, entryId, noteBlocks, sourceRevision, onIdentityChange, onSaved,
    onChange, onLineChange: saves.onLineChange, onBlur: saves.onBlur, flush: saves.flush,
    committedSourceRevision,
    resetToOriginal, isModified: content !== mdContent, error: saves.error ?? loadError };
}
