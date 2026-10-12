import type { BlockRevision, Note } from '@bitcobblers/wod-wiki-core';
import journalDateStackData from './journal-date-stack';

const body = '5 Rounds\n  15 Kettlebell Swings 24 kg\n  12 Push-ups\n  9 Box Jumps 24 in\n  *:45 Rest';
const fence = `\`\`\`time\n${body}\n\`\`\``;
const rawContent = `# Morning Functional Triplet

Active recovery and capacity work before heavy afternoon squatting.
Focus on smooth transitions and steady breathing.

\`\`\`time
${body}
\`\`\`

## Mobility Post-Workout
- 2:00 Couch Stretch per side
- 1:00 Pigeon Pose
`;
const note: Note = {
  id: 'note-c4d8e2a1-7b3f-4890-a51b-18f9e6123456',
  title: 'Morning Functional Triplet',
  createdAt: 1790236800000,
  tags: ['conditioning', 'kettlebell', 'intervals'],
  rawContent,
  sourceRevision: 2,
  blocks: {
    'triplet-workout': {
      id: 'triplet-workout',
      kind: 'wod',
      version: 2,
      sourceRevision: 2,
      from: rawContent.indexOf(fence),
      to: rawContent.indexOf(fence) + fence.length,
      dialect: 'time',
    },
  },
};
const revisions: BlockRevision[] = [
  ...journalDateStackData.revisions.filter((revision) => revision.noteId === note.id),
  {
    noteId: note.id,
    blockId: 'triplet-workout',
    version: 2,
    kind: 'wod',
    rawContent: fence,
    dialect: 'time',
    savedAt: note.createdAt + 60000,
  },
];
export default { note, revisions };
