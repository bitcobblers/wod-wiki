import React, { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/atoms/primitives/card';
import { Button } from '@/components/atoms/primitives/button';
import { Badge } from '@/components/atoms/primitives/badge';
import { Progress } from '@/components/atoms/primitives/progress';
import { Label } from '@/components/atoms/primitives/label';
import { PlayIcon, PauseIcon, SquareIcon } from '@phosphor-icons/react';
import { useTimerElapsed } from '@bitcobblers/wod-wiki-engine/react';
import { cn } from '@/lib/utils';

interface ClockAnchorProps {
  blockKey: string;
  title?: string;
  description?: string;
  duration?: number; // in milliseconds for countdown
  showProgress?: boolean;
  showControls?: boolean;
  workoutType?: string
  currentRound?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  onRoundComplete?: () => void;
  isRunning?: boolean; // External control
}

export const ClockAnchor: React.FC<ClockAnchorProps> = ({
  blockKey,
  title = "AMRAP 20",
  description = "As Many Rounds As Possible",
  duration,
  showProgress = true,
  showControls = false,
  workoutType = "FOR_TIME",
  currentRound = 1,
  onPlay,
  onPause,
  onReset,
  onRoundComplete,
  isRunning: externalIsRunning
}) => {
  const { elapsed } = useTimerElapsed(blockKey);
  const [internalIsRunning, setInternalIsRunning] = useState(false);

  // Use external isRunning state if provided, otherwise use internal state
  const isRunning = externalIsRunning ?? internalIsRunning;

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = useCallback(() => {
    if (isRunning) {
      onPause?.();
      setInternalIsRunning(false);
    } else {
      onPlay?.();
      setInternalIsRunning(true);
    }
  }, [isRunning, onPlay, onPause]);

  const handleReset = useCallback(() => {
    onReset?.();
    setInternalIsRunning(false);
  }, [onReset]);

  const renderPlaceholder = () => (
    <Card className="w-full max-w-2xl mx-auto">
      <CardContent className="p-8">
        <div className="text-center space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-foreground">{title}</h2>
            <p className="text-muted-foreground">{description}</p>
            <div className="flex justify-center items-center gap-2">
              <Badge variant="secondary">{workoutType}</Badge>
              <Badge variant="outline">Round {currentRound}</Badge>
            </div>
          </div>

          {/* Timer Display */}
          <div className="space-y-4">
            <Label className="text-sm font-medium text-muted-foreground">
              {duration ? 'Time Remaining' : 'Time Elapsed'}
            </Label>
            <div className="text-6xl font-mono font-bold text-foreground">
              {duration ? formatTime(duration) : '--:--'}
            </div>
            {showProgress && (duration ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Progress</span>
                  <span>0%</span>
                </div>
                <Progress value={0} className="h-3" />
              </div>
            )}
          </div>

          {/* Controls */}
          {showControls && (
            <div className="flex justify-center gap-4 pt-4 border-t">
              <Button
                onClick={handlePlayPause}
                size="lg"
                className="w-32"
              >
                <PlayIcon size={20} className="mr-2" />
                Start
              </Button>

              {onRoundComplete && (
                <Button onClick={onRoundComplete} variant="outline" size="lg">
                  Finish Round
                </Button>
              )}

              <Button onClick={handleReset} variant="destructive" size="lg">
                <SquareIcon size={20} className="mr-2" />
                Reset
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // For countdown timers, show remaining time
  const displayTime = duration ? Math.max(0, duration - elapsed) : elapsed;
  const progress = duration ? Math.min((elapsed / duration) * 100, 100) : 0;

  if (elapsed === 0 && !duration) {
    return renderPlaceholder();
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardContent className="p-8">
        <div className="text-center space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-foreground">{title}</h2>
            <p className="text-muted-foreground">{description}</p>
            <div className="flex justify-center items-center gap-2">
              <Badge variant="secondary">{workoutType}</Badge>
              <Badge variant="outline">Round {currentRound}</Badge>
            </div>
          </div>

          {/* Main Display */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Timer Display */}
            <div className="space-y-4">
              <Label className="text-sm font-medium text-muted-foreground">
                {duration ? 'Time Remaining' : 'Time Elapsed'}
              </Label>
              <div className={cn(
                "text-6xl font-mono font-bold transition-colors",
                isRunning ? "text-primary" : "text-foreground"
              )}>
                {formatTime(displayTime)}
              </div>
              {showProgress && (duration ?? 0) > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Progress</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} className="h-3" />
                </div>
              )}
            </div>

            {/* Status Panel */}
            <div className="space-y-4">
              <Label className="text-sm font-medium text-muted-foreground">
                Status
              </Label>
              <div className="flex flex-col items-center justify-center h-24">
                <div className={cn(
                  "w-4 h-4 rounded-full mb-2",
                  isRunning ? "bg-signal-positive" : "bg-muted-foreground"
                )} />
                <span className="text-lg font-medium">
                  {isRunning ? 'Running' : 'Stopped'}
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          {showControls && (
            <div className="flex justify-center gap-4 pt-4 border-t">
              <Button
                onClick={handlePlayPause}
                size="lg"
                className="w-32"
                variant={isRunning ? "secondary" : "default"}
              >
                {isRunning ? (
                  <>
                    <PauseIcon size={20} className="mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <PlayIcon size={20} className="mr-2" />
                    Start
                  </>
                )}
              </Button>

              {onRoundComplete && (
                <Button onClick={onRoundComplete} variant="outline" size="lg">
                  Finish Round
                </Button>
              )}

              <Button onClick={handleReset} variant="destructive" size="lg">
                <SquareIcon size={20} className="mr-2" />
                Reset
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
