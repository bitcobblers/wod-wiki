import type { Note } from './types/storage';
import {
  isNonPublishableNotebook,
  resolveNoteOwnership,
  type NoteOwnershipInput,
  type ResolvedNoteOwnership,
} from './types/notebook';

export type PublicationVisibility =
  | 'Private'
  | 'Published Note'
  | 'Published Note + Data';

export type PublicationStatusLabel =
  | PublicationVisibility
  | 'Subscribed Feed'
  | 'Archived Feed'
  | 'System';

export interface PublicationVisibilitySummary {
  visibility: PublicationVisibility;
  /** Unambiguous status label that never labels non-owned notes (`kind !== 'user'`) as `'Private'`. */
  displayLabel?: PublicationStatusLabel;
  ownership?: ResolvedNoteOwnership;
  canPublish?: boolean;
  notebookPublic: boolean;
  publicSessions: number;
  totalSessions: number;
  notebookId?: string;
  notebookIds?: string[];
  publicNotebookIds?: string[];
}

export function isPublishableNotebookLanding(
  note: Pick<Note, 'id' | 'notebookId' | 'feedOrigin' | 'seedOrigin' | 'retention' | 'upstreamStatus'>,
): boolean {
  return (
    note.id.startsWith('notebook/') &&
    note.notebookId === note.id &&
    !isNonPublishableNotebook(note.id) &&
    resolveNoteOwnership(note).kind === 'user'
  );
}

export function derivePublicationStatusLabel(
  visibility: PublicationVisibility,
  ownership?: Pick<ResolvedNoteOwnership, 'kind'>,
): PublicationStatusLabel {
  if (!ownership || ownership.kind === 'user') return visibility;
  if (ownership.kind === 'feed') return 'Subscribed Feed';
  if (ownership.kind === 'feed-archived') return 'Archived Feed';
  return 'System';
}

export function derivePublicationVisibility(input: {
  notebookPublic?: boolean;
  publicSessions: number;
  totalSessions: number;
  notebookId?: string;
  notebookIds?: string[];
  publicNotebookIds?: string[];
  ownership?: ResolvedNoteOwnership;
  note?: NoteOwnershipInput;
}): PublicationVisibilitySummary {
  const ownership =
    input.ownership ??
    (input.note ? resolveNoteOwnership(input.note, undefined, input.notebookId) : undefined);
  const nonOwned = Boolean(ownership && ownership.kind !== 'user');
  const notebookPublic = nonOwned ? false : input.notebookPublic === true;
  const publicSessions = nonOwned ? 0 : Math.max(0, Math.trunc(input.publicSessions));
  const totalSessions = Math.max(publicSessions, Math.trunc(input.totalSessions));
  const visibility: PublicationVisibility = !notebookPublic
    ? 'Private'
    : publicSessions > 0
      ? 'Published Note + Data'
      : 'Published Note';
  const displayLabel = derivePublicationStatusLabel(visibility, ownership);
  const canPublish = ownership ? ownership.canPublish : !nonOwned;

  return {
    visibility,
    displayLabel,
    ...(ownership ? { ownership } : {}),
    canPublish,
    notebookPublic,
    publicSessions,
    totalSessions,
    ...(input.notebookId ? { notebookId: input.notebookId } : {}),
    ...(input.notebookIds ? { notebookIds: input.notebookIds } : {}),
    ...(input.publicNotebookIds ? { publicNotebookIds: input.publicNotebookIds } : {}),
  };
}
