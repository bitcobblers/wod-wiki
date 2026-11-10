/**
 * noteIdentity — typed view over composite noteId strings plus canonical
 * kind→route resolution.
 *
 * ADDITIVE: it never rewrites stored ids — `raw` carries the original string
 * for use as a storage key, so no result is ever orphaned by a format change.
 */

import { dayPath, playgroundPath, notebookItemPath, effortPath, equipmentPath, notePath } from './routes';

/** Which note family a noteId belongs to. */
export type NoteKind = 'journal' | 'playground' | 'workout';

/**
 * A typed, routable reference to a note. `raw` is the authoritative storage
 * key; the other fields are a typed projection of it.
 */
export interface NoteRef {
  /** The note family. `'workout'` is the catch-all for collection / effort / feed ids. */
  kind: NoteKind;
  /** Id within the family: date key (journal), name (playground), or workout name (workout). */
  id: string;
  /** Only for `'workout'`: the category segment (collection slug / `'effort'` / `'feed'`). */
  category?: string;
  /** The original composite noteId string — use as the storage key, never reconstruct it. */
  raw: string;
}

/**
 * Parse a composite noteId into a typed `NoteRef`. Preserves the original
 * string as `raw` so storage keys are never lost.
 */
export function parseNoteId(noteId: string): NoteRef {
  const segs = noteId.split('/');
  const head = segs[0] ?? noteId;
  const name = segs[1] ?? '';
  if (head === 'journal') return { kind: 'journal', id: name, raw: noteId };
  if (head === 'playground') return { kind: 'playground', id: name, raw: noteId };
  if (segs.length < 2) return { kind: 'workout', id: head, raw: noteId };
  return { kind: 'workout', category: head, id: name, raw: noteId };
}

/**
 * Canonical back-route for a note — the single home for the kind→path rule,
 * replacing ad-hoc `noteId.split('/')` switches.
 */
export function noteRefToPath(ref: NoteRef): string {
  switch (ref.kind) {
    case 'journal':
      return dayPath(ref.id);
    case 'playground':
      return playgroundPath(ref.id);
    case 'workout':
      if (ref.category === 'effort') return effortPath(ref.id);
      if (ref.category === 'equipment') return equipmentPath(ref.id);
      return ref.category ? notebookItemPath(ref.category, ref.id) : notePath(ref.raw);
  }
}
