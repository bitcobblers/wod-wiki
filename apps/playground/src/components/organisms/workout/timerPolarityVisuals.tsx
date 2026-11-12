/**
 * timerPolarityVisuals — maps `SessionVisualPolarity` to Variant A semantic
 * presentation tokens and renders the shared `<TimerPolarityBadges />` strip.
 */

import React from 'react';
import { Lock } from 'lucide-react';
import type { SessionVisualPolarity } from '@bitcobblers/wod-wiki-engine';

export interface PolarityVisualTokens {
  readonly badgeLabel: string | null;
  readonly badgeClassName: string;
  readonly digitClassName: string;
  readonly containerTintClassName: string;
}

export function resolvePolarityVisuals(
  polarity: SessionVisualPolarity | undefined,
): PolarityVisualTokens {
  switch (polarity) {
    case 'rest':
      return {
        badgeLabel: 'Rest Countdown',
        badgeClassName: 'bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950',
        digitClassName: 'text-metric-rest',
        containerTintClassName: 'rounded-2xl bg-teal-500/5 border border-teal-500/25',
      };
    case 'final5':
      return {
        badgeLabel: 'Final 5s',
        badgeClassName: 'animate-pulse bg-rose-600 text-white',
        digitClassName: 'text-destructive',
        containerTintClassName: 'rounded-2xl bg-rose-500/10 border border-rose-500/40',
      };
    case 'paused':
      return {
        badgeLabel: 'Paused',
        badgeClassName: 'bg-amber-500 text-zinc-950',
        digitClassName: 'text-muted-foreground opacity-80',
        containerTintClassName: 'rounded-2xl bg-amber-500/5 border border-amber-500/30',
      };
    case 'overrun':
      return {
        badgeLabel: 'Complete',
        badgeClassName: 'bg-emerald-600 text-white',
        digitClassName: 'text-emerald-600 dark:text-emerald-400',
        containerTintClassName: 'rounded-2xl bg-emerald-500/5 border border-emerald-500/30',
      };
    case 'work':
    default:
      return {
        badgeLabel: null,
        badgeClassName: '',
        digitClassName: 'text-foreground',
        containerTintClassName: '',
      };
  }
}

export const TimerPolarityBadges: React.FC<{
  readonly polarityVisuals: PolarityVisualTokens;
  readonly isRequiredLockActive?: boolean;
}> = ({ polarityVisuals, isRequiredLockActive }) => {
  if (!polarityVisuals.badgeLabel && !isRequiredLockActive) return null;
  return (
    <div className="flex items-center justify-center gap-1.5">
      {polarityVisuals.badgeLabel && (
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${polarityVisuals.badgeClassName}`}
        >
          {polarityVisuals.badgeLabel}
        </span>
      )}
      {isRequiredLockActive && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
          <Lock className="h-2.5 w-2.5" />
          Locked
        </span>
      )}
    </div>
  );
};
