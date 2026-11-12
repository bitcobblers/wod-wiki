import React from 'react'
import { Eye, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { executeNavAction, isRunActivation } from '../../nav/navTypes'
import type { INavActivation, NavActionDeps } from '../../nav/navTypes'

export interface RunButtonState {
  /** True when a runtime for this button's block is active but hidden */
  isReconnect: boolean
  onReconnect: () => void
  onRun: () => void
}

interface SectionButtonsProps {
  activations: INavActivation[]
  fullBleed: boolean
  runState?: RunButtonState
  deps: NavActionDeps
}

export const SectionButtons: React.FC<SectionButtonsProps> = ({
  activations,
  fullBleed,
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
        className={cn(
          'flex items-center gap-2 px-5 py-2 text-[11px] font-black uppercase tracking-widest',
          'rounded-full border transition-all active:scale-95',
          'border-amber-500/40 bg-amber-500/15 text-amber-600 hover:bg-amber-500/20',
          'dark:text-amber-400',
          fullBleed && 'mx-auto',
        )}
      >
        <Eye className="size-3.5" aria-hidden="true" />
        View
      </button>
    ) : (
      <button
        type="button"
        aria-label={first.label}
        onClick={runState.onRun}
        className={cn(
          'flex items-center gap-2 transition-all active:scale-95 bg-primary text-primary-foreground hover:bg-primary/90 font-black uppercase tracking-widest rounded-full shadow-lg shadow-primary/25 min-h-[44px] px-6 py-2 text-xs',
          fullBleed && 'mx-auto'
        )}
      >
        {(() => {
          const Icon = first.icon || Play
          return <Icon className="shrink-0 size-4 fill-current sm:size-3" aria-hidden="true" />
        })()}
        <span>{first.label}</span>
      </button>
    )
    return (
      <div className={cn('flex flex-wrap items-center gap-4 mt-8', fullBleed && 'justify-center')}>
        {RunPill}
        {rest.map((activation, i) => (
          <button
            key={activation.id || i}
            type="button"
            aria-label={activation.label}
            onClick={() => executeNavAction(activation.action, deps)}
            className="flex items-center gap-2 px-6 py-2 text-xs font-black uppercase tracking-widest rounded-full bg-background border border-border text-foreground hover:bg-muted transition-all active:scale-95"
          >
            {activation.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap gap-4 mt-8', fullBleed && 'justify-center')}>
      {activations.map((activation, i) => (
        <button
          key={activation.id || i}
          type="button"
          aria-label={activation.label}
          onClick={() => executeNavAction(activation.action, deps)}
          className={cn(
            'flex items-center gap-2 px-8 py-4 text-xs font-black uppercase tracking-widest rounded-full transition-all active:scale-95',
            i === 0
              ? 'bg-primary text-primary-foreground shadow-xl shadow-primary/25 hover:scale-[1.04]'
              : 'bg-background border border-border text-foreground hover:bg-muted',
          )}
        >
          {activation.label}
        </button>
      ))}
    </div>
  )
}
