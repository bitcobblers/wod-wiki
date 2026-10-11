/**
 * Pure exchange-format coverage: note markdown composition by version,
 * identity stamping, and session CSV round-trips.
 */
import { describe, it, expect } from 'vitest';
import {
  composeNoteMarkdown,
  csvToSessionRows,
  csvToEquipmentLabels,
  effortToMarkdown,
  equipmentToCsv,
  extractNoteIdentity,
  extractTypedTags,
  injectIdentityFrontmatter,
  markdownToEffort,
  sessionToCsv,
  SESSION_CSV_HEADER,
} from '../src/exchange';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { Note, NoteSegment, Session } from '@bitcobblers/wod-wiki-storage';

const note: Note = { id: '11111111-1111-4111-8111-111111111111', title: 'Fran', createdAt: 1 };

const seg = (id: string, version: number, rawContent: string, position: number): NoteSegment => ({
  id,
  noteId: note.id,
  version,
  position,
  dataType: 'wod',
  data: null,
  rawContent,
  sourceContent: `\`\`\`time\n${rawContent}\n\`\`\``,
  createdAt: 1,
  isHistory: version < 2,
});

describe('exchange note markdown', () => {
  it('extracts stamped identity from frontmatter only when the id is a uuid', () => {
    const stamped = injectIdentityFrontmatter('# Hi\n', { noteId: note.id, title: 'Fran' });
    expect(extractNoteIdentity(stamped)).toEqual({ noteId: note.id, title: 'Fran' });
    expect(extractNoteIdentity('---\nwod-note-id: not-a-uuid\n---\n# Hi\n')).toBeUndefined();
    expect(extractNoteIdentity('# no frontmatter\n')).toBeUndefined();
  });

  it('replaces existing frontmatter keys instead of duplicating them', () => {
    const md = '---\ntitle: Old\nsport: crossfit\n---\n# Fran\n';
    const stamped = injectIdentityFrontmatter(md, { noteId: note.id, title: 'Fran' });
    const identity = extractNoteIdentity(stamped);
    expect(identity?.noteId).toBe(note.id);
    expect(stamped.match(/title:/g)?.length).toBe(1);
    expect(stamped).toContain('sport: crossfit');
  });

  it('composes as-of a version: rows past the cap never appear', () => {
    const segments = [
      { ...seg('a', 1, '3 Rounds', 0) },
      { ...seg('a', 2, '5 Rounds', 0), sourceContent: undefined },
      { ...seg('b', 1, '- 9 pull-up', 1) },
      // Re-keyed chain: a history-only id (e.g. after an edit shifted line
      // numbers) — excluded from latest, present in as-of compositions.
      { ...seg('c', 1, '- 7 deadlift', 2) },
    ];
    const v1 = composeNoteMarkdown(note, segments, 1);
    expect(v1).toContain('3 Rounds');
    expect(v1).toContain('9 pull-up');
    expect(v1).toContain('7 deadlift');
    expect(v1).not.toContain('5 Rounds');

    const latest = composeNoteMarkdown(note, segments);
    expect(latest).toContain('5 Rounds');
    expect(latest).not.toContain('7 deadlift');
    // Version 2 lost its source slice → falls back to re-fenced rawContent.
    expect(latest).toContain('```time');
    expect(latest).toContain('wod-note-id: 11111111-1111-4111-8111-111111111111');
  });
});

const session: Session = {
  id: '22222222-2222-4222-8222-222222222222',
  noteId: note.id,
  origin: 'journal',
  status: 'completed',
  startTime: 1000,
  endTime: 2000,
  duration: 1000,
  completed: true,
  createdAt: 2000,
};

const events: EventRecord[] = [
  {
    id: `${session.id}:0`,
    resultId: session.id,
    noteId: note.id,
    timestamp: 1100,
    grain: 'event',
    outputType: 'rep',
    metrics: [{ type: 'rep', value: 5, unit: 'count', origin: 'direct', metadata: { k: 'v' } }],
    metricTemporal: [{ temporalKind: 'instant', instant: 1100 }],
  },
  {
    id: `${session.id}:summary:reps`,
    resultId: session.id,
    noteId: note.id,
    timestamp: 2000,
    grain: 'summary',
    outputType: 'totalReps',
    representationKind: 'calculated',
    metrics: [{ type: 'round', value: 3 }],
  },
];

