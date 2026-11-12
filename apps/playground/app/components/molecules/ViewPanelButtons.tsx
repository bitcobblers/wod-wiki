import React from 'react'
import { Eye, Play } from 'lucide-react'
import { executeNavAction, isRunActivation } from '../../nav/navTypes'
import type { INavActivation, NavActionDeps } from '../../nav/navTypes'
import type { RunButtonState } from './SectionButtons'

interface ViewPanelButtonsProps {
  activations: INavActivation[]
  runState?: RunButtonState
  deps: NavActionDeps
}

export const ViewPanelButtons: React.FC<ViewPanelButtonsProps> = ({
  activations,
  runState,
  deps,
}) => {
  if (activations.length === 0) return null

  const first = activations[0]
  if (isRunActivation(first) && runState) {
    const rest = activations.slice(1)
    const RunPill = runState.isReconnect ? (
      <button
        type="button"
        aria-label="View active workout timer"
        onClick={runState.onReconnect}
        className="flex items-center gap-2 px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-full border transition-all active:scale-95 border-amber-500/40 bg-amber-500/15 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
      >
        <Eye className="size-3.5" aria-hidden="true" />
        View
      </button>
    ) : (
      <button
        type="button"
        aria-label={first.label}
        onClick={runState.onRun}
        className="flex items-center gap-2 transition-all active:scale-95 bg-primary text-primary-foreground hover:bg-primary/90 font-black uppercase tracking-widest rounded-full shadow-lg shadow-primary/25 min-h-[44px] px-6 py-2 text-xs"
      >
        {(() => {
          const Icon = first.icon || Play
          return <Icon className="shrink-0 size-4 fill-current sm:size-3" aria-hidden="true" />
        })()}
        <span>{first.label}</span>
      </button>
    )
    return (
      <div className="flex flex-wrap items-center gap-3 justify-end pt-3 px-1">
        {RunPill}
        {rest.map((activation, i) => (
          <button
            key={activation.id || i}
            type="button"
            aria-label={activation.label}
            onClick={() => executeNavAction(activation.action, deps)}
            className="px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-full bg-muted border border-border text-foreground hover:bg-muted/80 transition-all active:scale-95"
          >
            {activation.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-3 justify-end pt-3 px-1">
      {activations.map((activation, i) => (
        <button
          key={activation.id || i}
          type="button"
          aria-label={activation.label}
          onClick={() => executeNavAction(activation.action, deps)}
          className="px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-full transition-all active:scale-95 bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:scale-[1.04]"
        >
          {activation.label}
        </button>
      ))}
    </div>
  )
}
