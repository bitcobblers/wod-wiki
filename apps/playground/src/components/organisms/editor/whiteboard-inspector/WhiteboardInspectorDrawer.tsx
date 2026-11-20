import React, { useMemo, useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { AlertTriangle, Clock, Keyboard, PanelRightClose, Settings2 } from 'lucide-react';
import type { NotebookScopeSnapshot } from '@/components/organisms/editor/wheelSources';
import { useStickyBoundaryOffset } from '@/panels/page-shells';
import { TEST_IDS } from '@/lib/testIds';
import { cn } from '@/lib/utils';
import { TokenInspectorPanel } from './TokenInspectorPanel';
import {
  extractBlockTimeline,
  type EditDiffSummary,
  type InspectorMode,
  type InspectorToken,
  type LineInspection,
} from './tokenModel';

export interface WhiteboardInspectorDrawerProps {
  open: boolean;
  layout?: 'docked-right' | 'inline';
  view: EditorView | null;
  mode: InspectorMode;
  inspection: LineInspection;
  token: InspectorToken | null;
  scope: NotebookScopeSnapshot;
  docText: string;
  lastEditDiff: EditDiffSummary | null;
  onClose: () => void;
  onModeChange?: (mode: InspectorMode) => void;
  onMutate?: (diff: EditDiffSummary | null, toastMsg: string) => void;
  onStepToken?: (delta: -1 | 1) => void;
}

export const WhiteboardInspectorDrawer: React.FC<WhiteboardInspectorDrawerProps> = ({
  open,
  layout = 'docked-right',
  view,
  mode,
  inspection,
  token,
  scope,
  docText,
  lastEditDiff,
  onClose,
  onModeChange,
  onMutate,
  onStepToken,
}) => {
  const [useScrubber, setUseScrubber] = useState(true);
  const stickyTop = useStickyBoundaryOffset(65);

  const sectionType = inspection.section?.type;
  const isWorkoutSection = sectionType === 'time' || sectionType === 'log';

  const timeline = useMemo(() => {
    if (!view || !isWorkoutSection || !inspection.section) return [];
    return extractBlockTimeline(view.state, inspection.section);
  }, [view, isWorkoutSection, inspection]);

  if (!open) return null;

  const handleSelectTimelineRow = (lineNum: number) => {
    if (!view) return;
    if (lineNum < 1 || lineNum > view.state.doc.lines) return;
    const line = view.state.doc.line(lineNum);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      scrollIntoView: true,
    });
    view.focus();
  };

  return (
    <aside
      role="complementary"
      aria-label="Focused Token Inspector Drawer"
      data-testid={TEST_IDS.EDITOR_INSPECTOR_DRAWER}
      style={layout === 'docked-right' ? { top: stickyTop } : undefined}
      className={cn(
        'flex flex-col overflow-hidden border-l border-border bg-card text-card-foreground',
        layout === 'docked-right'
          ? 'fixed right-0 bottom-0 z-30 w-[340px] max-w-[92vw] shadow-xl'
          : 'w-[340px] max-w-full shrink-0',
      )}
    >
      {/* Drawer Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
              Focused Token Inspector
            </h2>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
            <span>
              Ln {inspection.lineNum} · {inspection.tokens.length} token
              {inspection.tokens.length === 1 ? '' : 's'}
            </span>
            {lastEditDiff && (
              <span
                data-testid={TEST_IDS.EDITOR_INSPECTOR_DIFF_BADGE}
                className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary"
                title={`Last change: ${lastEditDiff.from} -> ${lastEditDiff.to}`}
              >
                {lastEditDiff.from} → {lastEditDiff.to}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector drawer"
          title="Close Inspector Drawer (Ctrl+Alt+I / Cmd+Alt+I)"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable Inspector + Block Runtime Preview */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        <TokenInspectorPanel
          view={view}
          mode={mode}
          inspection={inspection}
          token={token}
          scope={scope}
          docText={docText}
          useScrubber={useScrubber}
          onToggleScrubber={() => setUseScrubber((prev) => !prev)}
          compact={false}
          showHeader
          showFooter={false}
          showStepButtons={mode === 'token'}
          showClose={false}
          showDockButton={false}
          onMutate={onMutate}
          onModeChange={onModeChange}
          onStepToken={onStepToken}
        />

        {/* Block Runtime Preview */}
        {isWorkoutSection && timeline.length > 0 && (
          <div className="px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Block Runtime Preview</span>
              </div>
              <button
                type="button"
                onClick={() => onModeChange?.('block')}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <Settings2 className="h-3 w-3" />
                <span>Configure</span>
              </button>
            </div>

            <div className="overflow-hidden rounded-lg bg-muted/35 divide-y divide-border/60">
              {timeline.map((row) => {
                const isActive = row.lineNum === inspection.lineNum;
                return (
                  <button
                    key={row.lineNum}
                    type="button"
                    data-testid={TEST_IDS.EDITOR_BLOCK_TIMELINE_ROW}
                    onClick={() => handleSelectTimelineRow(row.lineNum)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                      isActive
                        ? 'bg-primary/10 text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {row.lineNum}
                      </span>
                      <span
                        className={cn(
                          'truncate',
                          row.isRest && 'italic text-muted-foreground',
                        )}
                      >
                        {row.label}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {row.hasError && (
                        <AlertTriangle
                          className="h-3.5 w-3.5 text-destructive"
                          aria-label="Line has syntax warning"
                        />
                      )}
                      {row.durationLabel && (
                        <span className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[11px] text-foreground tabular-nums">
                          {row.durationLabel}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Keyboard Accelerators */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Keyboard className="h-3 w-3" />
        </span>
        <span>Alt+. Popover</span>
        <span>Ctrl+Alt+I / Cmd+Alt+I Drawer</span>
        <span>Ctrl+←/→ Step</span>
        <span>Alt+↑/↓ Value</span>
      </div>
    </aside>
  );
};
