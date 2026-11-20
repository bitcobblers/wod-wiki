import React, { useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import {
  useActiveEditorBridge,
  useActiveExplorerBridge,
  useActiveResultsBridge,
  useActiveStreamBridge,
  useSurfaceBusy,
} from '@/agent/surfaceBridges';
import { getClockSnapshot, subscribeClock } from '@/clock/clockCommands';
import { useFeedImportPending, useFeedReadiness } from '@/services/feed/feedReadiness';
import { useStreamResults } from '../views/stream/streamResults';

function safeJsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export interface AgentViewState {
  schemaVersion: string;
  hydrated: boolean;
  status: 'loading' | 'ready';
  feedReadiness: string;
  importPending: boolean;
  route: {
    pathname: string;
    search: string;
    hash: string;
  };
  stream: {
    route: string;
    query: string;
    defaultQuery: string;
    layout: string;
    availableLayouts: string[];
    groupBy: string | null;
    loading: boolean;
    totalUnbatchedCount: number | null;
    sampleEntries: Array<{
      id: string;
      title: string;
      date: string | null;
      notebookId: string | null;
    }>;
  } | null;
  explorer: {
    draft: unknown;
    submitted: unknown;
    weeks: unknown;
    loading: boolean;
    saveReady: boolean;
  } | null;
  editor: {
    noteId: string | null;
    readonly: boolean;
    sourceRevision: number | null;
    workoutBlockIds: string[];
  } | null;
  results: {
    resultId: string;
    activeTab: 'splits' | 'movement' | 'compare' | 'raw';
    mobileViewMode: 'grid' | 'cards';
    sourceDrawerOpen: boolean;
    addToDashboardOpen: boolean;
  } | null;
  clock: unknown;
}

/**
 * Layer 2 deterministic page-state projection:
 * Exposes structured route, readiness, unbatched stream summary, active editor
 * metadata, and live clock snapshot in `<script id="agent-view-state" type="application/json">`
 * so browser agents without WebMCP never have to scrape virtualized/batched DOM rows.
 */
export const AgentStateScript: React.FC = () => {
  const location = useLocation();
  const feedReadiness = useFeedReadiness();
  const importPending = useFeedImportPending();
  const surfaceBusy = useSurfaceBusy();
  const streamBridge = useActiveStreamBridge();
  const explorerBridge = useActiveExplorerBridge();
  const streamResults = useStreamResults();
  const editorBridge = useActiveEditorBridge();
  const resultsBridge = useActiveResultsBridge();
  const clockSnapshot = useSyncExternalStore(subscribeClock, getClockSnapshot, () => null);

  const isBusy = surfaceBusy || feedReadiness === 'preparing' || importPending;

  const serialized = useMemo(() => {
    const matchedStream =
      streamBridge && streamResults && streamResults.pathname === location.pathname
        ? streamResults
        : null;

    const payload = {
      schemaVersion: '1.0',
      hydrated: true,
      status: isBusy ? 'loading' : 'ready',
      feedReadiness,
      importPending,
      route: {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      stream: streamBridge
        ? {
            route: streamBridge.route,
            query: streamBridge.query,
            defaultQuery: streamBridge.defaultQuery,
            layout: streamBridge.layout,
            availableLayouts: streamBridge.availableLayouts,
            groupBy: streamBridge.groupBy ?? null,
            loading: streamBridge.loading,
            totalUnbatchedCount: matchedStream ? matchedStream.entries.length : null,
            sampleEntries: matchedStream
              ? matchedStream.entries.slice(0, 25).map((e) => ({
                  id: e.id,
                  title: e.title,
                  date: e.date ?? null,
                  notebookId: e.notebookId ?? null,
                }))
              : [],
          }
        : null,
      explorer: explorerBridge
        ? {
            draft: explorerBridge.draft,
            submitted: explorerBridge.submitted,
            weeks: explorerBridge.weeks,
            loading: explorerBridge.loading,
            saveReady: explorerBridge.saveReady,
          }
        : null,
      editor: editorBridge
        ? {
            noteId: editorBridge.noteId ?? null,
            readonly: editorBridge.readonly,
            sourceRevision: editorBridge.sourceRevision ?? null,
            workoutBlockIds: editorBridge.getBlocks().map((b) => b.id),
          }
        : null,
      results: resultsBridge
        ? {
            resultId: resultsBridge.resultId,
            activeTab: resultsBridge.activeTab,
            mobileViewMode: resultsBridge.mobileViewMode,
            sourceDrawerOpen: resultsBridge.sourceDrawerOpen,
            addToDashboardOpen: resultsBridge.addToDashboardOpen,
          }
        : null,
      clock: clockSnapshot,
    };

    return safeJsonForScriptTag(payload);
  }, [
    isBusy,
    feedReadiness,
    importPending,
    location.pathname,
    location.search,
    location.hash,
    streamBridge,
    explorerBridge,
    streamResults,
    editorBridge,
    resultsBridge,
    clockSnapshot,
  ]);

  return (
    <script
      id="agent-view-state"
      type="application/json"
      dangerouslySetInnerHTML={{ __html: serialized }}
    />
  );
};
