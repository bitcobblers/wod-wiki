/**
 * TimerCore — shared hero + control triad for the Minimal and General
 * timer surfaces.
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html. Every tier
 * keeps one shared core: the hero clock (tap to pause), the Stop / Pause /
 * Next triad, and an up-next line attached to the Next button. Only chrome
 * changes between tiers — this component is that core; surfaces add their
 * own chrome (status strip / TV top bar).
 *
 * Layout-stability contract (same as TimerStackView): label band, chips
 * band and caption reserve fixed geometry in every state, and FitArea
 * scales content, so segment swaps never shift the clock or controls.
 */

import React, { useCallback, useRef } from 'react';
import { Play, Pause, SkipForward, Square, Timer, Layers } from 'lucide-react';
import { formatTimeMMSS } from '@/lib/formatTime';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import { useAudio } from '@/contexts/AudioContext';
import type { AudioContextType } from '@/contexts/AudioContext';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import { FitArea } from '@/components/organisms/workout/TimerStackView';
import type { TimerSurfaceModel } from './useTimerSurfaceModel';

const formatTime = formatTimeMMSS;

export interface TimerCoreControlProps {
  model: TimerSurfaceModel;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  getFocusProps?: (id: string) => FocusProps;
}

export interface TimerHeroProps {
  model: TimerSurfaceModel;
  onStart: () => void;
  onPause: () => void;
  /** mobile: phone-size type and chips hidden. tv: container-query sizing. */
  size: 'mobile' | 'tv';
  /** General tier shows secondary chips; Minimal never does */
  showChips: boolean;
  getFocusProps?: (id: string) => FocusProps;
}

const useClickAudio = (): AudioContextType | null => {
  let audio: AudioContextType | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    audio = useAudio();
  } catch { /* ignore if provider missing */ }
  return audio;
};

/** Skip-attempt flash bubble, anchored above the hero. */
const SkipFlash: React.FC<{ model: TimerSurfaceModel }> = ({ model }) => {
  if (!model.skipFlash) return null;
  return (
    <div
      key={model.skipFlashKey}
      className="timer-surface-flash absolute -top-2 left-1/2 z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-signal-caution px-4 py-1.5 text-sm font-semibold text-white shadow-lg pointer-events-none"
      role="status"
      aria-live="polite"
    >
      Timer can&#39;t be skipped!
    </div>
  );
};

/**
 * TimerHero — reserved label band, hero clock (tap to pause), chips band.
 * `size="tv"` uses container-query units; the host must set
 * `container-type: inline-size` (Tailwind `@container`).
 */
