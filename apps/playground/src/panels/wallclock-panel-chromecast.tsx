/**
 * wallclock-panel-chromecast.tsx — Chromecast receiver timer panel.
 *
 * Renders the General (Tier 2) timer surface — the receiver default per the
 * timer-surfaces design — plus the shared clock command board (reps, value
 * entry, stop confirmation) mounted with explicit `snapshot`/`sendCommand`
 * props. The receiver owns no state and performs no success mutation: every
 * control dispatches a `ClockCommand` to the browser authority and the next
 * authoritative snapshot renders the result.
 *
 * Availability and paused state come from the snapshot (`canNext`, `status`),
 * never from local guesses, so paused Next is visibly disabled on the TV
 * exactly like it is on the browser.
 */

import React from 'react';
import { GeneralTimerSurface } from '@/components/organisms/workout/GeneralTimerSurface';
import { useTimerSurfaceModel } from '@/components/organisms/workout/useTimerSurfaceModel';
import { ClockCommandBoard } from '@/clock/ClockCommandBoard';
import type { ClockCommand, ClockSnapshot } from '@/clock/clockCommands';
import type { FocusProps } from '@/hooks/useSpatialNavigation';

export const ReceiverTimerPanel: React.FC<{
  /** Transported authoritative snapshot; `null` disables every control. */
  snapshot: ClockSnapshot | null;
  /** Send one command to the browser authority (runId attached upstream). */
  sendCommand: (command: ClockCommand) => void;
  getFocusProps?: (id: string) => FocusProps;
  /** Workout title for the top bar (receiver workbench state may not carry it) */
  workoutTitle?: string;
}> = ({ snapshot, sendCommand, getFocusProps, workoutTitle }) => {
  const command = (cmd: ClockCommand): void => {
    if (!snapshot) return; // Disconnected / no active run: controls are dead.
    sendCommand(cmd);
  };

  const handlers = {
    onStart: () => command(snapshot?.phase === 'ready' ? { kind: 'ready-start' } : { kind: 'playback' }),
    onPause: () => command({ kind: 'playback' }),
    onStop: () => command({ kind: 'stop-request' }),
    onNext: () => command({ kind: 'next' }),
    isPaused: !snapshot || snapshot.status === 'paused',
    // Availability is the authority's, mirrored verbatim.
    canNext: snapshot?.canNext ?? false,
  };

  const model = useTimerSurfaceModel(handlers);

  return (
    <div className="flex-1 flex flex-col justify-center">
      <GeneralTimerSurface
        model={model}
        {...handlers}
        workoutTitle={workoutTitle}
        getFocusProps={getFocusProps}
      />
      {!snapshot && (
        <div
          data-testid="receiver-controls-disabled"
          className="shrink-0 pb-4 text-center text-sm font-mono uppercase tracking-widest text-muted-foreground"
        >
          No active clock — controls disabled
        </div>
      )}
      {snapshot && (
        <div className="shrink-0 px-10 pb-4" data-clock-panel>
          <ClockCommandBoard
            snapshot={snapshot}
            dispatch={(cmd) => {
              // Sent is the strongest claim the receiver can make — the
              // browser authority owns acceptance and the next snapshot
              // tells the truth (busy ack via snapshot.saving/error).
              command(cmd);
              return true;
            }}
            getFocusProps={getFocusProps}
          />
        </div>
      )}
    </div>
  );
};
