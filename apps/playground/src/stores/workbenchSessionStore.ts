/**
 * workbenchSessionStore — the Workbench Session, one module.
 *
 * Single coherent state for the workbench (document, view, results, panel,
 * history, attachments, runtime, analytics, cross-panel). Created by a factory
 * `createWorkbenchSessionStore({ notePersistence, provider, nowProvider,
 * navigate, setTimeout, clearTimeout })` so the store is exercisable without
 * React — tests instantiate it with in-memory collaborators; the React
 * `WorkbenchSessionProvider` injects the real ones.
 *
 * Vocabulary lives in `CONTEXT.md`:
 *   - **Workbench Session** — one module, one state, one set of actions.
 *   - **Workbench Effect** — renderless React adapter for genuinely
 *     lifecycle-bound work (runtime create/dispose, wake lock, beforeunload,
 *     unmount reset, route-read). Stays in a separate file; observes the
 *     session via `subscribeToOutput` / `subscribeToStack`.
 *
 * Decisions (do not relitigate):
 *   - One store, not domain-split (ADR-0001).
 *   - Reactive observation via `subscribeToOutput` + `subscribeToStack`
 *     (ADR-0002) — analytics unify on one "derive from output list"
 *     derivation fed live by subscription and from persisted logs otherwise.
 *   - The cast bridges read 6 selectors (`runtime`, `execution.status`,
 *     `viewMode`, `selectedBlock`, `documentItems`, `analyticsSegments`) —
 *     those names stay readable throughout the migration.
 */

import { createStore, useStore } from 'zustand';
import React, { useEffect, useMemo } from 'react';
import type { IContentProvider } from '@/types/content-provider';
import type { ViewMode } from '@/panels/panel-system/ResponsiveViewport';
import type { IScriptRuntime, UseRuntimeExecutionReturn, SubscriptionManager } from '@/hooks/useRuntimeTimer';
import type { ScriptBlock, Section, Sessions } from '@/components/Editor/types';
import type { PanelLayoutState } from '@/panels/panel-system/types';
import type { DocumentItem } from '@/components/Editor/utils/documentStructure';
import type { Segment, AnalyticsGroup } from '@bitcobblers/wod-wiki-engine';
import { getAnalyticsFromLogs, getAnalyticsFromRuntime } from '@/services/AnalyticsTransformer';
import type { NoteLocator, GetNoteOptions } from '@/services/persistence';
import type { INotePersistence } from '@/services/persistence';
import { revertBlock } from '@/components/organisms/editor/BlockHistory';
import { fileProcessor } from '@/hooks/useBrowserServices';
import { loadStaticWorkbenchContent } from '@/app/workbench/workbenchProviders';
import type { HistoryRecord } from '@/types/history';
import type { Attachment } from '@/types/storage';
import { sharedCastSessionManager } from '@/services/cast/rpc/CastSessionManager';
import { getActiveCastTransport } from '@/services/cast/castTransportRegistry';
import { ChromecastRuntimeSubscription } from '@/services/cast/rpc/ChromecastRuntimeSubscription';
import { wallClockNow } from '@bitcobblers/wod-wiki-engine';
import { hashCode } from '@/lib/utils';
import type { INowProvider } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import { deriveWorkbenchDocumentState } from '@/app/workbench/workbenchDocumentModel';
import { captureRun, type CapturedRun } from '@/services/runCapture';
import type { NoteBlock } from '@/types/storage';
import type { EditorIdentitySnapshot } from '@/components/organisms/editor/NoteEditor';
import { v7 as uuidv7 } from 'uuid';

// ─── Shared route vocabulary (used by Workbench Session + Workbench Effect) ─

/**
 * NavigationIntent — the one route vocabulary shared by the Workbench Session
 * (which emits it via `navigate(intent)`) and the Workbench Effect / route
 * classifier (which translates it to a concrete router). Finding 02 consumes
 * the same shape.
 */
export type NavigationIntent =
  | { type: 'goToPlan'; noteId: string }
  | { type: 'goToTrack'; noteId: string; sectionId?: string }
  | { type: 'goTo'; view: ViewMode | 'history' | 'analyze'; noteId?: string; sectionId?: string; resultId?: string };

/**
 * NavigateFn — the injected port the session uses to emit navigation.
 * Tests pass a function that captures the intents.
 */
export type NavigateFn = (intent: NavigationIntent) => void;

/**
 * Save state for the content autosave machine. The state transitions:
 * `idle` → `changed` (content differs from last saved) → `saving`
 * (debounce fired, provider update started) → `saved` (success) → `idle`
 * after 3s. `error` if the provider update fails.
 */
export type SaveState = 'idle' | 'changed' | 'saving' | 'saved' | 'error';

// ─── Handles interface (React hook closures — kept separate from plain state) ─

export interface WorkbenchHandles {
  handleStart: () => void;
  handlePause: () => void;
  handleStop: () => void;
  handleNext: () => void;
  handleStartWorkoutAction: (block: ScriptBlock) => void;
}

export const noopHandles: WorkbenchHandles = {
  handleStart: () => { },
  handlePause: () => { },
  handleStop: () => { },
  handleNext: () => { },
  handleStartWorkoutAction: () => { },
};

// ─── State shape ──────────────────────────────────────────────────────

/**
 * The setters and reads owned by the Workbench Session.
 */
