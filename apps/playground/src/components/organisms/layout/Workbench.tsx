/**
 * Workbench - Responsive workbench combining desktop and mobile views
 *
 * This component implements the "sliding viewport" model where the app is a
 * viewport sliding across a horizontal strip of panels:
 *
 * PLAN:    [Editor 2/3][EditorIndex 1/3]
 * TRACK:   [Timer 2/3][TimerIndex 1/3]
 * REVIEW:  [AnalyticsIndex 1/3][Timeline 2/3]
 *
 * Responsive behavior:
 * - Desktop (≥1024px): Full sliding strip with side-by-side panels
 * - Tablet (768-1024px): Stacked with bottom sheets
 * - Mobile (<768px): Full-screen slides, 50/50 split for Track
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { planPath } from '@/lib/routes';
import { resolveWorkbenchProvider } from '@/app/workbench/workbenchProviders';
import type { NoteEditorProps } from '@/components/organisms/editor/NoteEditor';
import { DebugModeProvider } from '@/contexts/DebugModeContext';
import { PaletteShell } from '@/components/organisms/command-palette/PaletteShell';
import { Upload } from 'lucide-react';
import { useTutorialStore } from '@/hooks/useTutorialStore';
import { toNotebookTag } from '@/types/notebook';
import { NoteDetailsPanel } from '@/components/organisms/workbench/NoteDetailsPanel';
import { useTheme } from '@/contexts/ThemeProvider';
import { ResponsiveViewport } from '@/panels/panel-system/ResponsiveViewport';
import { createPlanView, createTrackView, createReviewView } from '@/panels/panel-system/viewDescriptors';
import type { ViewDescriptor } from '@/panels/panel-system/types';
import type { ViewMode } from '@/panels/panel-system/ResponsiveViewport';
import { WorkbenchSessionProvider, useWorkbenchSession } from '@/stores/workbenchSessionStore';
import { useWorkbenchSessionStore } from '@/stores/workbenchSessionStore.shim';
import { RuntimeLifecycleProvider } from '@/contexts/RuntimeLifecycleProvider';
import { useWorkbenchSessionLifecycle } from '@/hooks/useWorkbenchSessionLifecycle';
import { useWorkbenchSync } from '@/components/layout/useWorkbenchSync';
import { useDebugMode } from '@/contexts/DebugModeContext';
import { runtimeFactory } from '@/hooks/useRuntimeFactory';
import type { ContentProviderMode, IContentProvider } from '@/types/content-provider';
import type { ScriptBlock } from '@/components/Editor/types';
import type { Sessions } from '@/types/history';
import { workbenchEventBus } from '@/hooks/useBrowserServices';
import { getWorkbenchDocumentTitle } from '@/app/workbench/workbenchEntryLoader';
import { WorkbenchCastBridge } from '@/components/organisms/cast/WorkbenchCastBridge';
import { LibraryCastBridge } from '@/components/organisms/cast/LibraryCastBridge';
import { useScreenMode } from '@/panels/panel-system/useScreenMode';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import type { ProjectionResult } from '@bitcobblers/wod-wiki-engine';
import { WorkbenchHeader } from '@/components/organisms/workbench/WorkbenchHeader';
import { WorkbenchTemplate } from '@/templates';
import type { Attachment } from '@/types/storage';

declare const __APP_VERSION__: string | undefined;
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.dev';

import { PlanPanel } from '@/panels/plan-panel';
import { TimerScreen } from '@/panels/track-panel';
import { ResultsView } from '@/components/organisms/review/review-grid-index';
import type { Segment } from '@bitcobblers/wod-wiki-engine';

export interface WorkbenchProps extends Omit<NoteEditorProps, 'onBlocksChange' | 'onActiveBlockChange' | 'onCursorPositionChange' | 'highlightedLine' | 'value' | 'onChange' | 'mode'> {
  initialContent?: string;
  initialActiveEntryId?: string;
  initialViewMode?: ViewMode;
  mode?: ContentProviderMode;
  provider?: IContentProvider;
  /** Called when the search button / Ctrl+/ is triggered. Caller opens the palette with context-appropriate sources. */
  onSearch?: () => void;
  hidePlanUnlessDebug?: boolean;
}

