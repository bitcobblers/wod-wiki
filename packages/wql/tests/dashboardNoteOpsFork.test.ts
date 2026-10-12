import { describe, expect, it } from 'vitest';

import { buildDashboardDocument } from '../src/dashboard/model';
import { parseDashboardNote } from '../src/dashboard/parser';
import {
  appendWidget,
  duplicateWidget,
  moveWidget,
  removeWidget,
  resizeWidget,
  updateWidget,
  migrateLegacyDashboardBodies,
  widgetBodyLine,
  widgetFenceTag,
  type WidgetSpec,
} from '../src/dashboard/noteOps';

const RAW = `---
dashboard: true
title: Training
---

## Weekly Volume
How much work per week?

\`\`\`query:timeseries
sum:totalVolume{} rollup:1w
\`\`\`

Some prose between widgets stays put.

## Top Efforts

\`\`\`query:toplist-2
sum:totalVolume{} by {effort}
\`\`\`
`;

function docOf(raw: string) {
  const { meta, sections } = parseDashboardNote(raw);
  return buildDashboardDocument(sections, meta);
}

const SPEC: WidgetSpec = {
  title: 'New Widget',
  question: 'A question?',
  type: 'bar',
  wql: 'avg:tis{}',
};

describe('widgetFenceTag / widgetBodyLine', () => {
  it('builds the locked fence vocabulary', () => {
    expect(widgetFenceTag({ type: '' })).toBe('```query');
    expect(widgetFenceTag({ type: 'timeseries' })).toBe('```query:timeseries');
    expect(widgetFenceTag({ type: 'bar', spanCols: 2 })).toBe('```query:bar-2');
    expect(widgetFenceTag({ type: 'bar', spanFull: true })).toBe('```query:bar-full');
  });

  it('keeps params trailing after the query', () => {
    expect(widgetBodyLine({ wql: 'sum:totalVolume{}' })).toBe('sum:totalVolume{}');
    expect(widgetBodyLine({ wql: 'sum:totalVolume{}' })).toBe('sum:totalVolume{}');
  });
});

describe('appendWidget', () => {
  it('appends a group at the end, preserving frontmatter and body', () => {
    const next = appendWidget(RAW, SPEC);
    const doc = docOf(next);
    expect(doc.widgets).toHaveLength(3);
    const added = doc.widgets[2];
    expect(added.title).toBe('New Widget');
    expect(added.question).toBe('A question?');
    expect(added.type).toBe('bar');
    expect(added.body).toBe('avg:tis{}');
    expect(next.startsWith('---\ndashboard: true')).toBe(true);
    expect(next).toContain('Some prose between widgets stays put.');
  });
});