export interface WorkbenchSessionState {
  // --- Document (S1a: migrated from WorkbenchContext) ---
  content: string;
  sections: Section[] | null;
  noteBlocks: Record<string, NoteBlock>;
  sourceRevision: number;
  capturedRun: CapturedRun | null;
  saveError: string | null;
  blocks: ScriptBlock[];
  activeBlockId: string | null;
  saveState: SaveState;
  /** Last content persisted to the provider. Used by the autosave machine. */
  lastSavedContent: string;
  /** Route id from the last loadEntry call — used as the save target for new (not-yet-persisted) entries. */
  loadedRouteId: string | null;

  // --- Results & History (S1b: migrated from WorkbenchContext) ---
  results: Sessions[];
  currentEntry: HistoryRecord | null;
  historyEntries: HistoryRecord[];

  // --- Panel Layout (S1c: migrated from WorkbenchContext) ---
  panelLayouts: Record<string, PanelLayoutState>;

  // --- Attachments (S1d: migrated from WorkbenchContext) ---
  attachments: Attachment[];

  // --- Runtime & Execution (hydrated by the Workbench Effect from runtime hooks) ---
  runtime: IScriptRuntime | null;
  execution: UseRuntimeExecutionReturn;

  // --- Execution Handles (React hook closures, injected via the adapter) ---
  handles: WorkbenchHandles;

  // --- Active Tracking (derived from runtime stack) ---
  activeSegmentIds: Set<number>;
  activeStatementIds: Set<number>;

  // --- Analytics (persisted across runtime disposal) ---
  analyticsSegments: Segment[];
  analyticsGroups: AnalyticsGroup[];
  selectedAnalyticsIds: Set<number>;
  lastSelectedAnalyticsId: number | null;
  /** Output list accumulated by `subscribeToOutput`. Source for live analytics. */
  outputStatementList: unknown[];
  /** Output list fed from `currentEntry.results.logs` when no runtime is mounted. */
  logOutputList: unknown[];


  // --- Review Grid ---
  userOutputOverrides: Map<string, MetricContainer>;
  gridViewPreset: string;

  // --- Cross-Panel Interaction ---
  hoveredBlockKey: string | null;

  // --- Document Structure ---
  documentItems: DocumentItem[];
  selectedBlock: ScriptBlock | null;
  selectedBlockId: string | null;

  // --- Editor Bridge ---
  cursorLine: number;
  highlightedLine: number | null;

  // --- Subscription Manager (bridged from RuntimeLifecycleProvider) ---
  subscriptionManager: SubscriptionManager | null;

  // --- Navigation View Mode (route-derived; canonical in the session) ---
  viewMode: ViewMode;
}

export interface WorkbenchSessionActions {
  // --- Document (S1a) ---
  setContent: (content: string) => void;
  setEditorIdentity: (snapshot: EditorIdentitySnapshot) => void;
  acceptSaved: (snapshot: EditorIdentitySnapshot) => void;
  restoreBlock: (revision: import('@/types/storage').BlockRevision) => Promise<void>;
  startPinnedRun: (block: ScriptBlock) => Promise<ScriptBlock>;
  setBlocks: (blocks: ScriptBlock[]) => void;
  setActiveBlockId: (id: string | null) => void;
  /** Mark the autosave machine's state (e.g. 'saving' / 'saved' / 'error'). */
  setSaveState: (state: SaveState) => void;
  /** Manually flush a pending autosave (e.g. on unmount / beforeunload). */
  flushSave: () => Promise<void>;
  /** Mark content as persisted (called after a successful autosave). */
  markSaved: (content: string) => void;

  // --- Results & History (S1b) ---
  setResults: (results: Sessions[]) => void;
  resetResults: () => void;
  setCurrentEntry: (entry: HistoryRecord | null) => void;
  setHistoryEntries: (entries: HistoryRecord[]) => void;

  // --- Panel Layout (S1c) ---
  setPanelLayouts: (layouts: Record<string, PanelLayoutState>) => void;
  expandPanel: (viewId: string, panelId: string) => void;
  collapsePanel: (viewId: string) => void;

  // --- Attachments (S1d) ---
  setAttachments: (attachments: Attachment[]) => void;
  /** Add a file attachment to the current entry (persists via notePersistence). */
  addAttachment: (file: File) => Promise<void>;
  /** Delete an attachment by id (persists via notePersistence). */
  deleteAttachment: (id: string) => Promise<void>;
  /**
   * Complete a workout — persists the result atomically with the current
   * analytics capture from `analyticsSegments`, then navigates to the
   * review route. The 4-source read previously split across the Context +
   * Store + localStorage is now one action on the session. Returns the
   * generated resultId so callers can navigate synchronously before the
   * persistence promise resolves.
   */
  completeWorkout: (result: Sessions, explicitResultId?: string, runBlock?: Pick<ScriptBlock, "id" | "contentId"> | null) => Promise<string>;
  /** Patch the loaded entry's `results` slice (used by route-result loading). */
  patchCurrentEntryResults: (results: Sessions) => void;
  /**
   * `loadEntry` — route-driven entry loader. Pulls a note from persistence,
   * hydrates `currentEntry` + `content`, and (for review routes) patches the
   * entry's `results` slice from the matching Session. Single home for
   * what was previously the 4-source loadContent effect in WorkbenchContext.
   */
  loadEntry: (params: {
    routeId: string | undefined;
    routeView: ViewMode | 'history' | 'analyze';
    routeSectionId?: string;
    routeResultId?: string;
    resultFromLocationState?: Sessions;
    initialActiveEntryId?: string;
    propInitialContent?: string;
    onLoaded?: (entry: HistoryRecord) => void;
  }) => Promise<HistoryRecord | null>;
  /**
   * Proxy to `INotePersistence.getNote` — surfaces the history seam so
   * components can query a single note (e.g. resultSelection projections
   * for results-by-section) without re-importing the persistence adapter.
   * Throws if `notePersistence` wasn't injected.
   */
  getNote: (locator: NoteLocator, options?: GetNoteOptions) => Promise<HistoryRecord>;
  // --- Active tracking ---
  setActiveSegmentIds: (ids: Set<number>) => void;
  setActiveStatementIds: (ids: Set<number>) => void;