const WorkbenchContent: React.FC<WorkbenchProps> = ({
  initialContent,
  theme: propTheme,
  hidePlanUnlessDebug = false,
  provider,
  notePersistence,
  ...editorProps
}) => {
  // Step 3's thin adapter — reads its inputs from the Workbench Session
  // directly. No second `useWorkbench()` call: the bindings below feed both
  // the adapter and the rest of the body.
  const viewMode = useWorkbenchSession((s) => s.viewMode);
  const setViewMode = useWorkbenchSession((s) => s.setViewMode);
  const content = useWorkbenchSession((s) => s.content);
  const setContent = useWorkbenchSession((s) => s.setContent);
  const setBlocks = useWorkbenchSession((s) => s.setBlocks);
  const noteBlocks = useWorkbenchSession(state => state.noteBlocks);
  const sourceRevision = useWorkbenchSession(state => state.sourceRevision);
  const setEditorIdentity = useWorkbenchSession(state => state.setEditorIdentity);
  const acceptSaved = useWorkbenchSession(state => state.acceptSaved);
  const restoreBlock = useWorkbenchSession(state => state.restoreBlock);
  const flushSave = useWorkbenchSession(state => state.flushSave);
  const saveError = useWorkbenchSession(state => state.saveError);
  const activeBlockId = useWorkbenchSession((s) => s.activeBlockId);
  const setActiveBlockId = useWorkbenchSession((s) => s.setActiveBlockId);
  const setSelectedBlockId = useWorkbenchSession((s) => s.setSelectedBlockId);
  const saveState = useWorkbenchSession((s) => s.saveState);
  const panelLayouts = useWorkbenchSession((s) => s.panelLayouts);
  const attachments = useWorkbenchSession((s) => s.attachments);
  const addAttachment = useWorkbenchSession((s) => s.addAttachment);
  const deleteAttachment = useWorkbenchSession((s) => s.deleteAttachment);
  const completeWorkout = useWorkbenchSession((s) => s.completeWorkout);
  const contextEntry = useWorkbenchSession((s) => s.currentEntry);
  useWorkbenchSessionLifecycle({
    viewMode,
    selectedBlock: useWorkbenchSession((s) => s.selectedBlock),
    completeWorkout,
    startWorkout: useWorkbenchSession((s) => s.handles.handleStartWorkoutAction),
  });
  const navigate = useNavigate();
  const { noteId: routeId, sectionId: _routeSectionId, resultId: _routeResultId } = useParams<{
    noteId: string;
    sectionId: string;
    resultId: string;
  }>();
  const { theme, setTheme } = useTheme();
  const { isDebugMode } = useDebugMode();

  // `useWorkbench` was destructured above (hoisted for the adapter).

  const handleDownload = useCallback((att: Attachment) => {
    const blob = att.data instanceof ArrayBuffer
      ? new Blob([att.data], { type: att.mimeType })
      : new Blob([att.data], { type: att.mimeType });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.label;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);
  // `provider` is destructured above (one call, hoisted for the adapter).

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = React.useRef(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      for (const file of files) {
        await addAttachment(file);
      }
      // Reset input so the same file can be uploaded again if needed
      e.target.value = '';
    }
  }, [addAttachment]);

  useEffect(() => {
    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    };

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    };

    const handleWindowDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
          await addAttachment(file);
        }
      }
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [addAttachment]);

  // Current entry is owned by the Workbench Session (S1b). Read it from the
  // store; tag bookkeeping for the notebook toggle stays local because it
  // only matters for the UI header button.
  const currentEntry = contextEntry;
  const _loadEntry = useWorkbenchSession((s) => s.loadEntry);
  const _feedLogOutputs = useWorkbenchSession((s) => s.feedLogOutputs);
  const [currentEntryTags, setCurrentEntryTags] = useState<string[]>([]);
  useEffect(() => {
    if (currentEntry) {
      setCurrentEntryTags(currentEntry.tags);
    }
  }, [currentEntry]);

  // Details panel state
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleNotebookToggleForCurrent = useCallback(async (notebookId: string, isAdding: boolean) => {
    if (!routeId || !provider || provider.mode !== 'history') return;
    const tag = toNotebookTag(notebookId);
    const newTags = isAdding
      ? [...currentEntryTags, tag]
      : currentEntryTags.filter((t) => t !== tag);
    await provider.updateEntry(routeId, { tags: newTags });
    setCurrentEntryTags(newTags);
    if (currentEntry) {
      useWorkbenchSessionStore.getState().setCurrentEntry({ ...currentEntry, tags: newTags });
    }
  }, [routeId, provider, currentEntryTags, currentEntry]);

  // Update document title based on current entry or route
  useEffect(() => {
    document.title = getWorkbenchDocumentTitle(currentEntry, routeId);
  }, [currentEntry, routeId]);

  // Consume synced state from Zustand store (via useWorkbenchEffects)
  const {
    runtime,
    execution,
    activeSegmentIds,
    hoveredBlockKey,
    setHoveredBlockKey,
    selectedBlock,
    documentItems,
    highlightedLine: _highlightedLine,
    setHighlightedLine,
    setCursorLine: _setCursorLine,
    analyticsSegments,
    analyticsGroups,
    selectedAnalyticsIds,
    toggleAnalyticsSegment,
    handleStart,
    handlePause,
    handleStop,
    handleNext,
    handleStartWorkoutAction,
  } = useWorkbenchSync();
  const handleBlockHover = useCallback((blockKey: string | null) => setHoveredBlockKey(blockKey), [setHoveredBlockKey]);
  const handleBlockClick = useCallback(
    (blockKey: string) => workbenchEventBus.emitScrollToBlock(blockKey, 'track'),
    [],
  );

  // Handle NAVIGATE_TO requests from syntax links
  useEffect(() => {
    const cleanup = workbenchEventBus.onNavigateTo(({ entryId, view: _view }) => {
      navigate(planPath(entryId));
    });
    return () => { cleanup(); };
  }, [navigate]);

  const { startTutorial } = useTutorialStore();

  // Responsive screen mode
  const screenMode = useScreenMode();
  const isMobile = screenMode === 'mobile';

  // Sync theme from props
  useEffect(() => {
    if (!propTheme) return;
    const targetTheme = (propTheme === 'vs-dark' || propTheme === 'wod-dark') ? 'dark' : 'light';
    if (theme !== 'system' && theme !== targetTheme) {
      setTheme(targetTheme);
    }
  }, [propTheme, theme, setTheme]);

  // Handle plan panel visibility constraints
  useEffect(() => {
    const showPlan = !hidePlanUnlessDebug || isDebugMode;
    if (!showPlan && viewMode === 'plan') {
      setViewMode('track');
    }
  }, [hidePlanUnlessDebug, isDebugMode, viewMode, setViewMode]);

  // Inline handleBlockHover/handleBlockClick declared above.
  // Handle SCROLL_TO_BLOCK requests
  useEffect(() => {
    const cleanup = workbenchEventBus.onScrollToBlock(({ blockId }) => {
      // Find line from documentItems
      const item = documentItems.find(i => i.id === blockId);
      if (item) {
        const line = item.startLine;
        // Scroll logic will be handled by PlanPanel or via event bus in the future
        setHighlightedLine(line);
        setTimeout(() => setHighlightedLine(null), 2000);
      }
    });

    return () => { cleanup(); };
  }, [documentItems, setHighlightedLine]);


  const planPanel = useMemo(() => (
    <PlanPanel
      sourceNoteId={contextEntry?.id}
      notePersistence={notePersistence}
      noteBlocks={noteBlocks}
      sourceRevision={sourceRevision}
      onIdentityChange={setEditorIdentity}
      onSaved={acceptSaved}
      beforeRun={async () => { await flushSave(); return useWorkbenchSessionStore.getState().sourceRevision; }}
      onRevert={restoreBlock}
      initialContent={initialContent}
      value={content}
      onStartWorkout={handleStartWorkoutAction}
      setBlocks={setBlocks}
      setContent={setContent}
    />
  ), [contextEntry?.id, initialContent, content, noteBlocks, sourceRevision, notePersistence, setEditorIdentity, acceptSaved, flushSave, restoreBlock, handleStartWorkoutAction, setBlocks, setContent]);

  const trackPrimaryPanel = useMemo(() => (
    <TimerScreen
      runtime={runtime}
      execution={execution}
      selectedBlock={selectedBlock}
      documentItems={documentItems}
      activeBlockId={activeBlockId || undefined}
      onSelectBlock={(blockId) => blockId && setSelectedBlockId(blockId)}
      onSetActiveBlockId={setActiveBlockId}
      onBlockHover={handleBlockHover}
      onBlockClick={handleBlockClick}
      onStop={handleStop}
      onStart={handleStart}
      onPause={handlePause}
      onNext={handleNext}
      activeSegmentIds={activeSegmentIds}
      content={content}
      onStartWorkout={handleStartWorkoutAction}
      setBlocks={setBlocks}
    />
  ), [runtime, execution, selectedBlock, documentItems, activeBlockId, setSelectedBlockId, setActiveBlockId, handleBlockHover, handleBlockClick, handleStop, handleStart, handlePause, handleNext, activeSegmentIds, content, handleStartWorkoutAction, setBlocks]);

  const reviewGridPanel = useMemo(() => (
    <div id="tutorial-review-grid" className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ResultsView
          runtime={runtime}
          segments={analyticsSegments}
          selectedSegmentIds={selectedAnalyticsIds}
          onSelectSegment={toggleAnalyticsSegment}
          groups={analyticsGroups}
          projections={extractProjections(analyticsSegments)}
          hoveredBlockKey={hoveredBlockKey}
          onHoverBlockKey={setHoveredBlockKey}
        />
      </div>
    </div>
  ), [runtime, analyticsSegments, selectedAnalyticsIds, toggleAnalyticsSegment, analyticsGroups, hoveredBlockKey, setHoveredBlockKey]);

  const viewDescriptors = useMemo(() => {
    const showPlan = !hidePlanUnlessDebug || isDebugMode;

    const all = [
      showPlan && createPlanView(planPanel),
      createTrackView(trackPrimaryPanel, null),
      createReviewView(reviewGridPanel),
    ].filter((v): v is ViewDescriptor => Boolean(v));

    // Branch: If we are viewing a template, only show Plan (View)
    if (currentEntry?.type === 'template') {
      const planView = createPlanView(planPanel);
      return [{
        ...planView,
        title: 'View',
        icon: <span className="h-4 w-4 flex items-center justify-center text-xs">🔒</span>,
      }];
    }

    return all;
  }, [
    planPanel,
    trackPrimaryPanel,
    reviewGridPanel,
    currentEntry?.type,
    hidePlanUnlessDebug,
    isDebugMode,
  ]);

  return (
    <React.Fragment>
      {saveError && <p role="alert" className="p-3 text-sm text-destructive">Save failed. {saveError} Your draft is kept.</p>}
      <WorkbenchTemplate
        dragOverlay={
          isDragging ? (
            <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-4 border-dashed border-primary">
              <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200 pointer-events-none">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <p className="text-xl font-medium">Drop files to attach to this note</p>
                <p className="text-sm text-muted-foreground">GPX and other files supported</p>
              </div>
            </div>
          ) : undefined
        }
        header={
          <WorkbenchHeader
            appVersion={appVersion}
            isMobile={isMobile}
            currentEntry={currentEntry}
            saveState={saveState}
            onSearch={editorProps.onSearch}
            viewMode={viewMode}
            views={viewDescriptors.map(v => ({ id: v.id, label: v.label ?? v.title ?? v.id, icon: v.icon }))}
            onViewChange={(id) => setViewMode(id as ViewMode)}
            attachments={attachments}
            fileInputRef={fileInputRef}
            onFileSelect={handleFileSelect}
            onDownloadAttachment={handleDownload}
            onDeleteAttachment={deleteAttachment}
            currentEntryTags={currentEntryTags}
            onNotebookToggle={handleNotebookToggleForCurrent}
            isDetailsOpen={isDetailsOpen}
            onToggleDetails={() => setIsDetailsOpen(!isDetailsOpen)}
            onStartTutorial={(vm) => startTutorial(vm as TutorialType)}
          />
        }
        sidePanel={
          <NoteDetailsPanel
            isOpen={isDetailsOpen}
            onClose={() => setIsDetailsOpen(false)}
            entry={currentEntry}
            provider={provider}
            onEntryUpdate={(updated) => useWorkbenchSessionStore.getState().setCurrentEntry(updated)}
            onClone={async (targetDate?: number) => {
              if (routeId && provider && provider.mode === 'history') {
                const cloned = await provider.cloneEntry(routeId, targetDate);
                navigate(planPath(cloned.id));
              }
            }}
          />
        }
      >
        <ResponsiveViewport
          views={viewDescriptors}
          currentView={viewMode}
          onViewChange={setViewMode}
          panelLayouts={panelLayouts}
        />
      </WorkbenchTemplate>
      <PaletteShell />
    </React.Fragment>
  );
};

