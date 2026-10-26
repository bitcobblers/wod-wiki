/**
 * Route Definitions & Navigation Helpers
 *
 * Remaining canonical builders:
 *
 *   {noteId}/plan                                    — Plan view
 *   {noteId}/track/{sectionId}                       — Runtime/tracking for a wod section
 *
 * The review route family was retired in #946: `/note/:noteId/review[…]` URLs
 * redirect to the explorer with a rows query (see playground `ReviewRedirect`).
 */

/** Build a fully-qualified hash path for a plan view */
export function planPath(noteId: string): string {
  return `/note/${noteId}/plan`;
}

/**
 * Deep link to the Metric Explorer with a pre-filled WQL query and optional
 * range. The explorer lives at /dashboards (ticket 09 URL scheme).
 */
export function analyticsExplorerPath(options?: { q?: string; weeks?: number }): string {
  const params = new URLSearchParams();
  if (options?.q) params.set('q', options.q);
  if (options?.weeks) params.set('weeks', String(options.weeks));
  const qs = params.toString();
  return `/dashboards${qs ? `?${qs}` : ''}`;
}

/** Build a fully-qualified hash path for the track view */
export function trackPath(noteId: string, sectionId?: string): string {
  if (sectionId) {
    return `/note/${noteId}/track/${sectionId}`;
  }
  return `/note/${noteId}/track`;
}
