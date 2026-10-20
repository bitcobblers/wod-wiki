/**
 * wallclock-panel-chromecast.tsx — Chromecast receiver timer panel.
 *
 * Renders the General (Tier 2) timer surface — the receiver default per the
 * timer-surfaces design (Kimi_Agent_WOD Timer UI Prototypes/app/index.html):
 * top bar with session clock + workout title + receiver indicators, shared
 * TimerCore hero with secondary chips, and the 10-foot Stop / Pause / Next
 * triad with the up-next caption welded to Next.
 *
 * Keeps receiver-specific event dispatch wiring (start/pause/stop/next);
 * the surface itself has no global key handlers — the receiver's spatial
 * navigation owns D-pad focus ('timer-main', 'btn-stop', 'btn-pause',
 * 'btn-next').
 */

import React from 'react';
import { GeneralTimerSurface } from '@/components/organisms/workout/GeneralTimerSurface';
import { useTimerSurfaceModel } from '@/components/organisms/workout/useTimerSurfaceModel';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import type { IRuntimeEventProvider } from '@bitcobblers/wod-wiki-engine';

export const ReceiverTimerPanel: React.FC<{
  eventProvider: IRuntimeEventProvider;
  getFocusProps?: (id: string) => FocusProps;
  /** Workout title for the top bar (receiver workbench state may not carry it) */
  workoutTitle?: string;
}> = ({ eventProvider, getFocusProps, workoutTitle }) => {
  const dispatchEvent = (name: string): void => {
    eventProvider.dispatch({ name, timestamp: new Date() });
  };

  const handlers = {
    onStart: () => dispatchEvent('start'),
    onPause: () => dispatchEvent('pause'),
    onStop: () => dispatchEvent('stop'),
    onNext: () => dispatchEvent('next'),
    // The receiver's paused state is not synced to the workbench store; the
    // pause/resume toggle derives from live timer spans (same as before).
    isPaused: false,
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
    </div>
  );
};