export const TimerHero: React.FC<TimerHeroProps> = ({
  model,
  onStart,
  onPause,
  size,
  showChips,
  getFocusProps,
}) => {
  const audio = useClickAudio();

  const handleStart = useCallback(() => {
    audio?.playClick();
    onStart();
  }, [audio, onStart]);

  const handlePause = useCallback(() => {
    audio?.playClick();
    onPause();
  }, [audio, onPause]);

  const { isRunning, isPaused } = model;
  const primaryControlLabel = isPaused ? 'Continue' : isRunning ? 'Pause' : 'Start';

  const handleClockClick = isPaused ? handleStart : isRunning ? handlePause : handleStart;

  const isTv = size === 'tv';

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden text-center">
      <style>{`
        @keyframes timer-surface-flash-fade {
          0%   { opacity: 1; transform: translate(-50%, -100%) translateY(0); }
          70%  { opacity: 1; transform: translate(-50%, -100%) translateY(-4px); }
          100% { opacity: 0; transform: translate(-50%, -100%) translateY(-8px); }
        }
        .timer-surface-flash {
          animation: timer-surface-flash-fade 3s ease-out forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .timer-surface-flash { animation: none; }
        }
      `}</style>

      <SkipFlash model={model} />

      {/* Label band — fixed geometry, FitArea scales content */}
      <div className={`flex w-full items-center justify-center overflow-hidden ${isTv ? 'mb-[1.2cqw]' : 'mb-2.5'}`}>
        <FitArea>
          <h2 className={`font-semibold tracking-tight text-foreground ${isTv ? 'text-[3.4cqw]' : 'text-xl'}`}>
            {model.mainLabel}
          </h2>
          {model.subLabels && model.subLabels.length > 0 && (
            <div className={`${isTv ? 'mt-[0.6cqw] space-y-[0.4cqw]' : 'mt-1 space-y-0.5'}`}>
              {model.subLabels.map((line, i) => (
                <p key={i} className={`text-muted-foreground ${isTv ? 'text-[2cqw]' : 'text-[13.5px]'}`}>
                  {line}
                </p>
              ))}
            </div>
          )}
        </FitArea>
      </div>

      {/* Hero clock — the clock owns the remaining band */}
      <button
        onClick={handleClockClick}
        {...(getFocusProps ? getFocusProps('timer-main') : {})}
        className="tv-focusable group relative z-10 flex h-full max-h-full min-h-[48px] w-full items-center justify-center focus:outline-none"
        title={primaryControlLabel}
      >
        <FitArea>
          <span
            className={`block font-mono font-bold leading-none tracking-tighter text-foreground tabular-nums ${isTv ? 'text-[13cqw]' : 'text-[21cqw]'}`}
            role="timer"
            aria-live="polite"
            aria-atomic="true"
          >
            {formatTime(model.displayMs)}
          </span>
        </FitArea>
      </button>

      {/* Secondary chips band — fixed height even when empty */}
      <div className={`flex w-full items-center justify-center overflow-hidden ${isTv ? 'mt-[1.2cqw] h-[4.4cqw]' : 'mt-1.5 h-8'}`}>
        {showChips && (
          <div className={`flex items-center justify-center ${isTv ? 'gap-[1cqw]' : 'gap-2'}`}>
            {model.secondaryTimers.map(st => (
              <div
                key={st.id}
                className={`flex items-center gap-[0.6em] rounded-lg border border-border bg-muted/40 text-muted-foreground ${isTv ? 'px-[1.4cqw] py-[0.8cqw] text-[1.7cqw]' : 'px-2.5 py-1.5 text-xs'}`}
                role="timer"
                aria-label={`${st.label} ${formatTime(st.displayMs)}`}
                aria-atomic="true"
              >
                <Timer className={`shrink-0 ${isTv ? 'w-[1.8cqw] h-[1.8cqw]' : 'w-3 h-3'}`} />
                <span className="max-w-[10em] truncate font-medium">{st.label}</span>
                <span className="font-mono font-semibold tabular-nums">{formatTime(st.displayMs)}</span>
              </div>
            ))}
            {model.roundLabel && (
              <div
                className={`flex items-center gap-[0.6em] rounded-lg border border-border bg-muted/40 text-muted-foreground ${isTv ? 'px-[1.4cqw] py-[0.8cqw] text-[1.7cqw]' : 'px-2.5 py-1.5 text-xs'}`}
                aria-label={model.roundLabel}
              >
                <Layers className={`shrink-0 text-metric-rounds ${isTv ? 'w-[1.8cqw] h-[1.8cqw]' : 'w-3 h-3'}`} />
                <span className="font-medium">{model.roundLabel}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export interface TimerControlsProps extends TimerCoreControlProps {
  size: 'mobile' | 'tv';
}

/**
 * TimerControls — the Stop / Pause / Next triad with the up-next caption
 * welded to the Next button (design: "one glance ties present to future").
 * Mobile arranges stop+pause beside a full-width Next pill; TV keeps the
 * caption above a Pause/Next pair at 10-foot scale.
 */
export const TimerControls: React.FC<TimerControlsProps> = ({
  model,
  onStart,
  onPause,
  onStop,
  onNext,
  size,
  getFocusProps,
}) => {
  const audio = useClickAudio();

  const { isRunning, isPaused, isNextDisabled } = model;
  const primaryControlLabel = isPaused ? 'Continue' : isRunning ? 'Pause' : 'Start';

  const handleStart = useCallback(() => {
    audio?.playClick();
    onStart();
  }, [audio, onStart]);

  const handlePause = useCallback(() => {
    audio?.playClick();
    onPause();
  }, [audio, onPause]);

  const handleStop = useCallback(() => {
    audio?.playClick();
    onStop();
  }, [audio, onStop]);

  const handleNext = useCallback(() => {
    if (isNextDisabled) return;
    audio?.playClick();
    onNext();
  }, [audio, isNextDisabled, onNext]);

  const isTv = size === 'tv';

  const stopButton = (
    <button
      onClick={handleStop}
      {...(getFocusProps ? getFocusProps('btn-stop') : {})}
      className={`tv-focusable group flex shrink-0 items-center justify-center rounded-full border border-border bg-muted transition-all active:scale-95 ${isTv ? 'h-[6cqw] w-[6cqw]' : 'h-12 w-12'}`}
      title="Stop Session"
      data-testid={TEST_IDS.TIMER_STOP_SESSION}
    >
      <Square className={`text-foreground transition-colors group-hover:text-destructive ${isTv ? 'h-[2.2cqw] w-[2.2cqw]' : 'h-[17px] w-[17px]'}`} />
    </button>
  );

  const pauseButton = (
    <button
      onClick={isPaused ? handleStart : isRunning ? handlePause : handleStart}
      {...(getFocusProps ? getFocusProps('btn-pause') : {})}
      className={`tv-focusable flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all active:scale-95 ${isTv ? 'h-[7cqw] w-[7cqw]' : 'h-[54px] w-[54px]'}`}
      title={primaryControlLabel}
      data-testid={TEST_IDS.TIMER_PLAY_PAUSE}
    >
      {isPaused
        ? <Play className={`${isTv ? 'ml-[0.3cqw] h-[2.8cqw] w-[2.8cqw]' : 'ml-0.5 h-[22px] w-[22px]'}`} />
        : isRunning
          ? <Pause className={isTv ? 'h-[2.8cqw] w-[2.8cqw]' : 'h-[22px] w-[22px]'} />
          : <Play className={`${isTv ? 'ml-[0.3cqw] h-[2.8cqw] w-[2.8cqw]' : 'ml-0.5 h-[22px] w-[22px]'}`} />
      }
    </button>
  );

  const nextButton = (
    <button
      onClick={handleNext}
      disabled={isNextDisabled}
      aria-disabled={isNextDisabled ? 'true' : undefined}
      {...(getFocusProps ? getFocusProps('btn-next') : {})}
      className={`tv-focusable flex items-center justify-center gap-2 bg-primary font-bold uppercase tracking-[0.12em] text-primary-foreground shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none ${isTv ? 'h-[7cqw] rounded-[1.4cqw] px-[4cqw] text-[2.2cqw]' : 'h-[54px] flex-1 rounded-2xl text-[15px]'}`}
      title="Next Block"
      data-testid={TEST_IDS.TIMER_NEXT_BLOCK}
    >
      <span>Next</span>
      <SkipForward className={isTv ? 'h-[2.4cqw] w-[2.4cqw]' : 'h-5 w-5'} />
    </button>
  );

  // Up-next caption — fixed-height line above the Next button; empty content
  // reserves the space so the control zone never shifts.
  const caption = (
    <p
      className={`truncate text-muted-foreground ${isTv ? 'pl-[0.4cqw] text-[1.8cqw]' : 'pl-1 text-xs'}`}
      data-testid={TEST_IDS.TIMER_UP_NEXT_CAPTION}
    >
      {model.upNext && (
        <>
          Up next: <b className="font-semibold text-foreground">{model.upNext}</b>
        </>
      )}
    </p>
  );

  return (
    <div className={isTv ? 'flex items-end justify-center gap-[2cqw]' : 'flex items-end gap-3'}>
      {stopButton}
      {!isTv && pauseButton}
      <div className={`flex min-w-0 flex-col ${isTv ? 'items-start gap-[1cqw]' : 'flex-1 items-stretch gap-2'}`}>
        {caption}
        {isTv ? (
          <div className="flex items-center gap-[1.6cqw]">{pauseButton}{nextButton}</div>
        ) : (
          nextButton
        )}
      </div>
    </div>
  );
};

// ── Swipe gestures (mobile): left = Next, right = Stop ────────────────

export interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export function useTimerSwipeGestures(
  onNext: () => void,
  onStop: () => void,
  enabled: boolean,
  isNextDisabled: boolean,
): SwipeHandlers {
  const touchStart = useRef<number | null>(null);
  const touchEnd = useRef<number | null>(null);
  const minSwipeDistance = 50;
  const callbacks = useRef({ onNext, onStop, isNextDisabled });
  callbacks.current = { onNext, onStop, isNextDisabled };

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    touchEnd.current = e.targetTouches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(() => {
    const { onNext: next, onStop: stop, isNextDisabled: disabled } = callbacks.current;
    if (!enabled || !touchStart.current || !touchEnd.current) return;

    const distance = touchStart.current - touchEnd.current;
    const activeEl = document.activeElement;
    const isTyping =
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable);

    if (!isTyping) {
      if (distance > minSwipeDistance) {
        if (!disabled) next();
      } else if (distance < -minSwipeDistance) {
        stop();
      }
    }

    touchStart.current = null;
    touchEnd.current = null;
  }, [enabled]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
