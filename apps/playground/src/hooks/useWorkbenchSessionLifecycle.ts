/**
 * useWorkbenchSessionLifecycle — the Workbench Effect's thin adapter.
 *
 * Replaces `useWorkbenchEffects` (the Context↔Store bridge). Responsibilities:
 *
 *   1. **Runtime hydration** — pulls `runtime` / `execution` / `handles` from
 *      the `useWorkbenchRuntime` hook and pushes them into the session via
 *      `setRuntime` / `setExecution` / `setHandles`. The session's
 *      `setRuntime` wires `subscribeToOutput` + `subscribeToStack` (ADR-0002).
 *
 *   2. **Document structure + cursor → activeBlockId** — derives the
 *      `DocumentItem` list from `content`/`blocks` and mirrors the editor's
 *      cursor line to the session's `activeBlockId`.
 *
 *   3. **Runtime initialization on view-mode changes** — calls
 *      `initializeRuntime`/`disposeRuntime` when entering/leaving track view.
 *      Replaces the long-lived `useWorkbenchEffects` effect.
 *
 *   4. **Clear stale analytics on selection** — when `selectedBlockId`
 *      changes, clear `analyticsSegments` so the cast proxy + review view
 *      reset between sections.
 *
 *   5. **Wake lock** — keep the screen awake while the timer is running.
 *
 *   6. **Reset on unmount** — `resetStore` when the Workbench unmounts.
 *
 * The session is the single source of truth for derived analytics, active
 * segments, and reactive state; this adapter only wires the React-bound
 * pieces (runtime hydration, lifecycle, wake lock) that cannot live in
 * the plain store.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useWorkbenchRuntime } from '@/hooks/useWorkbenchRuntime';
import { useWakeLock } from '@/hooks/useWakeLock';
import { parseDocumentStructure } from '@/components/Editor/utils/documentStructure';
import { useWorkbenchSession, getActiveWorkbenchSessionStore } from '@/stores/workbenchSessionStore'
import { resolveSoundProfiles } from '@/services/sound/soundProfiles'
import { noteProfileIdFromTags, setSoundTagIndex } from '@/services/sound/soundTagCatalog'
import { storageService } from '@/services/storage'
import type { ScriptBlock, Sessions } from '@/components/Editor/types';

/**
 * Inputs the adapter reads from the React tree. The session is the canonical
 * home for everything else; the adapter only pulls the React-bound pieces
 * (`runtime` lifecycle, `execution` poll, `handleStart`/etc.) and pushes
 * them onto the session.
 */
export interface UseWorkbenchSessionLifecycleDeps {
  /** Current view mode. `useWorkbenchRuntime` ignores it but it controls
   * the adapter's runtime-init effect (only initialize on `track`). */
  viewMode: string;
  /** The block the user selected for the current track view, if any. */
  selectedBlock: ScriptBlock | null;
  /** Workspace-level completion callback; the adapter forwards it to
   * `useWorkbenchRuntime` which calls it on auto-stop. */
  completeWorkout: (results: Sessions, resultId?: string) => void;
  /** Workspace-level start callback; the adapter forwards it. */
  startWorkout: (block: ScriptBlock) => void;
}

/**
 * The thin adapter — no return value, all side effects are writes to the
 * session store. Workbench.tsx calls this once at the top of the tree.
 */
