import { useSyncExternalStore } from 'react';
import type { EditorView } from '@codemirror/view';
import type { ScriptBlock } from '@/components/Editor/types';

export interface EditorInspectorSnapshot {
  drawerOpen: boolean;
  popoverOpen: boolean;
  mode: string;
  contextKind: 'workout' | 'query' | 'markdown';
  lineNum: number;
  selectedTokenId: string | null;
  tokens: Array<{ id: string; kind: string; raw: string; from: number; to: number }>;
  lintFixes: Array<{ id: string; raw: string; fixes: string[] }>;
}

export interface ActiveEditorBridge {
  noteId?: string;
  readonly: boolean;
  sourceRevision?: number;
  getValue: () => string;
  getView: () => EditorView | null;
  getBlocks: () => ScriptBlock[];
  applyEdit: (nextDoc: string, commit?: boolean) => Promise<void>;
  undoEdit: () => boolean;
  startLiveWorkout: (blockId?: string, autoStart?: boolean) => Promise<{
    started: boolean;
    blockId?: string;
    error?: string;
  }>;
  getInspectorState?: () => EditorInspectorSnapshot;
  setInspectorDrawer?: (open: boolean) => void;
  openTokenInspector?: (options?: { mode?: string; tokenIndex?: number }) => void;
  closeTokenInspector?: () => void;
}

export interface ActiveStreamBridge {
  route: string;
  defaultQuery: string;
  query: string;
  loading: boolean;
  layout: string;
  availableLayouts: readonly string[];
  groupBy?: string;
  month?: string;
  overlayMode?: 'all' | 'planned' | 'logged';
  setQuery: (nextQuery: string) => void;
  setLayout: (layout: string) => void;
  setGroupBy: (groupBy?: string) => void;
  setMonth?: (month: string) => void;
  setOverlayMode?: (mode: 'all' | 'planned' | 'logged') => void;
}

export interface ActiveExplorerBridge {
  draft: string;
  submitted: string;
  weeks: 4 | 8 | 16;
  loading: boolean;
  saveReady: boolean;
  setDraft: (wql: string) => void;
  submit: (wql?: string) => void;
  setWeeks: (weeks: 4 | 8 | 16) => void;
  openSaveDialog: () => void;
  openQuerySettings: () => void;
}

export interface ActiveResultsBridge {
  resultId: string;
  activeTab: 'splits' | 'movement' | 'compare' | 'raw';
  mobileViewMode: 'grid' | 'cards';
  sourceDrawerOpen: boolean;
  addToDashboardOpen: boolean;
  setTab: (tab: 'splits' | 'movement' | 'compare' | 'raw') => void;
  setMobileViewMode: (mode: 'grid' | 'cards') => void;
  openSourceDrawer: (open?: boolean) => void;
  openAddToDashboard: () => void;
  closeModals: () => void;
}

let currentEditor: ActiveEditorBridge | null = null;
const editorListeners = new Set<() => void>();

export function registerActiveEditorBridge(bridge: ActiveEditorBridge): () => void {
  currentEditor = bridge;
  for (const l of editorListeners) l();
  return () => {
    if (currentEditor === bridge) {
      currentEditor = null;
      for (const l of editorListeners) l();
    }
  };
}

export function getActiveEditorBridge(): ActiveEditorBridge | null {
  return currentEditor;
}

export function subscribeActiveEditorBridge(listener: () => void): () => void {
  editorListeners.add(listener);
  return () => {
    editorListeners.delete(listener);
  };
}

export function useActiveEditorBridge(): ActiveEditorBridge | null {
  return useSyncExternalStore(subscribeActiveEditorBridge, getActiveEditorBridge, () => null);
}

let currentStream: ActiveStreamBridge | null = null;
const streamListeners = new Set<() => void>();

export function registerActiveStreamBridge(bridge: ActiveStreamBridge): () => void {
  currentStream = bridge;
  for (const l of streamListeners) l();
  return () => {
    if (currentStream === bridge) {
      currentStream = null;
      for (const l of streamListeners) l();
    }
  };
}

export function getActiveStreamBridge(): ActiveStreamBridge | null {
  return currentStream;
}

export function subscribeActiveStreamBridge(listener: () => void): () => void {
  streamListeners.add(listener);
  return () => {
    streamListeners.delete(listener);
  };
}

export function useActiveStreamBridge(): ActiveStreamBridge | null {
  return useSyncExternalStore(subscribeActiveStreamBridge, getActiveStreamBridge, () => null);
}

let currentExplorer: ActiveExplorerBridge | null = null;
const explorerListeners = new Set<() => void>();

export function registerActiveExplorerBridge(bridge: ActiveExplorerBridge): () => void {
  currentExplorer = bridge;
  for (const l of explorerListeners) l();
  return () => {
    if (currentExplorer === bridge) {
      currentExplorer = null;
      for (const l of explorerListeners) l();
    }
  };
}

export function getActiveExplorerBridge(): ActiveExplorerBridge | null {
  return currentExplorer;
}

export function subscribeActiveExplorerBridge(listener: () => void): () => void {
  explorerListeners.add(listener);
  return () => {
    explorerListeners.delete(listener);
  };
}

export function useActiveExplorerBridge(): ActiveExplorerBridge | null {
  return useSyncExternalStore(subscribeActiveExplorerBridge, getActiveExplorerBridge, () => null);
}

let currentResults: ActiveResultsBridge | null = null;
const resultsListeners = new Set<() => void>();

export function registerActiveResultsBridge(bridge: ActiveResultsBridge): () => void {
  currentResults = bridge;
  for (const l of resultsListeners) l();
  return () => {
    if (currentResults === bridge) {
      currentResults = null;
      for (const l of resultsListeners) l();
    }
  };
}

export function getActiveResultsBridge(): ActiveResultsBridge | null {
  return currentResults;
}

export function subscribeActiveResultsBridge(listener: () => void): () => void {
  resultsListeners.add(listener);
  return () => {
    resultsListeners.delete(listener);
  };
}

export function useActiveResultsBridge(): ActiveResultsBridge | null {
  return useSyncExternalStore(subscribeActiveResultsBridge, getActiveResultsBridge, () => null);
}

let busyCounter = 0;
const busyListeners = new Set<() => void>();

export function setSurfaceBusy(active: boolean): () => void {
  if (!active) return () => {};
  busyCounter += 1;
  for (const l of busyListeners) l();
  let released = false;
  return () => {
    if (!released) {
      released = true;
      busyCounter = Math.max(0, busyCounter - 1);
      for (const l of busyListeners) l();
    }
  };
}

export function getSurfaceBusy(): boolean {
  return busyCounter > 0;
}

export function subscribeSurfaceBusy(listener: () => void): () => void {
  busyListeners.add(listener);
  return () => {
    busyListeners.delete(listener);
  };
}

export function useSurfaceBusy(): boolean {
  return useSyncExternalStore(subscribeSurfaceBusy, getSurfaceBusy, () => false);
}
