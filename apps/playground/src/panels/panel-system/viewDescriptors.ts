/**
 * View Descriptors
 *
 * Default view configurations for the panel system.
 * Defines the three main views: Plan, Track, and Review.
 */

import React from 'react';
import { Edit, Timer, BarChart2, Calendar } from 'lucide-react';
import type { ViewDescriptor, PanelSpan, PanelDescriptor } from './types';


/**
 * Plan View - Editor for authoring workout definitions
 *
 * Single full-width panel with CodeMirror Editor
 */
export function createPlanView(planPanel: React.ReactNode): ViewDescriptor {
  return {
    id: 'plan',
    label: 'Plan',
    icon: React.createElement(Edit, { className: 'w-4 h-4' }),
    panels: [
      {
        id: 'editor',
        defaultSpan: 3, // Full-screen

        content: planPanel,
      },
    ],
  };
}

/**
 * Track View - Live workout execution
 *
 * Two panels:
 * - Timer (2/3 width) - Primary timer display
 * - History (1/3 width) - Execution history log (hidden on mobile, embedded in primary)
 */
export function createTrackView(
  timerPanel: React.ReactNode,
  historyPanel: React.ReactNode | null | undefined, // Allow null/undefined
  debugPanel?: React.ReactNode,
  isDebugMode = false
): ViewDescriptor {
  const showSidePanel = isDebugMode || !!historyPanel;

  const panels: PanelDescriptor[] = [
    {
      id: 'timer',
      defaultSpan: showSidePanel ? 2 : 3, // Full width if no side panel
      content: timerPanel,
    }
  ];

  if (showSidePanel) {
    panels.push({
      id: isDebugMode ? 'debug' : 'history',
      defaultSpan: 1, // 1/3 width
      content: (isDebugMode && debugPanel) ? debugPanel : historyPanel,
      hideOnMobile: true, // Embedded in timer panel on mobile
    });
  }

  return {
    id: 'track',
    label: 'Track',
    icon: React.createElement(Timer, { className: 'w-4 h-4' }),
    panels,
  };
}

/**
 * Review View - Post-workout analytics grid
 *
 * Single full-width panel containing the ReviewGrid component,
 * which replaces the previous two-panel (index + timeline) layout.
 */
export function createReviewView(
  gridPanel: React.ReactNode,
): ViewDescriptor {
  return {
    id: 'review',
    label: 'Review',
    icon: React.createElement(BarChart2, { className: 'w-4 h-4' }),
    panels: [
      {
        id: 'review-grid',
        defaultSpan: 3, // Full width

        content: gridPanel,
      },
    ],
  };
}

/**
 * Helper to get all view descriptors
 */
export function getAllViews(
  planPanel: React.ReactNode,
  timerPanel: React.ReactNode,
  historyPanel: React.ReactNode,
  reviewGridPanel: React.ReactNode,
  debugPanel?: React.ReactNode,
  isDebugMode = false
): ViewDescriptor[] {
  return [
    createPlanView(planPanel),
    createTrackView(timerPanel, historyPanel, debugPanel, isDebugMode),
    createReviewView(reviewGridPanel),
  ];
}

/**
 * History View - Browse and select stored workout entries
 *
 * With the stacked viewport approach, each view owns the full screen.
 * The History panel always uses span 3 (full width).
 */
export function createHistoryView(
  mainPanel: React.ReactNode,
  previewPanel?: React.ReactNode, // Optional: Only shown if selected
): ViewDescriptor {
  const panels: PanelDescriptor[] = [
    {
      id: 'history-list',
      defaultSpan: (previewPanel ? 1 : 3) as PanelSpan,
      content: mainPanel,
    }
  ];

  if (previewPanel) {
    panels.push({
      id: 'history-preview',
      defaultSpan: 1,
      content: previewPanel,
      hideOnMobile: true,
    });
  }

  return {
    id: 'history',
    label: 'History',
    icon: React.createElement(Calendar, { className: 'w-4 h-4' }),
    panels,
  };
}
