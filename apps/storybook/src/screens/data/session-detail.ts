import type { BlockRevision, EventRecord, Note, Session } from '@bitcobblers/wod-wiki-core';

const fence = '```time\n1 mi Run\n100 Pull-ups\n200 Push-ups\n300 Squats\n1 mi Run\n```';
const rawContent = `# Murph (Hero WOD)\n\nPartition the calisthenics as needed.\n\n${fence}`;
const note: Note = {
  id: 'note-murph-memorial',
  title: 'Murph (Hero WOD)',
  createdAt: 1789977600000,
  rawContent,
  sourceRevision: 1,
  blocks: {
    'murph-workout': {
      id: 'murph-workout', kind: 'wod', version: 1, sourceRevision: 1,
      from: rawContent.indexOf(fence), to: rawContent.length, dialect: 'time',
    },
  },
};
const revision: BlockRevision = {
  noteId: note.id,
  blockId: 'murph-workout',
  version: 1,
  kind: 'wod',
  rawContent: fence,
  dialect: 'time',
  savedAt: note.createdAt,
};
const session: Session = {
  id: 'sess-murph-2026-09-21',
  noteId: note.id,
  blockId: revision.blockId,
  blockVersion: revision.version,
  startTime: 1789977600000,
  endTime: 1789980180000,
  duration: 2580000,
  completed: true,
  repsCompleted: 600,
  origin: 'journal',
  status: 'completed',
  createdAt: 1789977600000,
};
const outputs = [
  { outputType: 'system', timestamp: 1789977600000, text: 'Workout started: Murph' },
  { outputType: 'segment', timestamp: 1789978065000, text: '1.0 mi Run completed in 7:45' },
  { outputType: 'segment', timestamp: 1789979655000, text: '100 Pull-ups, 200 Push-ups, 300 Squats partitioned' },
  { outputType: 'segment', timestamp: 1789980180000, text: '1.0 mi Run completed in 8:45' },
  { outputType: 'completion', timestamp: 1789980180000, text: 'Workout finished. Total Time: 43:00' },
];
const statements: EventRecord[] = outputs.map((output, index) => ({
  ...output,
  id: `${session.id}:event:${index}`,
  resultId: session.id,
  noteId: session.noteId,
  blockId: session.blockId,
  blockVersion: session.blockVersion,
  origin: session.origin,
  grain: 'event',
  metrics: [],
}));

export default {
  note,
  revision,
  session,
  workoutTitle: note.title,
  metrics: {
    elapsedTime: '43:00', mileOne: '7:45', calisthenics: '26:30', mileTwo: '8:45',
    workOutput: '42.8 kJ', metMinutes: 387,
  },
  statements,
};
