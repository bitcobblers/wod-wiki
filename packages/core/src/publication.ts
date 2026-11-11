import type { Note } from './types/storage';

export type PublicationVisibility =
  | 'Private'
  | 'Published Note'
  | 'Published Note + Data';

export interface PublicationVisibilitySummary {
  visibility: PublicationVisibility;
  notebookPublic: boolean;
  publicSessions: number;
  totalSessions: number;
  notebookId?: string;
}

export function isPublishableNotebookLanding(
  note: Pick<Note, 'id' | 'notebookId' | 'feedOrigin' | 'seedOrigin'>,
): boolean {
  return (
    note.id.startsWith('notebook/') &&
    note.notebookId === note.id &&
    note.feedOrigin !== 'feed' &&
    note.seedOrigin !== 'seed'
  );
}

export function derivePublicationVisibility(input: {
  notebookPublic?: boolean;
  publicSessions: number;
  totalSessions: number;
  notebookId?: string;
}): PublicationVisibilitySummary {
  const notebookPublic = input.notebookPublic === true;
  const publicSessions = Math.max(0, Math.trunc(input.publicSessions));
  const totalSessions = Math.max(publicSessions, Math.trunc(input.totalSessions));
  const visibility: PublicationVisibility = !notebookPublic
    ? 'Private'
    : publicSessions > 0
      ? 'Published Note + Data'
      : 'Published Note';

  return {
    visibility,
    notebookPublic,
    publicSessions,
    totalSessions,
    ...(input.notebookId ? { notebookId: input.notebookId } : {}),
  };
}
