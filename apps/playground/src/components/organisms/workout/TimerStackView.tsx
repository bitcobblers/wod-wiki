import React, { useMemo, useRef, useCallback, useLayoutEffect, useState } from 'react';
import { Play, Pause, SkipForward, Square, Timer } from 'lucide-react';
import { ITimerDisplayEntry, IDisplayCardEntry } from '@/clock/types/DisplayTypes';
import { formatTimeMMSS } from '@/lib/formatTime';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import { useAudio } from '@/contexts/AudioContext';
import type { AudioContextType } from '@/contexts/AudioContext';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';

export interface TimerStackViewProps {
    elapsedMs: number;
    hasActiveBlock: boolean;
    onStart: () => void;
    onPause: () => void;
    onStop: () => void;
    onNext: () => void;
    isRunning: boolean;
    isPaused?: boolean;
    disableNext?: boolean;
    primaryTimer?: ITimerDisplayEntry;
    currentCard?: IDisplayCardEntry;
    compact?: boolean;
    subLabel?: string;
    subLabels?: string[];

    /** Map of all active timer states by block ID (ownerId) */
    timerStates?: Map<string, {
        elapsed: number;
        duration?: number;
        format: 'down' | 'up';
    }>;
    actions?: unknown[];
    onAction?: (eventName: string, payload?: unknown) => void;
    secondaryTimers?: ITimerDisplayEntry[];
    focusedBlockId?: string;
    stackItems?: unknown[];
    /** Spatial navigation focus props for TV remote support */
    getFocusProps?: (id: string) => FocusProps;
    /** Whether swipe gestures are enabled (e.g. only in 'track' view) */
    enableGestures?: boolean;
    /** When true, flash "Timer can't be skipped!" above the timer circle for 3 seconds */
    skipFlash?: boolean;
    /** Unique key incremented on each skip attempt to restart the animation */
    skipFlashKey?: number;
}

const formatTime = formatTimeMMSS;

export function getPrimaryTimerFontSizePx(panelWidth: number, compact: boolean, panelHeight = 0): number {
    const width = panelWidth > 0 ? panelWidth : 800;

    // Five clock characters must fit the measured panel width.
    const widthFit = compact
        ? Math.min(Math.max(width * 0.14, 56), 72, width * 0.3)
        : Math.min(Math.max(width * 0.18, 128), 320, width * 0.3);

    // FitArea trims the remaining band after fixed labels and controls.
    if (panelHeight > 0) {
        const reservedChromePx = compact ? 180 : panelHeight < 560 ? 240 : 400;
        return Math.round(Math.min(widthFit, Math.max(44, panelHeight - reservedChromePx)));
    }

    return Math.round(widthFit);
}

/**
 * FitArea — scales its content to fit the fixed-height band it lives in.
 *
 * Layout stability contract: the clock and controls must never move when
 * label lines change (segment swaps, round counters, grouped statement
 * rows, long effort names). FitArea measures its content against the band
 * and applies a transform scale — transforms don't affect flow, so the
 * band's geometry (and everything anchored around it) stays constant.
 */
