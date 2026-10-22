import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/atoms/primitives/card';
import { Badge } from '@/components/atoms/primitives/badge';
import { Clock, ArrowRight } from '@phosphor-icons/react';
import { useTimerElapsed } from '@bitcobblers/wod-wiki-engine/react';
import { formatTimePrecise, formatTimeHHMMSS } from '../../lib/formatTime';
import { cn } from '@/lib/utils';

export interface DigitalClockProps {
  /** Block key to connect to runtime timer */
  blockKey: string;
  /** Title for the clock display */
  title?: string;
  /** Duration in milliseconds for countdown timers */
  duration?: number;
  /** Display type: 'countdown' or 'countup' */
  timerType?: 'countdown' | 'countup';
  /** Current round number */
  currentRound?: number;
  /** Optional metrics to display */
  metrics?: Array<{
    label: string;
    value: string | number;
    unit?: string;
  }>;
  /** Next card placeholder text */
  nextCardLabel?: string;
}

/**
 * DigitalClock - A standalone digital clock component designed to be half the width of a screen.
 * 
 * This component:
 * - Attaches to the runtime via blockKey
 * - Displays time in a large digital format
 * - Shows metrics and timers
 * - Includes a placeholder for the next card/exercise
 * 
 * Designed to be used in side-by-side layouts for workout tracking.
 */
export const DigitalClock: React.FC<DigitalClockProps> = ({
  blockKey,
  title = "Session Timer",
  duration,
  timerType = 'countup',
  currentRound = 1,
  metrics = [],
  nextCardLabel = "Next: Get Ready"
}) => {
  // Get elapsed time from runtime
  const { elapsed, isRunning } = useTimerElapsed(blockKey);

  // Calculate display time based on timer type
  const displayTime = useMemo(() => {
    if (timerType === 'countdown' && duration) {
      return Math.max(0, duration - elapsed);
    }
    return elapsed;
  }, [timerType, duration, elapsed]);

  // Format time for digital display - use canonical formatter
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    if (hours > 0) {
      return formatTimeHHMMSS(ms);
    }
    return formatTimePrecise(ms);
  };

  // Calculate progress percentage for countdown
  const progress = useMemo(() => {
    if (timerType === 'countdown' && duration && duration > 0) {
      return Math.min((elapsed / duration) * 100, 100);
    }
    return 0;
  }, [timerType, duration, elapsed]);

  return (
    <Card className="w-full h-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={24} className="text-primary" />
            <h3 className="text-xl font-semibold">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isRunning ? "default" : "secondary"}>
              {isRunning ? "Running" : "Stopped"}
            </Badge>
            <Badge variant="outline">Round {currentRound}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Main Digital Time Display */}
        <div className="relative">
          <div className={cn(
            "text-center font-mono font-bold transition-all duration-300",
            "text-6xl md:text-7xl",
            isRunning ? "text-primary" : "text-foreground"
          )}>
            {formatTime(displayTime)}
          </div>

          {/* Progress bar for countdown */}
          {timerType === 'countdown' && duration && (
            <div className="mt-4">
              <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    progress >= 90 ? "bg-signal-negative" : progress >= 70 ? "bg-signal-caution" : "bg-primary"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>0:00</span>
                <span>{Math.round(progress)}%</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Metrics Display */}
        {metrics.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-muted-foreground mb-3">Metrics</h4>
            <div className="grid grid-cols-2 gap-3">
              {metrics.map((metric, index) => (
                <div
                  key={index}
                  className="bg-secondary/50 rounded-lg p-3"
                >
                  <div className="text-xs text-muted-foreground mb-1">
                    {metric.label}
                  </div>
                  <div className="text-2xl font-bold">
                    {metric.value}
                    {metric.unit && (
                      <span className="text-sm font-normal text-muted-foreground ml-1">
                        {metric.unit}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Next Card Placeholder */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between bg-muted/30 rounded-lg p-4 hover:bg-muted/50 transition-colors cursor-pointer">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Up Next</div>
              <div className="font-semibold">{nextCardLabel}</div>
            </div>
            <ArrowRight size={24} className="text-muted-foreground" />
          </div>
        </div>

        {/* Timer Info */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
          <span>Timer: {timerType === 'countdown' ? 'Countdown' : 'Count Up'}</span>
          <span>Block: {blockKey}</span>
        </div>
      </CardContent>
    </Card>
  );
};