export function useWorkbenchSessionLifecycle(deps: UseWorkbenchSessionLifecycleDeps): void {
  const { viewMode, selectedBlock, completeWorkout, startWorkout } = deps;

  // The session's vanilla `StoreApi` for imperative `getState()` calls
  // (mutations, resets). Selector reads use `useWorkbenchSession` directly.
  const sessionApi = getActiveWorkbenchSessionStore();

  // ── Runtime hydration (push runtime/execution/handles into the session) ──

  const runtimeControls = useWorkbenchRuntime(
    viewMode,
    selectedBlock,
    completeWorkout,
    startWorkout,
  );

  const { runtime, execution, handleStart, handlePause, handleStop, handleNext, handleStartWorkoutAction } =
    runtimeControls;

  useEffect(() => {
    sessionApi.getState().setRuntime(runtime);
  }, [runtime, sessionApi]);

  useEffect(() => {
    sessionApi.getState().setExecution(execution);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [
    execution.status,
    execution.elapsedTime,
    execution.stepCount,
    execution.startTime,
    sessionApi,
  ]);

  useEffect(() => {
    sessionApi.getState().setHandles({
      handleStart,
      handlePause,
      handleStop,
      handleNext,
      handleStartWorkoutAction,
    });
  }, [sessionApi, handleStart, handlePause, handleStop, handleNext, handleStartWorkoutAction]);
  // ── Document structure (push to session) ──

  const content = useWorkbenchSession((s) => s.content);
  const blocks = useWorkbenchSession((s) => s.blocks);

  const documentItems = useMemo(
    () => parseDocumentStructure(content, blocks),
    [content, blocks],
  );

  useEffect(() => {
    sessionApi.getState().setDocumentItems(documentItems);
  }, [documentItems, sessionApi]);

  // ── Cursor line → activeBlockId ──

  const cursorLine = useWorkbenchSession((s) => s.cursorLine);
  const setActiveBlockId = useWorkbenchSession((s) => s.setActiveBlockId);

  useEffect(() => {
    const item = documentItems.find(
      (it) => cursorLine >= it.startLine && cursorLine <= it.endLine,
    );
    setActiveBlockId(item?.id ?? null);
  }, [documentItems, cursorLine, setActiveBlockId]);

  // ── Sound configuration ──
  // The note's tags select the note's sound profile; a block that names its
  // own profile overrides it. Resolved here, at the compile level, so the
  // runtime needs no lookup of its own.
  const noteTags = useWorkbenchSession((s) => s.currentEntry?.tags);

  // The tag index lets a line reference a tag with `#{tag-slug}`. Parsing is
  // synchronous and tags live in async storage, so the index is cached and
  // refreshed here.
  useEffect(() => {
    let cancelled = false;
    storageService.getAllTags()
      .then(tags => { if (!cancelled) setSoundTagIndex(tags); })
      .catch(() => { /* Tags are optional — a document without them still runs. */ });
    return () => { cancelled = true; };
  }, []);

  const soundOptions = useMemo(() => ({
    profiles: resolveSoundProfiles(),
    noteProfileId: noteProfileIdFromTags(noteTags ?? []),
  }), [noteTags]);

  // ── Runtime initialization on view-mode changes ──
  // when entering track view with a fresh selectedBlock; dispose when
  // leaving. The `getBlockKey` helper matches the prior bridge's identity
  // heuristic so re-init only fires on actual block changes.
  const lastInitializedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (viewMode === 'track' && selectedBlock && lastInitializedKeyRef.current === null) {
      lastInitializedKeyRef.current = 'starting';
      sessionApi.getState().startPinnedRun(selectedBlock).then(block => {
        if (cancelled) return;
        runtimeControls.initializeRuntime(block, { soundOptions });
        lastInitializedKeyRef.current = block.id;
      }).catch(() => { lastInitializedKeyRef.current = null; });
    } else if (viewMode !== 'track' && lastInitializedKeyRef.current !== null) {
      runtimeControls.disposeRuntime();
      lastInitializedKeyRef.current = null;
    }
    return () => { cancelled = true; };
  }, [viewMode, selectedBlock?.id, sessionApi, soundOptions, runtimeControls.initializeRuntime, runtimeControls.disposeRuntime]);

  // ── Clear stale analytics on selection change ──


  const selectedBlockId = useWorkbenchSession((s) => s.selectedBlockId);
  const lastSelectedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (selectedBlockId !== lastSelectedRef.current) {
      if (lastSelectedRef.current !== undefined) {
        sessionApi.getState().setAnalytics([], []);
      }
      lastSelectedRef.current = selectedBlockId;
    }
  }, [selectedBlockId, sessionApi]);

  // ── Wake lock when the runtime is running ──

  useWakeLock({
    enabled: viewMode === 'track' && execution.status === 'running',
  });

  // ── Reset on unmount ──

  useEffect(
    () => () => {
      sessionApi.getState().resetStore();
    },
    [sessionApi],
  );
}