export const FitArea: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useLayoutEffect(() => {
        const outer = outerRef.current;
        const inner = innerRef.current;
        if (!outer || !inner) return;
        const measure = () => {
            const next = Math.min(
                1,
                outer.clientWidth / Math.max(inner.scrollWidth, 1),
                outer.clientHeight / Math.max(inner.scrollHeight, 1),
            );
            setScale(Number.isFinite(next) ? Math.max(0, next) : 0);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(outer);
        observer.observe(inner);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={outerRef} className="flex h-full min-h-0 w-full items-center justify-center">
            <div
                ref={innerRef}
                className="shrink-0 text-center"
                style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
            >
                {children}
            </div>
        </div>
    );
};

export const TimerStackView: React.FC<TimerStackViewProps> = ({
    onStart,
    onPause,
    onStop,
    onNext,
    isRunning,
    isPaused = false,
    disableNext,
    primaryTimer,
    compact = false,
    subLabel,
    subLabels,
    secondaryTimers,

    timerStates,
    getFocusProps,
    enableGestures = true,
    skipFlash = false,
    skipFlashKey = 0,
}) => {
    const { width: panelWidth, height: panelHeight, isShort: panelIsShort } = usePanelSize();

    let audio: AudioContextType | null = null;
    try {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        audio = useAudio();
    } catch { /* ignore if provider missing */ }

    // Very short hosts fit clock and controls side by side instead of vertically.
    const tight = panelHeight > 0 && panelHeight < 200;

    // Tight hosts need 48px controls even if the context's short flag is false.
    const dense = compact || panelIsShort || tight;

    const primaryTimerFontSizePx = useMemo(
        () => getPrimaryTimerFontSizePx(panelWidth, compact, panelHeight),
        [panelWidth, panelHeight, compact],
    );

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

    const isNextDisabled = disableNext ?? isPaused;
    const primaryControlLabel = isPaused ? 'Continue' : isRunning ? 'Pause' : 'Start';

    const handleNext = useCallback(() => {
        if (isNextDisabled) return;
        audio?.playClick();
        onNext();
    }, [audio, isNextDisabled, onNext]);

    // --- Swipe Gesture Logic ---
    const touchStart = useRef<number | null>(null);
    const touchEnd = useRef<number | null>(null);
    const minSwipeDistance = 50;

    const onTouchStart = (e: React.TouchEvent) => {
        touchEnd.current = null;
        touchStart.current = e.targetTouches[0].clientX;
    };

    const onTouchMove = (e: React.TouchEvent) => {
        touchEnd.current = e.targetTouches[0].clientX;
    };

    const onTouchEnd = useCallback(() => {
        if (!enableGestures || !touchStart.current || !touchEnd.current) return;
        
        const distance = touchStart.current - touchEnd.current;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;

        // Don't trigger if user is typing
        const activeEl = document.activeElement;
        const isTyping = activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'TEXTAREA' || 
            (activeEl as HTMLElement).isContentEditable
        );

        if (!isTyping) {
            if (isLeftSwipe) {
                if (isNextDisabled) return;
                console.log('Swipe Left -> Next');
                handleNext();
            } else if (isRightSwipe) {
                console.log('Swipe Right -> Stop');
                handleStop();
            }
        }
        
        touchStart.current = null;
        touchEnd.current = null;
    }, [enableGestures, handleNext, handleStop, isNextDisabled]);

    // Determine which timer is "Focused" for the big ring
    // Default to the primaryTimer (usually the leaf) if no focus override
    // If focusedBlockId is present, try to find that timer.
    const effectivePrimaryTimer = primaryTimer;

    // Calculate progress for the ring based on EFFECTIVE primary timer
    // We need the state for this timer.
    const effectiveTimerState = useMemo(() => {
        if (!effectivePrimaryTimer) return undefined;
        // Try to get from the passed `timerStates` map first for accuracy
        if (timerStates && timerStates.has(effectivePrimaryTimer.ownerId)) {
            return timerStates.get(effectivePrimaryTimer.ownerId);
        }
        // Fallback to timer entry data + global elapsed if it matches the 'active' one?
        // Logic: if effective is THE primary, use elapsedMs.
        return {
            elapsed: effectivePrimaryTimer.accumulatedMs || 0,
            duration: effectivePrimaryTimer.durationMs,
            format: effectivePrimaryTimer.format
        };
    }, [effectivePrimaryTimer, timerStates]);

    const displayTimeMs = useMemo(() => {
        if (!effectiveTimerState) return 0;
        if (effectiveTimerState.format === 'down' && effectiveTimerState.duration) {
            return Math.max(0, effectiveTimerState.duration - effectiveTimerState.elapsed);
        }
        return effectiveTimerState.elapsed;
    }, [effectiveTimerState]);

    // --- Secondary Timers ---
    // Compute live display values for each secondary timer, handling edge cases:
    // - missing timerStates entry → fallback to accumulatedMs
    // - countdown format → show remaining time (clamped to 0)
    // - null/undefined/empty secondaryTimers → hide section entirely
    const secondaryTimerData = useMemo(() => {
        if (!secondaryTimers || secondaryTimers.length === 0) return [];
        return secondaryTimers.map(st => {
            const state = timerStates?.get(st.ownerId);
            const elapsed = state?.elapsed ?? st.accumulatedMs ?? 0;
            const duration = state?.duration ?? st.durationMs;
            const format = state?.format ?? st.format ?? 'up';
            const displayMs = format === 'down' && duration
                ? Math.max(0, duration - elapsed)
                : elapsed;
            return {
                id: st.id,
                ownerId: st.ownerId,
                label: st.label || 'Timer',
                displayMs,
                format,
            };
        });
    }, [secondaryTimers, timerStates]);

    // --- Responsive layout classes ---
    // compact = mobile/narrow container (from PanelSizeContext)
    // We use different layouts for compact vs wide

    return (
        <div 
            className={`flex w-full flex-1 ${tight ? `flex-row items-stretch gap-2 min-h-[80px]` : `flex-col ${dense ? (compact ? 'min-h-[136px]' : 'min-h-[112px]') : 'min-h-[192px]'} ${compact ? '' : dense ? 'gap-2' : 'gap-4'}`}`}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
        >
            <style>{`
                @keyframes skip-flash-fade {
                    0%   { opacity: 1; transform: translateY(0); }
                    70%  { opacity: 1; transform: translateY(-4px); }
                    100% { opacity: 0; transform: translateY(-8px); }
                }
                .animate-skip-flash {
                }
            `}</style>

            {/* Main Content Area */}
            <div className={`flex-1 min-h-0 flex flex-col items-center justify-center overflow-hidden ${dense ? 'px-4 py-1' : 'p-4'} ${tight ? 'min-w-0' : ''}`}>

                {/* Timer & Controls Container */}
                <div className="flex flex-col items-center justify-center h-full relative w-full">
                    {/* Skip-attempt flash message — appears above the timer */}
                    {skipFlash && (
                        <div
                            key={skipFlashKey}
                            className="animate-skip-flash absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap bg-signal-caution text-white dark:text-white text-sm font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none z-20"
                            role="status"
                            aria-live="polite"
                        >
                            Timer can&#39;t be skipped!
                        </div>
                    )}

                    {/* Labels above timer — reserved fixed-height band. The band
                        renders identically in every state; FitArea scales the
                        content to fit, so label/summary churn never shifts the
                        clock or controls. */}
                    <div className={`flex w-full items-center justify-center overflow-hidden ${dense ? 'h-8 min-h-0 shrink mb-1' : 'h-24 mb-6 shrink-0'}`}>
                        <FitArea>
                            {primaryTimer?.label && (
                                <h2 className={`font-semibold text-foreground tracking-tight ${dense ? 'text-lg' : 'text-3xl lg:text-4xl'}`}>
                                    {primaryTimer.label}
                                </h2>
                            )}
                            {subLabels && subLabels.length > 0 && (
                                <div className={`${dense ? 'mt-1 space-y-0.5' : 'mt-2 space-y-1'}`}>
                                    {subLabels.map((line, i) => (
                                        <p key={i} className={`text-muted-foreground ${dense ? 'text-xs' : 'text-lg lg:text-xl'}`}>
                                            {line}
                                        </p>
                                    ))}
                                </div>
                            )}
                            {subLabels === undefined && subLabel && (
                                <p className={`text-muted-foreground ${dense ? 'mt-1 text-xs' : 'mt-2 text-lg lg:text-xl'}`}>
                                    {subLabel}
                                </p>
                            )}
                        </FitArea>
                    </div>

                    {/* Very Large Timer Number (no circle) — the clock owns the
                        remaining band (flex-1 min-h-0) and FitArea scales the
                        digits to the measured width AND height of that band, so
                        bounded embedded contexts shrink digits instead of
                        clipping them. */}
                    <div className="relative flex min-h-12 w-full flex-1 items-center justify-center">
                        <button
                            onClick={isPaused ? handleStart : isRunning ? handlePause : handleStart}
                            {...(getFocusProps ? getFocusProps('timer-main') : {})}
                            className={`tv-focusable relative z-10 flex h-full max-h-full min-h-[48px] w-full items-center justify-center focus:outline-none focus-visible:outline-2 focus-visible:outline-ring group ${dense ? 'py-1' : 'py-8'}`}
                            title={primaryControlLabel}
                        >
                            <FitArea>
                                <span
                                    className="block font-mono font-bold tracking-tighter text-foreground tabular-nums leading-none"
                                    style={{ fontSize: `${primaryTimerFontSizePx}px` }}
                                    role="timer"
                                    aria-live="polite"
                                    aria-atomic="true"
                                >
                                    {formatTime(displayTimeMs)}
                                </span>
                            </FitArea>
                        </button>
                    </div>

                    {/* Secondary Timers — smaller context clocks for parent
                        intervals. Reserved fixed-height band renders identically
                        when empty, so chips appearing never shifts the clock. */}
                    <div className={`flex w-full items-center justify-center overflow-hidden ${dense ? 'mt-1 h-6 min-h-0 shrink' : 'mt-6 h-[60px] shrink-0'}`}>
                        <div className={`flex items-center justify-center gap-2 ${dense ? 'flex-wrap' : 'gap-4'}`}>
                            {secondaryTimerData.map((st, index) => (
                                <div
                                    key={st.id}
                                    {...(getFocusProps ? getFocusProps(`secondary-timer-${index}`) : {})}
                                    className={`tv-focusable flex items-center gap-2 rounded-lg border bg-muted/40 text-muted-foreground ${dense ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                                    title={st.label}
                                    role="timer"
                                    aria-label={`${st.label} ${formatTime(st.displayMs)}`}
                                    aria-atomic="true"
                                >
                                    <Timer className={`shrink-0 ${dense ? 'w-3 h-3' : 'w-4 h-4'}`} />
                                    <span className="font-medium truncate max-w-[120px]">{st.label}</span>
                                    <span className="font-mono font-semibold tabular-nums">
                                        {formatTime(st.displayMs)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls Row — adapts between mobile (bottom bar) and desktop (centered buttons).
                Sizing follows the dense tier so short embedded contexts keep controls
                usable instead of pushing them out of the panel; the shape (pill vs
                circular) follows the compact tier only. */}
            <div className={`flex flex-shrink-0 items-center justify-center flex-wrap ${tight ? 'gap-3 px-2 py-1' : compact ? 'px-4 py-3 bg-background border-t border-border gap-3' : dense ? 'gap-6 px-2 py-1' : 'gap-8 px-2 pb-8'}`}>
                {/* Stop Button */}
                <div className={`flex flex-col items-center ${dense ? 'gap-1' : 'gap-2'}`}>
                    <button
                        onClick={handleStop}
                        {...(getFocusProps ? getFocusProps('btn-stop') : {})}
                        className={`tv-focusable group flex items-center justify-center rounded-full border transition-all active:scale-95 ${dense ? 'w-12 h-12 bg-muted border-border' : 'w-16 h-16 bg-surface-container-low border-outline-variant hover:bg-surface-variant shadow-sm'}`}
                        title="Stop Session"
                        data-testid={TEST_IDS.TIMER_STOP_SESSION}
                    >
                        <Square className={`${dense ? 'w-5 h-5' : 'w-7 h-7'} text-foreground group-hover:text-destructive transition-colors`} />
                    </button>
                    {!dense && <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Stop</span>}
                </div>

                {/* Pause/Resume Button */}
                <div className={`flex flex-col items-center ${dense ? 'gap-1' : 'gap-2'}`}>
                    <button
                        onClick={isPaused ? handleStart : isRunning ? handlePause : handleStart}
                        {...(getFocusProps ? getFocusProps('btn-pause') : {})}
                        className={`tv-focusable group flex items-center justify-center rounded-full transition-all active:scale-95 ${dense ? 'w-12 h-12 bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'w-20 h-20 bg-surface-container-low border border-outline-variant hover:bg-surface-variant shadow-sm'}`}
                        title={primaryControlLabel}
                        data-testid={TEST_IDS.TIMER_PLAY_PAUSE}
                    >
                        {isPaused
                            ? <Play className={`${dense ? 'w-6 h-6 text-primary-foreground ml-0.5' : 'w-8 h-8 text-foreground ml-1'}`} />
                            : isRunning
                            ? <Pause className={`${dense ? 'w-6 h-6 text-primary-foreground' : 'w-8 h-8 text-foreground'}`} />
                            : <Play className={`${dense ? 'w-6 h-6 text-primary-foreground ml-0.5' : 'w-8 h-8 text-foreground ml-1'}`} />
                        }
                    </button>
                    {!dense && <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{primaryControlLabel}</span>}
                </div>

                {/* Next Button */}
                {compact ? (
                    /* Mobile: wide pill button */
                    <button
                        onClick={handleNext}
                        disabled={isNextDisabled}
                        aria-disabled={isNextDisabled ? 'true' : undefined}
                        {...(getFocusProps ? getFocusProps('btn-next') : {})}
                        className={`tv-focusable ${tight ? 'h-12 flex-none px-3' : 'flex-1 h-14'} rounded-2xl flex items-center justify-center gap-2 transition-transform shadow-lg ${isNextDisabled ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60' : 'bg-primary text-primary-foreground shadow-primary/20 active:scale-[0.98]'}`}
                        title="Next Block"
                        data-testid={TEST_IDS.TIMER_NEXT_BLOCK}
                    >
                        <span className="text-base font-bold tracking-widest uppercase">Next</span>
                        <SkipForward className="w-5 h-5" />
                    </button>
                ) : (
                    /* Desktop: large circular button */
                    <div className="flex flex-col items-center gap-2">
                        <button
                            onClick={handleNext}
                            disabled={isNextDisabled}
                            aria-disabled={isNextDisabled ? 'true' : undefined}
                            {...(getFocusProps ? getFocusProps('btn-next') : {})}
                            className={`tv-focusable flex items-center justify-center rounded-full transition-all shadow-xl ${dense ? 'w-12 h-12' : 'w-24 h-24'} ${isNextDisabled ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60' : 'bg-primary-container text-on-primary-container hover:bg-primary hover:text-primary-foreground active:scale-90'}`}
                            title="Next Block"
                        data-testid={TEST_IDS.TIMER_NEXT_BLOCK}
                        >
                            <SkipForward className={`font-bold ${dense ? 'w-6 h-6' : 'w-10 h-10'}`} />
                        </button>
                        {!dense && <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-on-primary-container">Next</span>}
                    </div>
                )}
            </div>
        </div >
    );
};
