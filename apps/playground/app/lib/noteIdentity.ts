/**
 * noteIdentity (route half) — the single home for the kind→route rule.
 *
 * The composite-id parse (`parseNoteId` / `NoteRef`) is pure and shared with
 * the library — it lives in `src/lib/noteIdentity.ts`. What remains here is
 * routing: `noteRefToPath` needs the app's route table (`./routes`), which is
 * playground-level.
 */
import type { NoteRef } from '@/lib/noteIdentity';
import { journalEntryPath, playgroundPath, workoutPath, effortPath, equipmentPath, noteByIdPath } from './routes';

/**
 * Canonical back-route for a note — the single home for the kind→path rule,
 * replacing ad-hoc `noteId.split('/')` switches. Preserves the bare-id → `/`
 * fallback.
 *
 * Effort-backed results record noteId `effort/<slug>` (EffortDetailPage,
 * useEffortContent) — they route to the effort detail page, not a collection.
 */
export function noteRefToPath(ref: NoteRef): string {
  switch (ref.kind) {
    case 'journal':
      return journalEntryPath(ref.id);
    case 'playground':
      return playgroundPath(ref.id);
    case 'workout':
      if (ref.category === 'effort') return effortPath(ref.id);
      if (ref.category === 'equipment') return equipmentPath(ref.id);
      return ref.category ? workoutPath(ref.category, ref.id) : noteByIdPath(ref.raw);
  }
}
