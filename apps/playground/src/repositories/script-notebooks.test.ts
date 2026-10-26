/**
 * script-notebooks — dated/undated item resolution over a corpus snapshot.
 * The /notebook/:slug/:date/:item route resolves through findNotebookItem;
 * a dated page missed its item entirely when the lookup read the retired
 * `feedDate` field instead of `date` (ticket 12 review).
 */
import { describe, expect, it } from 'bun:test';
import { buildScriptNotebooks, findNotebookItem } from './script-notebooks';

const FILES = {
  'markdown/notebooks/crossfit-girls/README.md': '# CrossFit Girls\n\nClassic benchmarks.',
  'markdown/notebooks/crossfit-girls/fran.md': '# Fran\n\n```time\n21-15-9 Thrusters\n```',
  'markdown/notebooks/dan-john-program/2026-01-12/simple-strength.md':
    '# Simple Strength\n\n```time\n10 Push-ups\n```',
  'markdown/notebooks/dan-john-program/2026-01-15/simple-strength.md':
    '# Simple Strength, day 2\n\n```time\n12 Push-ups\n```',
};

describe('findNotebookItem — the dated item route resolution', () => {
  const notebooks = buildScriptNotebooks(FILES);
  const dated = notebooks.find((n) => n.id === 'dan-john-program')!;

  it('resolves a dated item by date + id, newest first', () => {
    const item = findNotebookItem(dated, '2026-01-15', 'simple-strength');
    expect(item?.date).toBe('2026-01-15');
    expect(item?.content).toContain('day 2');
    const older = findNotebookItem(dated, '2026-01-12', 'simple-strength');
    expect(older?.date).toBe('2026-01-12');
  });

  it('misses a dated item on the wrong date, and resolves undated items with an empty date', () => {
    expect(findNotebookItem(dated, '2026-01-13', 'simple-strength')).toBeUndefined();
    const undated = notebooks.find((n) => n.id === 'crossfit-girls')!;
    expect(findNotebookItem(undated, '', 'fran')?.name).toBe('Fran');
    expect(findNotebookItem(undated, '2026-01-12', 'fran')).toBeUndefined();
  });

  it('carries the dated content the workout start path saves from', () => {
    const item = findNotebookItem(dated, '2026-01-12', 'simple-strength')!;
    expect(item.content).toContain('10 Push-ups');
    expect(item.path).toBe('markdown/notebooks/dan-john-program/2026-01-12/simple-strength.md');
  });
});
