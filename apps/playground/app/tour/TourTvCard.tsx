/**
 * TourTvCard.tsx — the mini-TV that parallaxes up during the timer stage's
 * cast beat. The screen shows the REAL Chromecast receiver composition
 * (ReceiverTimerPanel's General surface, as mounted by receiver-rpc.tsx's
 * active mode), fed by the tour's live runtime and rendered at a fixed
 * 960×540 "TV resolution" scaled down with CSS — so it is exactly what
 * would show up on the cast, not a mock. The bezel/stand stays dark in
 * both themes.
 *
 * Visibility/parallax are driven imperatively by the parent via `innerRef`
 * (transform/opacity only).
 */

import { forwardRef } from 'react'
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine'
import { PanelSizeProvider } from '@/panels/panel-system/PanelSizeContext'
import { ReceiverTimerPanel } from '@/panels/wallclock-panel-chromecast'
import type { IRuntimeEventProvider } from '@bitcobblers/wod-wiki-engine'
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine'

export interface TourTvCardProps {
  /** The tour's live runtime; null before the timer stage has created it. */
  runtime: IScriptRuntime | null
}

/** Render size of the virtual TV screen; scaled into the bezel. */
const RECEIVER_WIDTH = 960
const RECEIVER_HEIGHT = 540
const SCREEN_WIDTH = 340
const SCREEN_SCALE = SCREEN_WIDTH / RECEIVER_WIDTH

/**
 * The TV is a display mirror: its controls are unreachable
 * (pointer-events-none) and the General surface has no global key handlers,
 * so the session cannot double-advance from stray Enter/VolumeUp presses.
 */
const noopEventProvider: IRuntimeEventProvider = {
  dispatch: () => {},
  onEvent: () => () => {},
  dispose: () => {},
}

/** What the receiver paints before a sender connects (receiver-rpc.tsx). */
const ReceiverWaitingScreen: React.FC = () => (
  <div className="flex h-full w-full flex-col items-center justify-center bg-black font-mono uppercase tracking-[0.5em] text-white/60">
    <div className="animate-pulse text-[28px]">Wod.Wiki // waiting</div>
  </div>
)

export const TourTvCard = forwardRef<HTMLDivElement, TourTvCardProps>(
  function TourTvCard({ runtime }, innerRef) {
    return (
      <div
        ref={innerRef}
        data-testid="tour-tv-card"
        className="pointer-events-none absolute left-8 bottom-12 z-20 w-[360px] opacity-0"
      >
        {/* Identity badge (#dogfood: the unlabeled mini-timer read as a
            duplicate artifact of the main demo window). */}
        <div className="mb-2 flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-background shadow-lg">
            <span className="size-[7px] animate-pulse rounded-full bg-[hsl(var(--metric-effort))]" />
            Casting to Living Room TV
          </span>
        </div>
        {/* Bezel */}
        <div className="rounded-xl border border-black/80 bg-[#141311] p-[10px] pb-[22px] shadow-[0_30px_60px_-18px_rgba(18,17,14,0.5)]">
          {/* Screen: real receiver UI rendered at 960×540, scaled to fit */}
          <div className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-black ring-1 ring-white/10">
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: RECEIVER_WIDTH,
                height: RECEIVER_HEIGHT,
                transform: `scale(${SCREEN_SCALE})`,
              }}
            >
              {runtime ? (
                <ScriptRuntimeProvider runtime={runtime}>
                  <PanelSizeProvider>
                    {/* Same layout as ReceiverApp's active mode */}
                    <div className="h-full w-full overflow-hidden bg-background text-foreground">
                      <ReceiverTimerPanel eventProvider={noopEventProvider} />
                    </div>
                  </PanelSizeProvider>
                </ScriptRuntimeProvider>
              ) : (
                <ReceiverWaitingScreen />
              )}
            </div>
            {/* Glass reflection */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent" />
          </div>
          {/* Chin: LED + brand */}
          <div className="mt-[7px] flex items-center justify-center gap-1.5">
            <span className="size-[5px] animate-pulse rounded-full bg-[hsl(var(--metric-effort))]" />
            <span className="text-[7px] font-semibold uppercase tracking-[0.3em] text-white/40">
              wod.wiki
            </span>
          </div>
        </div>
        {/* Stand */}
        <div className="mx-auto h-2.5 w-[64px] rounded-b-md bg-[#2A2822]" />
        <div className="mx-auto h-[5px] w-[150px] rounded-[3px] bg-[#22201C] shadow-[0_4px_10px_rgba(18,17,14,0.4)]" />
      </div>
    )
  },
)
