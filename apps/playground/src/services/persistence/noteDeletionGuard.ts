const deletingNoteIds = new Set<string>();

/** Mark a note ID as currently deleting so in-flight or unmount drafts cannot resurrect it. */
export function markNoteDeleting(noteId: string): void {
  deletingNoteIds.add(noteId);
}

/** Clear an active deletion guard (used when deletion aborts or a test recreates the ID). */
export function unmarkNoteDeleting(noteId: string): void {
  deletingNoteIds.delete(noteId);
}

/** Whether a note ID is currently deleting or was deleted in this page lifecycle. */
export function isNoteDeleting(noteId: string): boolean {
  return deletingNoteIds.has(noteId);
}