describe('updateWidget', () => {
  it('replaces title, question, type, span and WQL in place', () => {
    const result = updateWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w', {
      ...SPEC,
      type: 'value',
      spanFull: true,
      wql: 'max:power{}',
    })!;
    const next = result.note;
    const doc = docOf(next);
    expect(doc.widgets).toHaveLength(2);
    expect(doc.widgets[0].title).toBe('New Widget');
    expect(doc.widgets[0].type).toBe('value');
    expect(doc.widgets[0].spanFull).toBe(true);
    expect(doc.widgets[0].body).toBe('max:power{}');
    // Second widget untouched, prose intact.
    expect(doc.widgets[1].title).toBe('Top Efforts');
    expect(result.note).toContain('Some prose between widgets stays put.');
  });

  it('returns null and writes nothing when the body guard fails', () => {
    expect(updateWidget(RAW, 'w0', 'sum:WRONG{}', SPEC)).toEqual({ ok: false, reason: 'stale-body' });
    expect(updateWidget(RAW, 'w9', 'sum:totalVolume{} rollup:1w', SPEC)).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('duplicateWidget', () => {
  it('copies the whole group directly below the original', () => {
    const result = duplicateWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w')!;
    const next = result.note;
    const doc = docOf(next);
    expect(doc.widgets).toHaveLength(3);
    expect(doc.widgets[0].title).toBe('Weekly Volume');
    expect(doc.widgets[1].title).toBe('Weekly Volume');
    expect(doc.widgets[1].body).toBe(doc.widgets[0].body);
    expect(doc.widgets[2].title).toBe('Top Efforts');
  });
});

describe('removeWidget', () => {
  it('removes the group including its heading and question', () => {
    const result = removeWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w')!;
    const next = result.note;
    const doc = docOf(next);
    expect(doc.widgets).toHaveLength(1);
    expect(doc.widgets[0].title).toBe('Top Efforts');
    expect(next).toContain('Some prose between widgets stays put.');
  });

  it('keeps a bare block removable (no heading/question)', () => {
    const raw = `---
dashboard: true
---

\`\`\`query
sum:reps{}
\`\`\`
`;
    const result = removeWidget(raw, 'w0', 'sum:reps{}')!;
    expect(docOf(result.note).widgets).toHaveLength(0);
  });
});

describe('moveWidget', () => {
  it('moves a group with its heading and question past its neighbor', () => {
    const result = moveWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w', 1)!;
    const next = result.note;
    const doc = docOf(next);
    expect(doc.widgets.map((w) => w.title)).toEqual(['Top Efforts', 'Weekly Volume']);
    expect(doc.widgets[1].question).toBe('How much work per week?');
    // Prose between the widgets was not part of either group — it stays.
    expect(next).toContain('Some prose between widgets stays put.');
  });

  it('moves a group back up', () => {
    const moved = moveWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w', 1)!.note;
    const back = moveWidget(moved, 'w1', 'sum:totalVolume{} rollup:1w', -1)!.note;
    expect(docOf(back).widgets.map((w) => w.title)).toEqual(['Weekly Volume', 'Top Efforts']);
  });

  it('is a no-op at the edges', () => {
    expect(moveWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w', -1)).toMatchObject({ ok: true, note: RAW, changes: [] });
    expect(moveWidget(RAW, 'w1', 'sum:totalVolume{} by {effort}', 1)).toMatchObject({ ok: true, note: RAW, changes: [] });
  });
});

describe('resizeWidget', () => {
  it('rewrites only the fence tag, preserving body and params', () => {
    const raw = `---
dashboard: true
---

\`\`\`query:value
sum:totalVolume{} / 300
\`\`\`
`;
    const result = resizeWidget(raw, 'w0', 'sum:totalVolume{} / 300', { spanCols: 2 })!;
    expect(result.note).toContain('```query:value-2');
    expect(result.note).toContain('sum:totalVolume{} / 300');
    expect(docOf(result.note).widgets[0]!.spanCols).toBe(2);
  });

  it('full span replaces a column span', () => {
    const result = resizeWidget(RAW, 'w1', 'sum:totalVolume{} by {effort}', { spanFull: true })!;
    expect(result.note).toContain('```query:toplist-full');
    expect(result.note).not.toContain('```query:toplist-2');
  });

  it('rejects out-of-range spans and stale bodies', () => {
    expect(resizeWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w', { spanCols: 5 })).toEqual({ ok: false, reason: 'stale-body' });
    expect(resizeWidget(RAW, 'w0', 'stale{}', { spanCols: 2 })).toEqual({ ok: false, reason: 'stale-body' });
  });
});

describe('identity guard across reorder', () => {
  it('a key+body pair still written after an unrelated reorder resolves to the same widget', () => {
    const moved = moveWidget(RAW, 'w0', 'sum:totalVolume{} rollup:1w', 1)!.note;
    // After the move the same physical widget is now w1 with the same body.
    const updated = updateWidget(moved, 'w1', 'sum:totalVolume{} rollup:1w', {
      ...SPEC,
      wql: 'sum:totalVolume{discipline:strength}',
    })!.note;
    const doc = docOf(updated);
    expect(doc.widgets[1]!.body).toBe('sum:totalVolume{discipline:strength}');
  });
});

describe('migrateLegacyDashboardBodies (decision 22)', () => {
  it('moves positional params into fence attributes, verbatim', () => {
    const legacy = '---\ndashboard: true\n---\n\n```query:goal-ring\nsum:tns{} / 2000\n```\n';
    const migrated = migrateLegacyDashboardBodies(legacy);
    expect(migrated).toContain('```query:goal-ring param1=2000');
    expect(migrated).toContain('sum:tns{}');
    expect(migrated).not.toContain(' / ');
    const doc = docOf(migrated);
    expect(doc.widgets[0]!.body).toBe('sum:tns{}');
    expect(doc.widgets[0]!.attributes).toEqual({ param1: '2000' });
  });

  it('leaves document bodies untouched', () => {
    const doc = '---\ndashboard: true\n---\n\n```query\nsum:distance{}\nshow in km\n```\n';
    expect(migrateLegacyDashboardBodies(doc)).toBe(doc);
  });
});

describe('authored widget occurrence lineage', () => {
  it('retains distinct identical queries when an explicit move leaves source unchanged', () => {
    const raw = '```query:value\nsum:tis{}\n```\n```query:value\nsum:tis{}\n```';
    const result = moveWidget(raw, 'w0', 'sum:tis{}', 1);
    if (!result.ok) throw new Error(result.reason);
    expect(result.note).toBe(raw);
    expect(result.changes).toEqual([]);
    expect(result.retainedBlocks.map(block => [block.from, block.nextFrom])).toEqual([[29, 0], [0, 29]]);
  });

  it('reports exact UTF-16 lineage without retaining a duplicate as an original', () => {
    const raw = '# 🏋️\r\n\r\n```query:value\r\nsum:tis{}\r\n```\r\n';
    const result = duplicateWidget(raw, 'w0', 'sum:tis{}');
    if (!result.ok) throw new Error(result.reason);
    let reconstructed = raw;
    for (const change of [...result.changes].reverse()) reconstructed = reconstructed.slice(0, change.from) + change.insert + reconstructed.slice(change.to);
    expect(reconstructed).toBe(result.note);
    expect(result.retainedBlocks).toHaveLength(1);
    const original = result.retainedBlocks[0]!;
    expect(raw.slice(original.from, original.to)).toBe('```query:value\r\nsum:tis{}\r\n```');
    expect(result.note.slice(original.nextFrom, original.nextTo)).toBe('```query:value\r\nsum:tis{}\r\n```');
  });
});
