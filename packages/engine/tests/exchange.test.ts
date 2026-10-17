/**
 * Pure exchange-format coverage of exact source export,
 * identity stamping, and session CSV round-trips.
 */
import { describe, it, expect } from 'vitest';
import {
  composeNoteMarkdown,
  csvToSessionRows,
  csvToEquipmentLabels,
  equipmentToCsv,
  equipmentToMarkdown,
  extractNoteIdentity,
  extractTypedTags,
  injectIdentityFrontmatter,
  sessionToCsv,
  SESSION_CSV_HEADER,
} from '../src/exchange';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { Note, Session } from '@bitcobblers/wod-wiki-storage';

const note: Note = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Fran', createdAt: 1,
  rawContent: '# Fran\r\n\r\n  prose 😀  \r\n\r\n````time:crossfit\r\n3 Rounds\r\n- 9 pull-up\r\n````\r\n\r\n```unknown\r\nleave me alone\r\n```\r\n',
  sourceRevision: 1, blocks: {},
};

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

  it('exports authored bytes without reconstructing sections or fences', () => {
    const exported = composeNoteMarkdown(note);
    expect(exported.endsWith(note.rawContent)).toBe(true);
    expect(extractNoteIdentity(exported)?.noteId).toBe(note.id);
  });

  it('preserves CRLF frontmatter and the exact body while stamping identity', () => {
    const rawContent = '---\r\ntitle: Fran\r\nsport: crossfit\r\n---\r\n\r\n  body 😀  \r\n';
    const exported = composeNoteMarkdown({ ...note, rawContent });
    expect(exported).toContain('sport: crossfit\r\n');
    expect(exported.endsWith('\r\n---\r\n\r\n  body 😀  \r\n')).toBe(true);
    expect(exported.replaceAll('\r\n', '')).not.toContain('\n');
  });
});

const session: Session = {
  id: '22222222-2222-4222-8222-222222222222',
  noteId: note.id,
  blockId: 'workout-occurrence-1',
  blockVersion: 3,
  origin: 'journal',
  status: 'completed',
  startTime: 1000,
  endTime: 2000,
  duration: 1000,
  completed: true,
  pageId: 'page-1',
  roundsCompleted: 3,
  totalRounds: 3,
  repsCompleted: 15,
  createdAt: 2000,
};

const events: EventRecord[] = [
  {
    id: `${session.id}:0`,
    resultId: session.id,
    noteId: note.id,
    blockId: session.blockId,
    blockVersion: session.blockVersion,
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
    blockId: session.blockId,
    blockVersion: session.blockVersion,
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

  it('preserves empty temporal arrays for events with and without metrics', () => {
    const source: EventRecord[] = [
      { ...events[0], metrics: [], metricTemporal: [] },
      { ...events[1], metricTemporal: [] },
    ];
    expect(csvToSessionRows(sessionToCsv(session, source)).events).toEqual(source);
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

  it('rejects obsolete, absent, inconsistent and fractional block pins', () => {
    const csv = sessionToCsv(session, events);
    expect(() => csvToSessionRows(csv.replace('blockVersion', 'segmentVersion'))).toThrow(/Incompatible/);
    expect(() => csvToSessionRows(csv.replaceAll('workout-occurrence-1', ''))).toThrow(/requires/);
    expect(() => csvToSessionRows(sessionToCsv({ ...session, blockVersion: 1.5 }, events))).toThrow(/positive blockVersion/);
    expect(() => csvToSessionRows(sessionToCsv(session, [{ ...events[0], blockId: 'different' }]))).toThrow(/differs/);
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

  it('serializes equipment registry rows back into corpus-style markdown', () => {
    const markdown = equipmentToMarkdown({
      id: '44444444-4444-4444-8444-444444444444',
      slug: 'dumbbell',
      label: 'Dumbbell',
      aliases: ['dumbbells'],
      body: 'Fixed-weight free weight.',
    });
    expect(markdown).toContain('type: equipment');
    expect(markdown).toContain('slug: dumbbell');
    expect(markdown).toContain('  - dumbbells');
    expect(markdown.endsWith('Fixed-weight free weight.\n')).toBe(true);
  });
});

describe('exchange equipment CSV', () => {
  it('round-trips labels and tolerates headerless input', () => {
    const csv = equipmentToCsv(['barbell', 'kettlebell', 'pull-up, rack']);
    expect(csvToEquipmentLabels(csv)).toEqual(['barbell', 'kettlebell', 'pull-up, rack']);
    expect(csvToEquipmentLabels('barbell\nkettlebell\n')).toEqual(['barbell', 'kettlebell']);
  });
});
