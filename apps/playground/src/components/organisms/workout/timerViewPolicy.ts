/**
 * timerViewPolicy — decouples container size tier (`compact` / `wide` / `full`)
 * from viewer interaction role (`touch-or-desk` vs `passive-tv`).
 */

import type { PanelSizeMode } from '@/panels/panel-system/PanelSizeContext';

export type TimerInteractionRole = 'touch-or-desk' | 'passive-tv';

export interface TimerViewPolicyInput {
  readonly sizeMode: PanelSizeMode;
  readonly isReceiver?: boolean;
  readonly enableGestures?: boolean;
}

export interface TimerViewPolicy {
  readonly interactionRole: TimerInteractionRole;
  readonly allowSwipeGestures: boolean;
  readonly allowStackDrawer: boolean;
  readonly showReceiverIndicators: boolean;
}

export function deriveTimerViewPolicy(input: TimerViewPolicyInput): TimerViewPolicy {
  if (input.isReceiver) {
    return {
      interactionRole: 'passive-tv',
      allowSwipeGestures: false,
      allowStackDrawer: false,
      showReceiverIndicators: true,
    };
  }

  const gesturesPermitted = input.enableGestures ?? true;

  return {
    interactionRole: 'touch-or-desk',
    // Sideways phones (812x375 -> wide) retain touch swipe alongside compact phones.
    allowSwipeGestures:
      gesturesPermitted && (input.sizeMode === 'compact' || input.sizeMode === 'wide'),
    // Portrait tablets (768x1024 -> wide) gain on-demand stack drawer access.
    allowStackDrawer: input.sizeMode === 'wide',
    showReceiverIndicators: false,
  };
}
