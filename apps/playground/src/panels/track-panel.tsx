import React from 'react';
import { TimerIndexPanel } from '@/components/organisms/layout/TimerIndexPanel';
import { TimerDisplay } from '@/panels/wallclock-panel';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';
import { VisualStatePanel } from '@/panels/visual-state-panel';
import { useParams } from 'react-router-dom';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { UseRuntimeExecutionReturn } from '@bitcobblers/wod-wiki-engine/react';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { cn } from '@/lib/utils';
import { WorkoutPreviewPanel } from '@/components/organisms/workbench/WorkoutPreviewPanel';
import { TrackViewShell } from '@/components/organisms/workout/TrackViewShell';
import { TimerSurface } from '@/components/organisms/workout/TimerSurface';
import type { SectionType } from '@/components/Editor/types/section';
import type { ScriptBlock } from '@/components/Editor/types';
import { useUserOverrides } from '@/components/organisms/review/useUserOverrides';
import { useCollectionMetrics, resolveValueSelection } from '@/hooks/useCollectionMetrics';
import { CollectionWizard } from '@/components/organisms/review/CollectionWizard';
import { useLiveClockAuthority } from '@/clock/useLiveClockAuthority';
import { ClockCommandBoard } from '@/clock/ClockCommandBoard';

export interface TrackPanelProps {
  runtime: IScriptRuntime | null;
  execution: UseRuntimeExecutionReturn;
  selectedBlock: ScriptBlock | null;
  activeSegmentIds: Set<number>;
  activeStatementIds: Set<number>;
  hoveredBlockKey: string | null;
  documentItems: ScriptBlock[];
  activeBlockId: string | undefined;
  onBlockHover: (blockKey: string | null) => void;
  onBlockClick: (blockKey: string) => void;
  onSelectBlock: (blockId: string | null) => void;
  onSetActiveBlockId: (blockId: string | null) => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  /** Raw markdown content for the preview panel */
  content?: string;
  /** Called when user clicks Run on a workout block in the preview */
  onStartWorkout?: (block: ScriptBlock) => void;
  /**
   * Optional section-type filter for the preview panel.
   * Defaults to `['time']` to show only runnable blocks.
   */
  previewFilter?: SectionType[];
  /** Callback to update parsed blocks */
  setBlocks?: (blocks: ScriptBlock[]) => void;
}

export const SessionHistory: React.FC<Pick<TrackPanelProps, 'runtime' | 'activeSegmentIds' | 'activeStatementIds' | 'hoveredBlockKey' | 'execution'>> = ({
  runtime,
  activeSegmentIds,
  activeStatementIds,
  hoveredBlockKey,
  execution
}) => {
  return (
    <TimerIndexPanel
      runtime={runtime as unknown as ScriptRuntime | null}
      activeSegmentIds={activeSegmentIds}
      activeStatementIds={activeStatementIds}
      highlightedBlockKey={hoveredBlockKey}
      autoScroll={execution.status === 'running'}
      workoutStartTime={execution.startTime}
      className="h-full"
    />
  );
};

