import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { NotebookScopeSnapshot } from '@/components/organisms/editor/wheelSources';
import { TEST_IDS } from '@/lib/testIds';
import { TokenInspectorPanel } from './TokenInspectorPanel';
import type {
  EditDiffSummary,
  InspectorMode,
  InspectorToken,
  LineInspection,
} from './tokenModel';

export interface WhiteboardInspectorPopoverProps {
  open: boolean;
  anchorRect: DOMRect | null;
  editorDom?: HTMLElement | null;
  view: EditorView | null;
  mode: InspectorMode;
  inspection: LineInspection;
  token: InspectorToken | null;
  scope: NotebookScopeSnapshot;
  docText: string;
  onClose: () => void;
  onMutate?: (diff: EditDiffSummary | null, toastMsg: string) => void;
  onModeChange?: (mode: InspectorMode) => void;
  onStepToken?: (delta: -1 | 1) => void;
  onDockDrawer?: () => void;
}

const POPOVER_WIDTH = 340;
const EDGE_MARGIN = 12;

export const WhiteboardInspectorPopover: React.FC<WhiteboardInspectorPopoverProps> = ({
  open,
  anchorRect,
  editorDom,
  view,
  mode,
  inspection,
  token,
  scope,
  docText,
  onClose,
  onMutate,
  onModeChange,
  onStepToken,
  onDockDrawer,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [useScrubber, setUseScrubber] = useState(false);

  // Reset scrubber expansion when switching tokens so the compact chip/choice UX leads
  useEffect(() => {
    setUseScrubber(false);
  }, [token?.id, mode]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        if (typeof view?.focus === 'function') view.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest('[data-inspector-trigger="true"]')) return;
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, onClose, view]);

  const positionStyle = useMemo<React.CSSProperties>(() => {
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;

    const hasAnchor =
      anchorRect &&
      (anchorRect.width > 0 ||
        anchorRect.height > 0 ||
        anchorRect.top > 0 ||
        anchorRect.left > 0);

    if (hasAnchor && anchorRect) {
      const spaceBelow = viewportH - anchorRect.bottom;
      const flipAbove = spaceBelow < 340 && anchorRect.top > 280;
      const left = Math.max(
        EDGE_MARGIN,
        Math.min(anchorRect.left, viewportW - POPOVER_WIDTH - EDGE_MARGIN),
      );

      if (flipAbove) {
        return {
          left,
          bottom: Math.max(EDGE_MARGIN, viewportH - anchorRect.top + 8),
        };
      }

      return {
        left,
        top: Math.max(EDGE_MARGIN, Math.min(anchorRect.bottom + 8, viewportH - 140)),
      };
    }

    const editorRect = editorDom?.getBoundingClientRect();
    const hasEditorRect =
      editorRect &&
      (editorRect.width > 0 || editorRect.height > 0 || editorRect.top > 0 || editorRect.left > 0);

    if (hasEditorRect && editorRect) {
      return {
        top: Math.max(EDGE_MARGIN, Math.min(editorRect.top + 48, viewportH - 200)),
        left: Math.max(EDGE_MARGIN, Math.min(editorRect.left + 16, viewportW - POPOVER_WIDTH - EDGE_MARGIN)),
      };
    }

    return {
      top: 72,
      left: 24,
    };
  }, [anchorRect, editorDom]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Syntax Token Inspector"
      data-testid={TEST_IDS.EDITOR_INSPECTOR_POPOVER}
      style={positionStyle}
      className="fixed z-40 flex max-h-[min(540px,calc(100vh-28px))] w-[340px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
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
        showFooter
        showStepButtons={mode === 'token'}
        showClose
        showDockButton={Boolean(onDockDrawer)}
        onDockDrawer={onDockDrawer}
        onMutate={onMutate}
        onModeChange={onModeChange}
        onStepToken={onStepToken}
        onClose={() => {
          onClose();
          if (typeof view?.focus === 'function') view.focus();
        }}
      />
    </div>
  );
};