  // --- Analytics ---
  setAnalytics: (segments: Segment[], groups: AnalyticsGroup[]) => void;
  /** Append an OutputStatement emitted by `subscribeToOutput`. Live-only. */
  appendOutputStatement: (output: unknown) => void;
  /** Reset the live output list (called when `setRuntime(null)`). */
  clearOutputStatementList: () => void;
  /** Feed persisted logs (fallback when no runtime is mounted). */
  feedLogOutputs: (outputs: unknown[], startTime?: number) => void;
  toggleAnalyticsSegment: (
    id: number,
    modifiers?: { ctrlKey: boolean; shiftKey: boolean },
    visibleIds?: number[],
  ) => void;

  // --- Review Grid ---
  setUserOverride: (blockKey: string, metrics: MetricContainer | IMetric[]) => void;
  clearUserOverride: (blockKey: string) => void;
  setGridViewPreset: (presetId: string) => void;

  // --- Cross-panel ---
  setHoveredBlockKey: (key: string | null) => void;
  setDocumentItems: (items: DocumentItem[]) => void;
  setSelectedBlock: (block: ScriptBlock | null) => void;
  setSelectedBlockId: (id: string | null) => void;
  setCursorLine: (line: number) => void;
  setHighlightedLine: (line: number | null) => void;
  setSubscriptionManager: (mgr: SubscriptionManager | null) => void;
  setViewMode: (mode: ViewMode) => void;

  // --- Runtime & execution setters (replaces _hydrateRuntime) ---
  setRuntime: (runtime: IScriptRuntime | null) => void;
  setExecution: (execution: UseRuntimeExecutionReturn) => void;
  setHandles: (handles: WorkbenchHandles) => void;

  /** Resets the entire store to its initial state. Called on Workbench unmount. */
  resetStore: () => void;
}

// ─── Combined store type ──────────────────────────────────────────────

export type WorkbenchSessionStore = WorkbenchSessionState & WorkbenchSessionActions;

/**
 * Initial state for a fresh Workbench Session. `noopExecution` is the
 * pre-hydration stub the runtime hook uses; `noopHandles` matches `WorkbenchHandles`.
 */
const initialState: WorkbenchSessionState = {
  content: '',
  sections: null,
  noteBlocks: {},
  sourceRevision: 0,
  capturedRun: null,
  saveError: null,
  blocks: [],
  activeBlockId: null,
  saveState: 'idle',
  lastSavedContent: '',
  loadedRouteId: null,

  // Results & History (S1b)
  results: [],
  currentEntry: null,
  historyEntries: [],

  // Panel Layout (S1c)
  panelLayouts: {},

  // Attachments (S1d)
  attachments: [],

  // Runtime & execution
  runtime: null,
  execution: {
    status: 'idle',
    elapsedTime: 0,
    stepCount: 0,
    startTime: null,
    start: () => { },
    pause: () => { },
    stop: () => { },
    reset: () => { },
    step: () => { },
  },
  handles: noopHandles,

  // Active tracking
  activeSegmentIds: new Set(),
  activeStatementIds: new Set(),

  // Analytics
  analyticsSegments: [],
  analyticsGroups: [],
  selectedAnalyticsIds: new Set(),
  lastSelectedAnalyticsId: null,
  outputStatementList: [],
  logOutputList: [],

  // Review Grid
  userOutputOverrides: new Map(),
  gridViewPreset: 'default',

  // Cross-panel
  hoveredBlockKey: null,

  // Document Structure
  documentItems: [],
  selectedBlock: null,
  selectedBlockId: null,

  // Editor bridge
  cursorLine: 1,
  highlightedLine: null,

  // Subscription manager
  subscriptionManager: null,

  // View mode
  viewMode: 'plan' as ViewMode,
};

// ─── Factory + default store ──────────────────────────────────────────

/**
 * Ports the Workbench Session needs from the world. The React
 * `WorkbenchSessionProvider` resolves them from props; tests pass in-memory
 * fakes.
 *
 * Each port is optional so callers can build a partial session (e.g. the
 * default module-load store has none). Actions that require a missing
 * collaborator are no-ops — so storybook shells that mount without a
 * provider don't crash.
 */
