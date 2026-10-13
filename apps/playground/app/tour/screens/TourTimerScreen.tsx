import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Play, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { cn } from '@/lib/utils'
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc'
import { RuntimeTimerPanel } from '@/components/organisms/editor/RuntimeTimerPanel'
import { TEST_IDS } from '@/testing/contracts/TestIdContract'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine'
import { useRingRef } from '../TourRing'

export interface TourTimerScreenProps {
  block: ScriptBlock | null
  autoStart: boolean
  onClose: () => void
  onComplete: (blockId: string, results: Sessions) => void
  onRuntimeReady: (runtime: IScriptRuntime) => void
  /** Called once when the runtime transitions from idle to running. */
  onRunStarted?: () => void
  onStart?: () => void
  /**
   * Scroll-out stop (#885): when true, the panel halts execution without
   * resetting — the run's outputs stay in the runtime so the analytics
   * cards keep the data.
   */
  externalPause?: boolean
  /**
   * Host-driven finalize stop: the host (HomeTour) flips this on metrics
   * arrival / reset chaining; the panel stops and reports partial results
   * via onComplete without closing. See RuntimeTimerPanel.externalStop.
   */
  externalStop?: boolean
  /** Header Reset button: restart the run on demand (#885). */
  onReset?: () => void
}

export const TourTimerScreen: React.FC<TourTimerScreenProps> = ({
  block,
  autoStart,
  onClose,
  onComplete,
  onRuntimeReady,
  onRunStarted,
  onStart,
  externalPause,
  externalStop,
  onReset,
}) => {
  const [isFlashing, setIsFlashing] = useState(false)

  const triggerRun = useCallback(() => {
    if (isFlashing || block) return
    setIsFlashing(true)
    onStart?.()
    setTimeout(() => {
      setIsFlashing(false)
    }, 450)
  }, [isFlashing, block, onStart])

  const handleResetClick = () => {
    setIsFlashing(false)
    onReset?.()
  }
  const floorRef = useRingRef('timer.floor')
  const nextButtonRef = useRingRef('timer.nextButton')
  const castButtonRef = useRingRef('timer.castButton')
  const floorElRef = useRef<HTMLDivElement | null>(null)

  const setFloorEl = useCallback(
    (el: HTMLDivElement | null) => {
      floorElRef.current = el
      floorRef(el)
    },
    [floorRef],
  )

  // Card-2 highlight (#885): the ring targets the panel's live Next button.
  // The button mounts asynchronously (the panel builds its runtime first),
  // so watch the floor for it and register the element once it exists.
  useEffect(() => {
    const floor = floorElRef.current
    if (!floor) return
    const register = (): boolean => {
      const btn = floor.querySelector<HTMLElement>(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]`)
      nextButtonRef(btn)
      return btn != null
    }
    if (register()) return () => nextButtonRef(null)
    const observer = new MutationObserver(() => {
      if (register()) observer.disconnect()
    })
    observer.observe(floor, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      nextButtonRef(null)
    }
  }, [nextButtonRef, block])

  // The panel's Stop button fires onComplete (→ analytics screen) and then
  // onClose. The tour window stays mounted across screens, so the panel's
  // "close" is a no-op — exiting playground mode is the ✕ button's job
  // (prop onClose), wired above.
  const handlePanelClose = () => {}

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-end gap-2 border-b border-border px-3 py-2">
        {onStart && (
          <Button
            variant="outline"
            size="sm"
            onClick={triggerRun}
            disabled={isFlashing || Boolean(block)}
            title="Run timer"
            aria-label="Run timer"
            data-testid="tour-timer-header-run"
            className={cn(
              "h-8 gap-1.5 px-3 font-mono text-xs font-semibold text-foreground transition-all duration-150",
              isFlashing && "animate-[pulse_0.2s_ease-in-out_2] ring-2 ring-primary scale-105 bg-primary/20 text-primary",
              Boolean(block) && "opacity-50"
            )}
          >
            <Play className="size-3.5 fill-current" aria-hidden />
            Run
          </Button>
        )}
        {onReset && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={handleResetClick}
            title="Reset timer"
            aria-label="Reset timer"
            data-testid="tour-timer-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        <div ref={castButtonRef}>
          <CastButtonRpc />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onClose}
          title="Back to the tour"
          aria-label="Back to the tour"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div ref={setFloorEl} className="flex-1 min-h-0">
        {block ? (
          <RuntimeTimerPanel
            block={block}
            onClose={handlePanelClose}
            onComplete={onComplete}
            autoStart={autoStart}
            onRuntimeReady={onRuntimeReady}
            onRunStarted={onRunStarted}
            externalPause={externalPause}
            externalStop={externalStop}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            <div className="m-auto flex flex-col items-center gap-5 px-5 py-6 text-center">
              <span className="font-mono text-[clamp(48px,8vw,96px)] font-bold tabular-nums tracking-tight">00:00</span>
              {onStart && (
                <Button
                  onClick={triggerRun}
                  disabled={isFlashing || Boolean(block)}
                  aria-label="Run this example"
                  data-testid="tour-timer-center-run"
                  className={cn(
                    "gap-2 px-6 py-2.5 font-mono text-sm font-semibold transition-all duration-150",
                    isFlashing && "animate-[pulse_0.2s_ease-in-out_2] ring-4 ring-primary scale-105 bg-primary text-primary-foreground"
                  )}
                >
                  <Play className="size-4 fill-current" aria-hidden />
                  Run
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TourTimerScreen