describe('exchange session CSV', () => {
  it('round-trips a session + events through CSV verbatim', () => {
    const csv = sessionToCsv(session, events);
    const lines = csv.trim().split('\n');
    expect(parseHeader(lines[0])).toEqual(SESSION_CSV_HEADER);
    // One session anchor row + one row per metric (2 events × 1 metric).
    expect(lines.length).toBe(1 + 1 + 2);

    const parsed = csvToSessionRows(csv);
    expect(parsed.session).toEqual(session);
    expect(parsed.events.length).toBe(2);
    const rep = parsed.events.find((e) => e.id === `${session.id}:0`)!;
    expect(rep.metrics).toEqual([{ type: 'rep', value: 5, unit: 'count', origin: 'direct', metadata: { k: 'v' } }]);
    expect(rep.metricTemporal).toEqual([{ temporalKind: 'instant', instant: 1100 }]);
    const summary = parsed.events.find((e) => e.grain === 'summary')!;
    expect(summary.representationKind).toBe('calculated');
    expect(summary.metrics).toEqual([{ type: 'round', value: 3 }]);
  });

  it('preserves commas, quotes, and newlines in text fields', () => {
    const fancy: EventRecord[] = [
      {
        ...events[0],
        id: `${session.id}:1`,
        text: 'a, "b"\nc',
        metrics: [{ type: 'note', value: 'x,y' }],
      },
    ];
    const parsed = csvToSessionRows(sessionToCsv(session, fancy));
    expect(parsed.events[0].text).toBe('a, "b"\nc');
    expect(parsed.events[0].metrics[0].value).toBe('x,y');
  });

  it('rejects input that is not a session CSV', () => {
    expect(() => csvToSessionRows('a,b,c\n1,2,3\n')).toThrow(/missing column/);
    expect(() => csvToSessionRows('x\n')).toThrow(/no data rows/);
  });
});

function parseHeader(line: string): string[] {
  // Header cells contain no commas/quotes — split is safe here.
  return line.split(',');
}

describe('exchange typed tags', () => {
  it('extracts general + typed frontmatter tags (lists, inline, scalar)', () => {
    const md = [
      '---',
      'title: Test',
      'tags: [gymnastics, benchmark]',
      'equipment:',
      '  - pull-up bar',
      '  - jump rope',
      'quality: strength',
      '---',
      '# Body',
    ].join('\n');
    expect(extractTypedTags(md)).toEqual([
      { label: 'gymnastics' },
      { label: 'benchmark' },
      { label: 'pull-up bar', type: 'equipment' },
      { label: 'jump rope', type: 'equipment' },
      { label: 'strength', type: 'quality' },
    ]);
    expect(extractTypedTags('# no frontmatter\n')).toEqual([]);
  });
});

describe('exchange effort files', () => {
  const effortMd = [
    '---',
    'id: 33333333-3333-4333-8333-333333333333',
    'slug: thruster',
    'label: Thruster',
    'aliases:',
    '  - squat clean and press',
    'baseAttributes:',
    '  met: 9.8',
    '  discipline: weightlifting',
    '  intensityTier: high',
    '---',
    '',
    'A squat clean into an overhead press.',
  ].join('\n');

  it('round-trips an effort registry row through corpus-style markdown', () => {
    const parsed = markdownToEffort(effortMd);
    expect(parsed).not.toBeNull();
    expect(parsed!.slug).toBe('thruster');
    expect(parsed!.aliases).toEqual(['squat clean and press']);
    expect(parsed!.baseAttributes).toEqual({ met: 9.8, discipline: 'weightlifting', intensityTier: 'high' });
    expect(parsed!.body).toContain('squat clean into an overhead press');

    const recomposed = markdownToEffort(effortToMarkdown(parsed!));
    expect(recomposed).toEqual(parsed);
  });

  it('rejects effort files without the required frontmatter', () => {
    expect(markdownToEffort('# no frontmatter\n')).toBeNull();
    expect(markdownToEffort('---\nslug: x\nlabel: X\n---\n')).toBeNull(); // no id
    expect(markdownToEffort('---\nid: i\nslug: x\nlabel: X\n---\nbody\n')).toBeNull(); // no met
  });
});

describe('exchange equipment CSV', () => {
  it('round-trips labels and tolerates headerless input', () => {
    const csv = equipmentToCsv(['barbell', 'kettlebell', 'pull-up, rack']);
    expect(csvToEquipmentLabels(csv)).toEqual(['barbell', 'kettlebell', 'pull-up, rack']);
    expect(csvToEquipmentLabels('barbell\nkettlebell\n')).toEqual(['barbell', 'kettlebell']);
  });
});
