/**
 * useTourScrollQuests — fires the home tour's scroll quests.
 *
 * Each content stage of the homepage walkthrough (editor / timer /
 * analytics / library) owns a `qs-tour-<stage>` quest declared in
 * markdown/canvas/home/README.md. As the visitor scrolls a stage into
 * view — or, under `prefers-reduced-motion`, scrolls the matching static
 * card into view — the caller invokes `markStageViewed(stageId)` and the
 * quest is marked complete in the page-scoped ledger (monotonic — never
 * un-completed).
 *
 * Safe on any page: stages whose quest id is not declared on the page are
 * ignored, as are non-content stages (`overview`).
 */

import { useCallback, useRef } from 'react';
import { usePageQuests, type Quest } from './usePageQuests';

/** Tour stage/section id → quest id. */
export const TOUR_STAGE_QUEST_IDS: Record<string, string> = {
  'session-insights': 'qs-tour-analytics',
};

/**
 * Validation types that require an external interaction signal (a run actually
 * starting, a workout completing, etc.). Scroll/visibility alone must not mark
 * these quests complete.
 */
const INTERACTION_VALIDATIONS: Record<string, true> = {
  'workout-complete': true,
  'run-started': true,
};

export function useTourScrollQuests(
  pageRoute: string,
  quests: Quest[],
): (stageId: string) => void {
  const { markComplete } = usePageQuests(pageRoute, quests);

  // Ref so the returned callback stays stable when the quests array
  // identity changes between renders. Interaction-gated quests are excluded
  // here because their completion is driven by an external signal, not scroll.
  const questIdsRef = useRef<Set<string>>(new Set());
  questIdsRef.current = new Set(
    quests
      .filter((q) => !q.validation || !INTERACTION_VALIDATIONS[q.validation.type])
      .map((q) => q.id),
  );

  return useCallback(
    (stageId: string) => {
      const questId = TOUR_STAGE_QUEST_IDS[stageId];
      if (questId && questIdsRef.current.has(questId)) {
        markComplete(questId);
      }
    },
    [markComplete],
  );
}
