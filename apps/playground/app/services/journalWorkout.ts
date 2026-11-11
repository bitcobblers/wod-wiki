import { buildNoteProvenance } from '@bitcobblers/wod-wiki-engine';
import { notebookOfItem } from '@bitcobblers/wod-wiki-wql';
import type { HistoryRecord } from '@/types/history';
import { normalizeNoteTitle } from '@/lib/noteTitle';
import { storageService } from '@/services/storage';
import { formatDateKey } from './dateUtils';
import { journalNotes } from './journalNotes';

export interface CreateJournalNoteFromWorkoutOptions {
  workoutName: string;
  category: string;
  sourceNoteId?: string;
  sourceNoteLabel?: string;
  sourceNotePath?: string;
  wodContent: string;
  date?: Date;
  wrapInWod?: boolean;
}

export async function createJournalNoteFromWorkout({
  workoutName,
  category,
  sourceNoteId,
  sourceNotePath,
  wodContent,
  date,
  wrapInWod = true,
}: CreateJournalNoteFromWorkoutOptions): Promise<HistoryRecord> {
  const now = date ? date.getTime() : Date.now();
  const journalDate = formatDateKey(date ?? new Date());
  const resolvedSourcePath = sourceNotePath?.trim() || `/notebook/${encodeURIComponent(category)}`;

  let upstream = sourceNoteId ? await storageService.getNote(sourceNoteId).catch(() => undefined) : undefined;
  if (!upstream && sourceNotePath) {
    const all = await storageService.getAllNotes().catch(() => []);
    upstream = all.find((n) => n.sourcePath === sourceNotePath || n.sourceId === sourceNotePath);
  }
  if (upstream) {
    const sourceNb = notebookOfItem(upstream) ?? (category ? `notebook/${category}` : undefined);
    const created = await journalNotes.create({
      journalDate,
      title: normalizeNoteTitle(upstream.title || workoutName),
      rawContent: upstream.rawContent,
      tags: upstream.tags,
      sourceId: upstream.id,
      type: 'journal',
    });
    const stored = await storageService.getNote(created.id);
    if (stored) {
      const provenance = buildNoteProvenance(upstream, sourceNb, now);
      await storageService.saveNote({
        ...stored,
        notebookIds: ['notebook/journal'],
        provenance,
      });
      return {
        ...created,
        rawContent: upstream.rawContent,
        sourceId: upstream.id,
        notebookIds: ['notebook/journal'],
        provenance,
      };
    }
    return created;
  }

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
