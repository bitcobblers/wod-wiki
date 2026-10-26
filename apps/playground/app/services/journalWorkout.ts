import type { HistoryEntry } from '@/types/history';
import { formatDateKey } from './dateUtils';
import { normalizeNoteTitle } from '@/lib/noteTitle';
import { journalNotes } from './journalNotes';

export interface CreateJournalNoteFromWorkoutOptions {
  workoutName: string;
  category: string;
  sourceNoteLabel?: string;
  sourceNotePath?: string;
  wodContent: string;
  date?: Date;
  wrapInWod?: boolean;
}

export async function createJournalNoteFromWorkout({
  workoutName,
  category,
  sourceNoteLabel,
  sourceNotePath,
  wodContent,
  date,
  wrapInWod = true,
}: CreateJournalNoteFromWorkoutOptions): Promise<HistoryEntry> {
  const journalDate = formatDateKey(date ?? new Date());
  const resolvedSourcePath = sourceNotePath?.trim() || `/notebook/${encodeURIComponent(category)}`;
  const lines = [
    `# ${workoutName}`,
    '',
  ];

  if (wrapInWod) {
    lines.push('```time', wodContent.trimEnd(), '```');
  } else {
    lines.push(wodContent.trimEnd());
  }
  lines.push('');

  return journalNotes.create({
    journalDate,
    title: normalizeNoteTitle(workoutName),
    rawContent: lines.join('\n'),
    sourceId: resolvedSourcePath,
  });
}