export const Workbench: React.FC<WorkbenchProps> = (props) => {
  const { initialContent = '', initialActiveEntryId, initialViewMode, mode: _mode = 'static', provider: externalProvider } = props;
  // Resolve the content provider + persistence once. The session store
  // needs both as collaborators; we hand them to `WorkbenchSessionProvider`
  // and also forward the resolved provider to `WorkbenchContent` for the
  // adapter + clone/entry-update paths that talk to it directly.
  const resolved = useMemo(
    () => resolveWorkbenchProvider(initialContent, externalProvider),
    [initialContent, externalProvider],
  );
  return (
    <DebugModeProvider>
      <WorkbenchSessionProvider
        provider={resolved.provider}
        notePersistence={resolved.notePersistence}
      >
        <RuntimeLifecycleProvider factory={runtimeFactory}>
          <WorkbenchCastBridge />
          <LibraryCastBridge />
          <WorkbenchContent {...props} initialContent={initialContent} initialActiveEntryId={initialActiveEntryId} initialViewMode={initialViewMode} provider={resolved.provider} notePersistence={resolved.notePersistence} />
        </RuntimeLifecycleProvider>
      </WorkbenchSessionProvider>
    </DebugModeProvider>
  );
};


// ─── Helper: Extract projections from analytics segments ───────

function extractProjections(segments: Segment[]): ProjectionResult[] {
  return segments
    .filter(s => (s as unknown as { context?: { outputType?: string } }).context?.outputType === 'analytics')
    .map(s => {
      const metrics = s.metrics?.toArray() || [];
      const labelMetric = metrics.find(m => m.type === MetricType.Label);
      const valueMetric = metrics.find(m => m.type !== MetricType.Label);

      return {
        name: labelMetric?.value?.toString() || labelMetric?.image || 'Stat',
        value: (valueMetric?.value as number) || 0,
        unit: valueMetric?.unit || '',
        metricType: valueMetric?.type,
        origin: valueMetric?.origin || 'analyzed',
        timeSpan: { started: s.startTime, ended: s.endTime }
      } as ProjectionResult;
    });
}