export interface CreateWorkbenchSessionStoreDeps {
  /** Source of current time for the autosave machine's "saved" grace timer. */
  nowProvider?: INowProvider;
  /** Persistence port — `getNote`, `mutateNote`, etc. */
  notePersistence?: import('@/services/persistence').INotePersistence;
  /** Content provider port — `updateRecord`, `saveRecord`, `getRecord`, etc. */
  provider?: import('@/types/content-provider').IContentProvider;
  /** Navigation port — `react-router` for prod, capture-fn for tests. */
  navigate?: NavigateFn;
  /** Timer ports — `window.setTimeout`/`clearTimeout` for prod, a fake for tests. */
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /**
   * Set of listeners invoked after every store update. Useful for tests that
   * want to assert the autosave debounce fired. Each listener receives the
   * full store snapshot.
   */
  listeners?: Array<(snapshot: WorkbenchSessionStore) => void>;
}

/**
 * Autosave debounce window (ms). Matches the React `useDebounce(content, 5000)`
 * previously used in WorkbenchContext; the brief calls for moving this into
 * the session.
 */
export const AUTOSAVE_DEBOUNCE_MS = 5000;

/**
 * Build a Workbench Session store with the given collaborators. Tests pass
 * a `nowProvider` (a frozen clock) to make the autosave debounce deterministic;
 * the React provider passes `wallClockNow` and the production dependencies.
 *
 * Returns the vanilla Zustand `StoreApi`. Components consume it via the
 * React-bound `useWorkbenchSessionStore(selector)` helper at the bottom of
 * this module.
/**
 * `WorkbenchSessionStoreApi` — the vanilla Zustand `StoreApi` shape produced
 * by `createWorkbenchSessionStore`. Components bind to it via the React
 * `useWorkbenchSession` selector hook; tests use the `getState`/`setState`
 * surface directly.
 */
