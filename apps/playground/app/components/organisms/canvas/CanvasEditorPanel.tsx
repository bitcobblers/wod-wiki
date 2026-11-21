import React from 'react'
import { ViewPanelButtons } from '../../molecules/ViewPanelButtons'
import type { RunButtonState } from '../../molecules/SectionButtons'
import type { NavActionDeps } from '../../../nav/navTypes'
import { buttonToActivation } from '../../../nav/navTypes'
import type { PipelineStep, OpenMode } from '../../../canvas/parseCanvasMarkdown'
import { STICKY_NAV_HEIGHT, MOBILE_STICKY_TOP } from '../../../canvas/canvasUtils'
import { getCanvasLayoutVariables, getEditorPreferredHeight, resolveCanvasLayout } from '../../../canvas/canvasLayout'
interface CanvasEditorPanelProps {
  variant: 'desktop' | 'mobile'
  panelTitle: string
  panelSubtitle?: string
  panelContent: React.ReactNode
  panelThemeClass?: string
  headerActions?: React.ReactNode
  showPanelButtons?: boolean
  viewDefButtons?: Array<{ label: string; pipeline: PipelineStep[]; open?: OpenMode }>
  runState?: RunButtonState
  deps: NavActionDeps
  width?: string
  source?: string
}

export const CanvasEditorPanel: React.FC<CanvasEditorPanelProps> = ({
  variant,
  panelTitle: _panelTitle,
  panelSubtitle: _panelSubtitle,
  panelContent,
  panelThemeClass: _panelThemeClass,
  headerActions: _headerActions,
  showPanelButtons = false,
  viewDefButtons,
  runState,
  deps,
  width,
  source = '',
}) => {
  const chrome = panelContent

  const buttons = showPanelButtons && viewDefButtons && viewDefButtons.length > 0 ? (
    <ViewPanelButtons
      activations={viewDefButtons.map((b, i) => buttonToActivation(b, i))}
      runState={runState}
      deps={deps}
    />
  ) : null

  if (variant === 'desktop') {
    return (
      <div
        className="self-start sticky hidden lg:flex flex-col p-6 pt-8 pb-8 gap-3"
        style={{
          top: `${STICKY_NAV_HEIGHT}px`,
          height: `calc(100vh - ${STICKY_NAV_HEIGHT}px)`,
          width: 'clamp(var(--canvas-editor-min-width), var(--canvas-editor-width), var(--canvas-editor-max-width))',
          ...getCanvasLayoutVariables(resolveCanvasLayout(width), source),
        }}
      >
        <div className="flex-1 min-h-0 flex flex-col justify-center py-4">
          <div className="h-[min(var(--canvas-editor-preferred-height),var(--canvas-editor-max-height))] min-h-[var(--canvas-editor-min-height)] max-h-[var(--canvas-editor-max-height)] flex flex-col w-full">
            {chrome}
          </div>
        </div>
        {buttons}
      </div>
    )
  }

  return (
    <div
      className="lg:hidden sticky z-20 shrink-0 px-4 pt-2 pb-1"
      data-page-sticky-boundary="true"
      style={{
        top: `${MOBILE_STICKY_TOP}px`,
        height: `min(var(--canvas-editor-preferred-height), calc(100svh - ${MOBILE_STICKY_TOP}px - var(--mobile-editor-inset, 0px) - 0.75rem))`,
        minHeight: `min(18rem, calc(100svh - ${MOBILE_STICKY_TOP}px - var(--mobile-editor-inset, 0px) - 0.75rem))`,
        '--canvas-editor-preferred-height': getEditorPreferredHeight(source),
      } as React.CSSProperties}
    >
      <div className="flex flex-col gap-2 h-full">
        <div className="flex-1 min-h-0">{chrome}</div>
        {buttons}
      </div>
    </div>
  )
}
