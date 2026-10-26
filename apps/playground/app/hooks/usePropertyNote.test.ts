import { describe, expect, it } from 'bun:test';
import { buildTagNoteDocument } from './usePropertyNote';

describe('buildTagNoteDocument', () => {
  it('preserves metrics and summaries contributed by a Tag Property Note', () => {
    const doc = buildTagNoteDocument({
      id: 'tag-tonnage',
      label: 'tonnage',
      createdAt: 0,
      contributions: [
        { kind: 'metric', type: 'resistance', value: 24, unit: 'kg' },
        { kind: 'metric', type: 'work', value: 'reps * resistance' },
        { kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' },
      ],
    });

    expect(doc).toContain('metrics.resistance: 24 kg');
    expect(doc).toContain('metrics.work: "reps * resistance"');
    expect(doc).toContain('summaries.totalWork: sum(work)');
  });
});
