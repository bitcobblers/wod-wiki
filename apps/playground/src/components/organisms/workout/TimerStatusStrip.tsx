/**
 * TimerStatusStrip — session clock + round position dots.
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html, Tier 1 (Minimal):
 * "Status strip, 42px, never moves: session clock on the left, round position
 * as dots on the right. That is all the past this surface admits."
 */

import React from 'react';
import { Timer } from 'lucide-react';
import { formatTimeMMSS } from '@/lib/formatTime';

export interface TimerStatusStripProps {
  sessionElapsedMs: number;
  roundCurrent?: number;
  roundTotal?: number;
}

export const TimerStatusStrip: React.FC<TimerStatusStripProps> = ({
  sessionElapsedMs,
  roundCurrent,
  roundTotal,
}) => {
  const hasRounds = roundCurrent !== undefined && roundTotal !== undefined && roundTotal > 0;

  return (
    <div
      className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4"
      data-testid="timer-status-strip"
    >
      <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums">
        <Timer className="h-[13px] w-[13px]" />
        {formatTimeMMSS(sessionElapsedMs)}
      </span>
      {hasRounds && (
        <span
          className="flex items-center gap-[5px]"
          role="progressbar"
          aria-label={`Round ${roundCurrent} of ${roundTotal}`}
          aria-valuemin={1}
          aria-valuemax={roundTotal}
          aria-valuenow={roundCurrent}
        >
          {Array.from({ length: roundTotal }, (_, i) => {
            const n = i + 1;
            const state = n < (roundCurrent as number) ? 'done' : n === roundCurrent ? 'now' : 'pending';
            return (
              <i
                key={n}
                className={`block h-[7px] w-[7px] rounded-full ${
                  state === 'done'
                    ? 'bg-primary/45'
                    : state === 'now'
                      ? 'bg-primary'
                      : 'bg-border'
                }`}
              />
            );
          })}
        </span>
      )}
    </div>
  );
};
