/**
 * ResponsiveViewport - Stacked view container with show/hide transitions
 *
 * Core component for the unified responsive layout with improved panel system.
 * All views are rendered as stacked layers; only the active view is visible.
 * This avoids CSS transform/positioning bugs that plague sliding-strip approaches.
 *
 * Features:
 * - Instant view switching (Plan → Track → Review)
 * - Composable panel system with PanelGrid
 * - Screen-mode-aware layouts (desktop, tablet, mobile)
 * - Keyboard navigation (Ctrl/Cmd+Shift+Arrow keys)
 */

import { useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { ViewDescriptor } from './types';
import { PanelGrid } from './PanelGrid';

export type ViewMode = 'history' | 'plan' | 'track' | 'review' | 'analyze';

/** Constrained type for static mode — only the original 3 views */
export type StaticViewMode = 'plan' | 'track' | 'review';

export interface ResponsiveViewportProps {
  /** All view descriptors */
  views: ViewDescriptor[];

  /** Current view mode */
  currentView: ViewMode;

  /** Callback when view changes */
  onViewChange: (view: ViewMode) => void;

  /** Panel layout state from WorkbenchContext */
  panelLayouts: Record<string, Record<string, number | string | undefined>>;



  /** Additional CSS classes */
  className?: string;
}

/**
 * ResponsiveViewport - Stacked viewport with composable panel system
 *
 * Layout:
 * - Views are absolutely positioned and stacked on top of each other
 * - Only the active view is visible (via visibility + z-index)
 * - Inactive views stay mounted to preserve internal state (scroll, timers)
 * - Keyboard navigation support (Ctrl/Cmd+Shift+Arrow)
 */
export function ResponsiveViewport({
  views,
  currentView,
  onViewChange,
  panelLayouts,

  className,
}: ResponsiveViewportProps) {
  // Find current view index (for keyboard navigation)
  const viewIndex = useMemo(() => {
    const idx = views.findIndex((v) => v.id === currentView);
    return idx >= 0 ? idx : 0;
  }, [views, currentView]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Mod+Shift+Arrow (not plain Mod+Arrow) — the editor owns Mod+ArrowLeft/Right
      // for metric-token jumps; the shift modifier keeps both meanings alive.
      if (!isCtrlOrCmd || !e.shiftKey) return;

      if (e.key === 'ArrowLeft' && viewIndex > 0) {
        e.preventDefault();
        onViewChange(views[viewIndex - 1].id as ViewMode);
      } else if (e.key === 'ArrowRight' && viewIndex < views.length - 1) {
        e.preventDefault();
        onViewChange(views[viewIndex + 1].id as ViewMode);
      }
    },
    [viewIndex, views, onViewChange]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className={cn('relative w-full h-full overflow-hidden', className)}>
      {/* Stacked view layers — active view is visible, others hidden */}
      {views.map((view) => {
        const isActive = view.id === currentView;

        // Get layout state for this view (or create default)
        const layoutState = panelLayouts[view.id] || {
          viewId: view.id,
          panelSpans: view.panels.reduce(
            (acc, panel) => {
              acc[panel.id] = panel.defaultSpan;
              return acc;
            },
            {} as Record<string, number>
          ),
          expandedPanelId: null,
        };

        return (
          <div
            key={view.id}
            className={cn(
              'absolute inset-0 bg-background',
              isActive ? 'z-10' : 'z-0 pointer-events-none'
            )}
            style={{
              overflow: 'hidden',
              visibility: isActive ? 'visible' : 'hidden',
            }}
            data-view-id={view.id}
          >
            <PanelGrid
              panels={view.panels}
              layoutState={layoutState}

              className="h-full"
            />
          </div>
        );
      })}
    </div>
  );
}
