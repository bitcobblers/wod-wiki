import type { BlockRevision, Note } from '@bitcobblers/wod-wiki-core';

const tripletFence = '```time\n5 Rounds\n  15 Kettlebell Swings 24 kg\n  12 Push-ups\n  9 Box Jumps 24 in\n```';
const squatFence = '```time\n5 Sets\n  5 Back Squats 315 lb\n  *2:30 Rest\n```';
const tripletSource = `# Morning Functional Triplet\n\n${tripletFence}`;
const squatSource = `# Afternoon Heavy Back Squat\n\n5x5 Working Sets at 75% 1RM.\n\n${squatFence}`;
const notes: Note[] = [
  {
    id: 'note-c4d8e2a1-7b3f-4890-a51b-18f9e6123456',
    title: 'Morning Functional Triplet',
    createdAt: 1790236800000,
    tags: ['conditioning', 'kettlebell'],
    rawContent: tripletSource,
    sourceRevision: 1,
    blocks: {
      'triplet-workout': {
        id: 'triplet-workout', kind: 'wod', version: 1, sourceRevision: 1,
        from: tripletSource.indexOf(tripletFence), to: tripletSource.length, dialect: 'time',
      },
    },
  },
  {
    id: 'note-8e1f2b4c-9a0d-4567-bcde-23456789abcd',
    title: 'Afternoon Heavy Back Squat',
    createdAt: 1790258400000,
    tags: ['strength', 'squat'],
    rawContent: squatSource,
    sourceRevision: 1,
    blocks: {
      'squat-workout': {
        id: 'squat-workout', kind: 'wod', version: 1, sourceRevision: 1,
        from: squatSource.indexOf(squatFence), to: squatSource.length, dialect: 'time',
      },
    },
  },
];
const revisions: BlockRevision[] = notes.flatMap((note) => Object.values(note.blocks).map((block) => ({
  noteId: note.id,
  blockId: block.id,
  version: block.version,
  kind: block.kind,
  rawContent: note.rawContent.slice(block.from, block.to),
  dialect: block.dialect,
  savedAt: note.createdAt,
})));

export default {
  date: '2026-09-24',
  page: { id: 'page-2026-09-24', date: '2026-09-24', title: 'Thursday, September 24, 2026' },
  notes,
  revisions,
};