export type WorkbenchSessionStoreApi = ReturnType<typeof createWorkbenchSessionStore>;
export function createWorkbenchSessionStore(
  deps: CreateWorkbenchSessionStoreDeps = {},
) {
  // Hold the debounce handle outside the store so setContent can cancel +
  // reschedule without going through state (state can't store a handle that
  // isn't JSON-friendly).
  const listeners = deps.listeners ?? [];
  const nowProvider = deps.nowProvider ?? wallClockNow;
  const notePersistence = deps.notePersistence;
  const setTimeoutFn = deps.setTimeout ?? ((handler: () => void, ms: number) => window.setTimeout(handler, ms));
  const clearTimeoutFn = deps.clearTimeout ?? ((handle: unknown) => {
    // `handle` is opaque by design (the matching `setTimeout` impl returns
    // whatever it likes). We only know it's `number`-shaped for the
    // production default of `window.setTimeout`. Narrow at the boundary.
    if (typeof handle === 'number') window.clearTimeout(handle);
  });

  // Hold the debounce handle outside the store so setContent can cancel +
  // reschedule without going through state (state can't store a handle that
  let autosaveHandle: unknown = null;
  /** Disposers from the runtime's `subscribeToOutput` + `subscribeToStack`. */
  let subscriptionDisposers: Array<() => void> = [];

  const store = createStore<WorkbenchSessionStore>()((set, get): WorkbenchSessionStore => {
    let saveChain = Promise.resolve();
    const saveSnapshot = async (snapshot: EditorIdentitySnapshot) => {
      const state = get();
      const targetId = state.currentEntry?.id ?? state.loadedRouteId;
      if (!targetId || !notePersistence || !deps.provider?.capabilities.canWrite) return;
      if (snapshot.rawContent === state.lastSavedContent && JSON.stringify(Object.values(snapshot.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) === JSON.stringify(Object.values(state.currentEntry?.blocks ?? {}).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport]))) return;
      set({ saveState: 'saving', saveError: null });
      try {
        const saved = await notePersistence.saveNote({ noteId: targetId, rawContent: snapshot.rawContent, blocks: snapshot.blocks, expectedSourceRevision: state.sourceRevision, metadata: { title: snapshot.rawContent.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Untitled Session' }, noteType: 'playground' });
        const current = get();
        const sameDraft = current.content === snapshot.rawContent && JSON.stringify(Object.values(current.noteBlocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) === JSON.stringify(Object.values(snapshot.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport]));
        set({ currentEntry: saved, ...(sameDraft ? { noteBlocks: saved.blocks } : {}), sourceRevision: saved.sourceRevision ?? state.sourceRevision, lastSavedContent: snapshot.rawContent, saveState: 'saved' });
      } catch (error) {
        set({ saveState: 'error', saveError: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };
    const runAutosave = () => {
      autosaveHandle = null;
      const state = get();
      const snapshot = { rawContent: state.content, blocks: state.noteBlocks, sourceRevision: state.sourceRevision };
      const operation = saveChain.catch(() => {}).then(() => saveSnapshot(snapshot));
      saveChain = operation;
      return operation;
    };

    return {
      ...initialState,

      // ─── Document actions (S1a) ───────────────────────────────

      setContent: (content) => {
        // Document derivation: sections + blocks derive from content via
        // `deriveWorkbenchDocumentState` (same logic the Context used).
        const next = deriveWorkbenchDocumentState(content, { noteBlocks: get().noteBlocks, sourceRevision: Math.max(1, get().sourceRevision) });
        const prior = get();
        const nextState: Partial<WorkbenchSessionState> = {
          content,
          sections: next.sections,
          blocks: next.blocks,
          noteBlocks: next.noteBlocks,
        };

        // Autosave machine: if content differs from lastSaved, mark 'changed'
        // and (re)schedule the debounced save. Cancels any in-flight timer
        // so the debounce actually waits for a quiet period.
        if (content !== prior.lastSavedContent) {
          if (prior.saveState === 'idle') {
            nextState.saveState = 'changed';
          }
          if (autosaveHandle !== null) {
            clearTimeoutFn(autosaveHandle);
          }
          if (deps.provider && deps.provider.capabilities.canWrite) {
            autosaveHandle = setTimeoutFn(() => { void runAutosave().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
          }
        }

        set(nextState);
      },

      setBlocks: (blocks) => set({ blocks }),
      setEditorIdentity: snapshot => {
        const changed = JSON.stringify(Object.values(get().noteBlocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) !== JSON.stringify(Object.values(snapshot.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport]));
        set({ content: snapshot.rawContent, noteBlocks: snapshot.blocks });
        if (changed && deps.provider?.capabilities.canWrite) {
          if (autosaveHandle !== null) clearTimeoutFn(autosaveHandle);
          autosaveHandle = setTimeoutFn(() => { void runAutosave().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
        }
      },
      acceptSaved: snapshot => set(state => ({ ...(state.content === snapshot.rawContent && JSON.stringify(Object.values(state.noteBlocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) === JSON.stringify(Object.values(snapshot.blocks).map(block => [block.id, block.from, block.to, block.kind, block.dialect, block.sport])) ? { noteBlocks: snapshot.blocks } : {}), sourceRevision: snapshot.sourceRevision, lastSavedContent: snapshot.rawContent })),
      restoreBlock: async revision => {
        if (!notePersistence) throw new Error('Note persistence is unavailable.');
        await runAutosave();
        const state = get();
        const snapshot = revertBlock({ rawContent: state.content, blocks: state.noteBlocks, sourceRevision: state.sourceRevision }, revision);
        const saved = await notePersistence.saveNote({ noteId: revision.noteId, rawContent: snapshot.rawContent, blocks: snapshot.blocks, expectedSourceRevision: state.sourceRevision });
        const next = deriveWorkbenchDocumentState(saved.rawContent, { noteBlocks: saved.blocks, sourceRevision: saved.sourceRevision });
        set({ content: saved.rawContent, noteBlocks: saved.blocks, sourceRevision: saved.sourceRevision, lastSavedContent: saved.rawContent, currentEntry: saved, sections: next.sections, blocks: next.blocks });
      },
      startPinnedRun: async (block) => {
        await saveChain.catch(() => {});
        const state = get();
        const noteId = state.currentEntry?.id ?? state.loadedRouteId;
        if (!noteId || !notePersistence) throw new Error('Save the note before starting a workout.');
        try {
          const captured = await captureRun({ noteId, rawContent: state.content, blocks: state.noteBlocks, expectedSourceRevision: state.sourceRevision }, block, uuidv7(), undefined, notePersistence);
          set({ capturedRun: captured, noteBlocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision, currentEntry: { ...state.currentEntry, ...captured.note, updatedAt: Date.now(), targetDate: state.currentEntry?.targetDate ?? Date.now(), schemaVersion: 1 }, lastSavedContent: captured.note.rawContent, saveError: null });
          return captured.block;
        } catch (error) {
          set({ saveState: 'error', saveError: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },

      setActiveBlockId: (id) => set({ activeBlockId: id }),

      setSaveState: (saveState) => set({ saveState }),

      flushSave: async () => {
        if (autosaveHandle !== null) clearTimeoutFn(autosaveHandle);
        autosaveHandle = null;
        await runAutosave();
      },

      markSaved: (content) => set({ lastSavedContent: content, saveState: 'saved' }),

      // ─── Results & History (S1b) ──────────────────────────────

      setResults: (results) => set({ results }),

      resetResults: () => set({ results: [] }),

      setCurrentEntry: (entry) => {
        if (entry && entry.id !== get().currentEntry?.id) {
          const next = deriveWorkbenchDocumentState(entry.rawContent, { noteBlocks: entry.blocks, sourceRevision: Math.max(1, entry.sourceRevision ?? 0) });
          set({ currentEntry: entry, content: entry.rawContent, noteBlocks: next.noteBlocks, sections: next.sections, blocks: next.blocks, sourceRevision: entry.sourceRevision ?? 0, lastSavedContent: entry.rawContent });
        } else {
          set({ currentEntry: entry });
        }
      },

      setHistoryEntries: (entries) => set({ historyEntries: entries }),

      // ─── Panel Layout (S1c) ────────────────────────────────

      setPanelLayouts: (layouts) => set({ panelLayouts: layouts }),

      expandPanel: (viewId, panelId) => set((state) => {
        const viewLayout = state.panelLayouts[viewId] ?? {
          viewId,
          panelSpans: {},
          expandedPanelId: null,
        };
        const previousSpans = viewLayout.expandedPanelId
          ? viewLayout.panelSpans
          : { ...viewLayout.panelSpans };
        return {
          panelLayouts: {
            ...state.panelLayouts,
            [viewId]: {
              ...viewLayout,
              panelSpans: { ...previousSpans, [panelId]: 3 },
              expandedPanelId: panelId,
            },
          },
        };
      }),

      collapsePanel: (viewId) => set((state) => {
        const viewLayout = state.panelLayouts[viewId];
        if (!viewLayout) return state;
        return {
          panelLayouts: {
            ...state.panelLayouts,
            [viewId]: {
              ...viewLayout,
              expandedPanelId: null,
            },
          },
        };
      }),

      // ─── Attachments (S1d) ────────────────────────────────

      setAttachments: (attachments) => set({ attachments }),

      addAttachment: async (file) => {
        const notePersistence = deps.notePersistence;
        const provider = deps.provider;
        const state = get();
        const targetId = state.currentEntry?.id;
        if (!targetId || !provider?.capabilities.canWrite || !notePersistence) return;

        console.log(`[WorkbenchSession] Processing attachment: ${file.name}`);
        const metadata = await fileProcessor.process(file);
        const { v7: uuidv7 } = await import('uuid');

        console.log(`[WorkbenchSession] Saving attachment to entry ${targetId}`);
        await notePersistence.mutateNote(targetId, {
          attachments: {
            add: [{
              id: uuidv7(),
              label: metadata.label,
              mimeType: metadata.mimeType,
              data: metadata.data,
              timeSpan: metadata.timeSpan ?? { start: Date.now(), end: Date.now() },
            }],
          },
        });

        const entry = await notePersistence.getNote(targetId, {
          projection: 'workbench',
          includeAttachments: true,
        });
        set({ attachments: entry.attachments ?? [] });
        console.log('[WorkbenchSession] Attachment saved successfully');
      },

      deleteAttachment: async (id) => {
        const notePersistence = deps.notePersistence;
        const state = get();
        const targetId = state.currentEntry?.id;
        if (!targetId || !notePersistence) return;

        await notePersistence.mutateNote(targetId, {
          attachments: { remove: [id] },
        });
        const entry = await notePersistence.getNote(targetId, {
          projection: 'workbench',
          includeAttachments: true,
        });
        set({ attachments: entry.attachments ?? [] });
      },

      patchCurrentEntryResults: (results) => set((state) => {
        if (!state.currentEntry) return state;
        return { currentEntry: { ...state.currentEntry, results } };
      }),

      /**
       * Finish the Session pinned before runtime initialization. Editor-owned
       * runs pass their already-persisted result ID; no current source lookup.
       */
      completeWorkout: async (result, explicitResultId) => {
        const capture = get().capturedRun;
        const resultId = explicitResultId ?? capture?.session.id;
        if (!resultId || !notePersistence?.finishSession) throw new Error('The saved run pin is unavailable.');
        const saved = await notePersistence.finishSession(resultId, result, result.endTime);
        set(state => ({ results: [...state.results, result] }));
        return saved.id;
      },

      /**
       * `loadEntry` — the route-driven entry loader. Pulls a note from
       * persistence, hydrates `currentEntry` + `content`, and (for review
       * routes) patches the entry's `results` slice from the matching
       * Session. The single migration of the 4-source read.
       */
      loadEntry: async (params: {
        routeId: string | undefined;
        routeView: ViewMode | 'history' | 'analyze';
        routeSectionId?: string;
        routeResultId?: string;
        resultFromLocationState?: Sessions;
        initialActiveEntryId?: string;
        propInitialContent?: string;
        onLoaded?: (entry: HistoryRecord) => void;
      }) => {
        const notePersistence = deps.notePersistence;
        const provider = deps.provider;
        if (!notePersistence || !provider) return null;

        const { routeId, routeView, routeSectionId, routeResultId, resultFromLocationState, initialActiveEntryId, propInitialContent } = params;

        // Clear current note state while loading to avoid stale comparisons.
        get().setContent('');
        get().setBlocks([]);
        set({ currentEntry: null, loadedRouteId: routeId ?? null });

        if (routeId) {
          if (provider.mode === 'history' || provider.mode === 'static') {
            try {
              const resultSelection = routeResultId
                ? { mode: 'by-result-id' as const, resultId: routeResultId }
                : routeSectionId && routeView === 'review'
                  ? { mode: 'latest-for-section' as const, blockId: routeSectionId }
                  : { mode: 'latest' as const };
              const entry = await notePersistence.getNote(routeId, {
                projection: routeView === 'review' ? 'review' : 'workbench',
                includeAttachments: true,
                includeSections: true,
                resultSelection,
              }).catch(async (err: unknown) => {
                console.warn('[WorkbenchSession] Note persistence projection failed, falling back to provider entry:', {
                  routeId,
                  projection: routeView === 'review' ? 'review' : 'workbench',
                  resultSelectionMode: resultSelection.mode,
                  err,
                });
                return provider.getRecord(routeId);
              });
              if (entry) {
                const next = deriveWorkbenchDocumentState(entry.rawContent, { noteBlocks: entry.blocks, sourceRevision: Math.max(1, entry.sourceRevision ?? 0) });
                set({ currentEntry: entry, content: entry.rawContent, sections: next.sections, blocks: next.blocks, noteBlocks: next.noteBlocks, sourceRevision: entry.sourceRevision ?? 0, lastSavedContent: entry.rawContent, saveState: 'saved' });

                // For review routes, apply the route result selection.
                if (routeView === 'review') {
                  if (resultFromLocationState) {
                    set((s) =>
                      s.currentEntry
                        ? { currentEntry: { ...s.currentEntry, results: resultFromLocationState } }
                        : s,
                    );
                  }
                }

                params.onLoaded?.(entry);
                return entry;
              } else if (provider.mode === 'static') {
                const wodContent = await loadStaticWorkbenchContent(routeId);
                if (wodContent) {
                  get().setContent(wodContent);
                  return null;
                }
              }
            } catch (err) {
              console.error('[WorkbenchSession] Failed to load entry for ID:', routeId, err);
            }
          }
        } else if (initialActiveEntryId) {
          // No route, but caller supplied an initial entry id (used by
          // JournalPage when an entry is opened directly via state).
          deps.navigate?.({ type: 'goToPlan', noteId: initialActiveEntryId });
        }

        // Default fallback
        get().setContent(propInitialContent ?? '');
        return null;
      },


      setActiveSegmentIds: (ids) => set({ activeSegmentIds: ids }),
      setActiveStatementIds: (ids) => set({ activeStatementIds: ids }),

      // ─── Analytics (Step 2 — ADR-0002: reactive observer seams) ─────

      setAnalytics: (segments, groups) => set({
        analyticsSegments: segments,
        analyticsGroups: groups,
      }),

      appendOutputStatement: (output) => set((state) => {
        const next = [...state.outputStatementList, output];
        const { segments, groups } = getAnalyticsFromRuntime(state.runtime);
        // Reset the runtime-derived analytics; the live output list is the
        // source of truth while a runtime is mounted.
        if (state.runtime) {
          return { outputStatementList: next, analyticsSegments: segments, analyticsGroups: groups };
        }
        return { outputStatementList: next };
      }),

      clearOutputStatementList: () => set({
        outputStatementList: [],
      }),

      /**
       * `feedLogOutputs` — fallback path. When no runtime is mounted, the
       * review view derives analytics from `currentEntry.results.logs` via
       * `getAnalyticsFromLogs`. The Context's load effect calls this on
       * `currentEntry` change.
       */
      feedLogOutputs: (outputs, startTime) => {
        const { segments, groups } = getAnalyticsFromLogs(
          outputs as Parameters<typeof getAnalyticsFromLogs>[0],
          startTime,
        );
        set({ logOutputList: outputs, analyticsSegments: segments, analyticsGroups: groups });
      },
      toggleAnalyticsSegment: (id, modifiers, visibleIds) => set((state) => {
        const next = new Set(state.selectedAnalyticsIds);

        if (modifiers?.shiftKey && state.lastSelectedAnalyticsId !== null && visibleIds) {
          const idx1 = visibleIds.indexOf(state.lastSelectedAnalyticsId);
          const idx2 = visibleIds.indexOf(id);
          if (idx1 !== -1 && idx2 !== -1) {
            const start = Math.min(idx1, idx2);
            const end = Math.max(idx1, idx2);
            const rangeIds = visibleIds.slice(start, end + 1);
            rangeIds.forEach((rid) => next.add(rid));
          }
        } else if (modifiers?.ctrlKey) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.clear();
          next.add(id);
        }

        return {
          selectedAnalyticsIds: next,
          lastSelectedAnalyticsId: id,
        };
      }),

      // ─── Review Grid ──────────────────────────────────────────

      setUserOverride: (blockKey, metrics) => set((state) => {
        const next = new Map(state.userOutputOverrides);
        next.set(blockKey, MetricContainer.from(metrics, blockKey));
        return { userOutputOverrides: next };
      }),

      clearUserOverride: (blockKey) => set((state) => {
        const next = new Map(state.userOutputOverrides);
        next.delete(blockKey);
        return { userOutputOverrides: next };
      }),

      setGridViewPreset: (presetId) => set({ gridViewPreset: presetId }),

      // ─── Cross-panel ──────────────────────────────────────────

      setHoveredBlockKey: (key) => set({ hoveredBlockKey: key }),
      setDocumentItems: (items) => set({ documentItems: items }),
      setSelectedBlock: (block) => set({ selectedBlock: block, selectedBlockId: block?.id ?? null }),
      setSelectedBlockId: (id) => set({ selectedBlockId: id }),
      setCursorLine: (line) => set({ cursorLine: line }),
      setHighlightedLine: (line) => set({ highlightedLine: line }),
      setSubscriptionManager: (mgr) => {
        set({ subscriptionManager: mgr });
        sharedCastSessionManager.setSubscriptionRegistry(mgr);
      },
      setViewMode: (mode) => set({ viewMode: mode }),

      // ─── Runtime & execution setters ──────────────────────────

      setRuntime: (runtime) => {
        // Tear down any prior runtime subscriptions before wiring the new one.
        for (const dispose of subscriptionDisposers) dispose();
        subscriptionDisposers = [];

        if (runtime) {
          // Reset the live output list and re-derive analytics from the new
          // runtime's current snapshot.
          const initial = getAnalyticsFromRuntime(runtime);
          set({
            runtime,
            outputStatementList: [],
            analyticsSegments: initial.segments,
            analyticsGroups: initial.groups,
          });

          // Live: subscribe to output emissions. The session's
          // `appendOutputStatement` re-derives analytics on every emit.
          subscriptionDisposers.push(
            runtime.subscribeToOutput(() => {
              get().appendOutputStatement({});
            }),
          );

          // Live: subscribe to stack snapshots. Derive active segments from
          // `snapshot.blocks` + the current (leaf) block's `sourceIds`.
          subscriptionDisposers.push(
            runtime.subscribeToStack((snapshot) => {
              // StackSnapshot.blocks is top-first: blocks[0] is the current block.
              const leaf = snapshot.blocks[0];
              const segmentIds = new Set<number>();
              // Active segment identity is a hash of the block key; the prior
              // `useWorkbenchEffects` used the same `hashCode` helper. We
              for (const block of snapshot.blocks) {
                segmentIds.add(hashCode(block.key.toString()));
              }
              const statementIds = new Set<number>();
              if (leaf && Array.isArray(leaf.sourceIds)) {
                for (const id of leaf.sourceIds) statementIds.add(id);
              }
              set({ activeSegmentIds: segmentIds, activeStatementIds: statementIds });
            }),
          );
          const transport = getActiveCastTransport();
          if (transport?.connected) {
            const castSub = new ChromecastRuntimeSubscription(transport);
            subscriptionDisposers.push(
              runtime.subscribeToStack((snapshot) => castSub.onStackSnapshot(snapshot)),
              runtime.subscribeToOutput((output) => castSub.onOutput(output)),
              () => castSub.dispose(),
            );
            try {
              castSub.onStackSnapshot(runtime.getStackSnapshot());
            } catch {
              // ignore
            }
          }
        } else {
          // Runtime disposed. Clear the live list so analytics fall back to
          // persisted logs (if any) on the next read.
          set({ runtime: null, outputStatementList: [] });
        }
      },
      setExecution: (execution) => set({ execution }),
      setHandles: (handles) => set({ handles }),

      getNote: async (locator, options) => {
        if (!notePersistence) {
          throw new Error(
            '[WorkbenchSession] getNote called without a notePersistence port',
          );
        }
        return notePersistence.getNote(locator, options);
      },

      // ─── Reset ────────────────────────────────────────────────
      resetStore: () => {
        if (autosaveHandle !== null) {
          clearTimeoutFn(autosaveHandle);
          autosaveHandle = null;
        }
        for (const dispose of subscriptionDisposers) dispose();
        subscriptionDisposers = [];
        set({ ...initialState });
      },
    };
  });

  // Subscribe test listeners. Tests use this to assert that an autosave
  // debounce fired (e.g. after fast-forwarding the clock). The React provider
  // passes an empty list.
  if (listeners.length > 0) {
    store.subscribe((snapshot: WorkbenchSessionStore) => {
      for (const l of listeners) l(snapshot);
    });
  }

  return Object.assign(store, { __nowProvider: nowProvider });
}

/**
 * The default React-friendly store instance. Used when no
 * `WorkbenchSessionProvider` has installed a per-tree store (storybook shells,
 * module-load tests). The React provider replaces this with a store that has
 * real collaborators via `setActiveSessionStore`.
 */
const defaultSessionStore = createWorkbenchSessionStore();

// ─── Per-tree store injection ─────────────────────────────────────────

/**
 * The currently-active store. The React `WorkbenchSessionProvider` swaps this
 * for a per-tree store with real collaborators; tests + storybook shells use
 * the module-default store. Components call `useWorkbenchSession(selector)`
 * which reads from this ref.
 *
 * Default: the module-default store above.
 */
let activeStore: WorkbenchSessionStoreApi = defaultSessionStore;

/**
 * Replace the active store. Returns the prior store so the Provider can
 * restore it on unmount. Internal — only the Provider should call this.
 */
export function setActiveWorkbenchSessionStore(
  next: WorkbenchSessionStoreApi,
): WorkbenchSessionStoreApi {
  const prior = activeStore;
  activeStore = next;
  return prior;
}

/**
 * The currently-active store handle (vanilla `StoreApi`). Components consume
 * the session via `useWorkbenchSession(selector)`; tests + the React
 * `WorkbenchSessionProvider` reach the handle directly via
 * `getActiveWorkbenchSessionStore()` or `setActiveWorkbenchSessionStore()`.
 */
export function getActiveWorkbenchSessionStore(): WorkbenchSessionStoreApi {
  return activeStore;
}

/**
 * `useWorkbenchSession` — the React-bound selector hook. Reads from the
 * currently-active store (defaults to the module-load one, replaced per-tree
 * by `WorkbenchSessionProvider`). Stable across renders when the selected
 * slice is unchanged.
 */
export const useWorkbenchSession = <T,>(selector: (s: WorkbenchSessionStore) => T): T =>
  useStore(activeStore, selector);
/**
 * `WorkbenchSessionProvider` — React binding that installs a per-tree session
 * store with the given collaborators and tears it down on unmount. The
 * module-default store stays untouched, so tests + storybook shells that
 * mount without a provider keep reading from it.
 */
export interface WorkbenchSessionProviderProps {
  nowProvider?: INowProvider;
  notePersistence?: INotePersistence;
  provider?: IContentProvider;
  navigate?: NavigateFn;
  children: React.ReactNode;
}

export const WorkbenchSessionProvider: React.FC<WorkbenchSessionProviderProps> = ({
  nowProvider,
  notePersistence,
  provider,
  navigate,
  children,
}) => {
  const store = useMemo(
    () => createWorkbenchSessionStore({ nowProvider, notePersistence, provider, navigate }),
    [nowProvider, notePersistence, provider, navigate],
  );
  useEffect(() => {
    const prior = setActiveWorkbenchSessionStore(store);
    return () => {
      setActiveWorkbenchSessionStore(prior);
      store.getState().resetStore();
    };
  }, [store]);
  return React.createElement(React.Fragment, null, children);
};