export const TimerScreen: React.FC<TrackPanelProps> = ({
  runtime,
  execution,
  selectedBlock,
  onBlockHover,
  onBlockClick,
  onStart,
  onPause,
  onStop,
  onNext,
  // activeSegmentIds, // Unused
  // activeStatementIds, // Unused
  // hoveredBlockKey, // Unused
  content,
  onStartWorkout,
  setBlocks,
  previewFilter = ['time'],
}) => {
  const { isCompact, isFull } = usePanelSize();
  const { sectionId } = useParams<{ sectionId?: string }>();
  const isNotFound = sectionId === 'notfound';
  const [wizardDismissed, setWizardDismissed] = React.useState(false);
  // Once items were non-empty, the wizard stays mounted through the last
  // field so its Ready panel can host the explicit Start.
  const wizardEngagedRef = React.useRef(false);

  const { overrides, setOverride } = useUserOverrides(true);
  const { collectionItems } = useCollectionMetrics([], overrides, runtime?.script);

  React.useEffect(() => {
    if (collectionItems.length > 0) wizardEngagedRef.current = true;
  }, [collectionItems.length]);
  // A different runtime means a different script — the engagement resets.
  React.useEffect(() => {
    wizardEngagedRef.current = false;
    setWizardDismissed(false);
  }, [runtime]);
  React.useEffect(() => {
    if (execution.status !== 'idle') setWizardDismissed(false);
  }, [execution.status]);

  const showWizard =
    execution.status === 'idle' && !wizardDismissed &&
    (collectionItems.length > 0 || wizardEngagedRef.current);

  const clock = useLiveClockAuthority({
    runtime,
    executionStatus: execution.status,
    enabled: !showWizard && runtime !== null && execution.status !== 'completed',
    actions: {
      next: onNext,
      start: onStart,
      playback: () => {
        if (execution.status === 'running') onPause();
        else onStart();
      },
      stop: onStop,
    },
  });

  const clockBoard = clock.snapshot ? (
    <ClockCommandBoard snapshot={clock.snapshot} dispatch={clock.dispatch} />
  ) : null;

  // Timer/Clock component (Detail tier, full containers only — ADR 0003)
  const timerDisplay = (
    <TimerDisplay
      elapsedMs={execution.elapsedTime}
      hasActiveBlock={!!selectedBlock}
      onStart={onStart}
      onPause={onPause}
      onStop={onStop}
      onNext={onNext}
      isRunning={execution.status === 'running'}
      isPaused={execution.status === 'paused'}
      canNext={clock.snapshot?.canNext}
      onBlockHover={onBlockHover}
      onBlockClick={onBlockClick}
      enableDisplayStack={!!runtime}
    />
  );

  if (showWizard) {
    return (
      <CollectionWizard
        items={collectionItems}
        onSave={(item, val) => {
          // Statement resolution is the required pre-JIT write; the override
          // store stays for display grids only. Pre-run targets are required:
          // skip never clears a draft here.
          if (!resolveValueSelection(runtime?.script, item, val, 'target')) throw new Error('Enter a valid target before starting');
          if (item.kind === 'value') {
            setOverride(item.blockKey, item.metricType, val);
          }
        }}
        onSkip={() => {}}
        onStart={onStart}
        onClose={() => setWizardDismissed(true)}
        mode="pre-run"
      />
    );
  }

  const screenContent = runtime ? (
    <ScriptRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 flex-col" data-clock-panel>
        <div className="min-h-0 flex-1 overflow-hidden">
          {isCompact || !isFull ? (
            // Minimal (compact) / General (wide) — ADR 0003. The surface owns the
            // screen; the VisualStatePanel is Detail-tier chrome and stays with the
            // full layout only.
            <TimerSurface
              elapsedMs={execution.elapsedTime}
              hasActiveBlock={!!selectedBlock}
              onStart={onStart}
              onPause={onPause}
              onStop={onStop}
              onNext={onNext}
              isRunning={execution.status === 'running'}
              isPaused={execution.status === 'paused'}
              canNext={clock.snapshot?.canNext}
              enableGestures
              onBlockHover={onBlockHover}
              onBlockClick={onBlockClick}
              enableDisplayStack={!!runtime}
            />
          ) : (
          <TrackViewShell
            isCompact={isCompact}
            leftPanelId="tutorial-track-visual"
            rightPanelId="tutorial-track-clock"
            leftPanelAriaLabel="Visual panel"
            rightPanelAriaLabel="Clock panel"
            leftPanel={<VisualStatePanel />}
            rightPanel={(
              <div className="flex-1 flex flex-col justify-center">
                {timerDisplay}
              </div>
            )}
          />
          )}
        </div>
        {clockBoard}
      </div>
    </ScriptRuntimeProvider>
  ) : (
    // No runtime — show layout for selection or error
    <div className="flex h-full overflow-hidden">
      {/* Left Column: Workout Preview (formerly Right) */}
      <div className={cn(
        "flex flex-col bg-background transition-all duration-300 overflow-hidden",
        isCompact ? "w-full" : "w-2/3"
      )}>
        <WorkoutPreviewPanel
          content={content || ''}
          filter={previewFilter}
          onStartWorkout={onStartWorkout}
          onBlocksChange={setBlocks}
        />
      </div>

      {/* Right Column: Session Panel (Empty/Placeholder) (formerly Left) */}
      {!isCompact && (
        <div className="flex-1 min-w-0 bg-secondary/10 border-l border-border flex items-center justify-center text-muted-foreground">
          <div className="text-center p-8 max-w-sm">
            {isNotFound ? (
              <>
                <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
                  <span className="text-xl font-bold">!</span>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-foreground">Workout Not Found</h3>
                <p className="text-sm opacity-80 mb-6">
                  The workout segment you're looking for doesn't exist in this note or has been moved.
                </p>
                <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-border">
                  <p className="text-xs uppercase tracking-wider font-bold mb-2 opacity-50">Suggestion</p>
                  <p className="text-sm italic">
                    Select a valid Whiteboard script from the preview on the left to begin.
                  </p>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-2">Select a Session</h3>
                <p className="text-sm opacity-80 mb-6">
                  Choose a workout block from your note to begin tracking.
                </p>
                <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-border">
                  <p className="text-sm italic">
                    Click "Run" on any Whiteboard script to start the timer and visualizer.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return screenContent;
};
