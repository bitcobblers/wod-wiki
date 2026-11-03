import { describe, expect, it } from 'vitest';
import {
  hasRunnableFence,
  notebookLabelForNote,
  sortNotesRunnableFirst,
} from '../src/playground/PlaygroundLibraryPage';

describe('PlaygroundLibraryPage side-loader helpers', () => {
  it('detects runnable time and log fences in note markdown', () => {
    expect(hasRunnableFence('# Fran\n\n```time\n(21-15-9)\n  Thrusters @95lb\n```')).toBe(true);
    expect(hasRunnableFence('# Rowing\n\n```log:rowing\n5:00\n```')).toBe(true);
    expect(hasRunnableFence('---\ntype: effort\nlabel: Thruster\n---\n# Thruster')).toBe(false);
  });

  it('resolves readable notebook labels from note provenance', () => {
    expect(notebookLabelForNote({ sourcePath: 'markdown/canvas/guide/amrap.md' })).toBe('guides');
    expect(notebookLabelForNote({ sourceId: 'efforts' })).toBe('efforts');
    expect(notebookLabelForNote({ notebookId: 'notebook/crossfit-girls' })).toBe('crossfit-girls');
  });

  it('orders runnable workout notes ahead of effort definition and plain reference notes', () => {
    const notes = [
      { title: 'Dumbbell Snatch', type: 'effort', rawContent: '---\ntype: effort\n---\n# Dumbbell Snatch' },
      { title: 'Filter Combos', type: 'note', rawContent: '# Query sandbox\n\n```query\n:note{}\n```' },
      { title: 'Classic AMRAP', type: 'note', rawContent: '# Classic AMRAP\n\n```time\n12:00 AMRAP\n  5 Pull-ups\n```' },
    ];

    const sorted = sortNotesRunnableFirst(notes);
    expect(sorted.map((n) => n.title)).toEqual([
      'Classic AMRAP',
      'Filter Combos',
      'Dumbbell Snatch',
    ]);
  });
});
