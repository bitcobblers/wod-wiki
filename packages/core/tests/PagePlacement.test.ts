import { describe, expect, it } from 'vitest';
import {
  comparePlacements,
  orderPlacements,
  projectPlacements,
  resolvePlacements,
  type NotePlacement,
} from '../src/models/PagePlacement';
import type { Page, PageNote } from '../src/types/storage';

const T0 = 1_700_000_000_000;

function link(overrides: Partial<PageNote> & { id: string }): PageNote {
  return { pageId: 'p1', noteId: 'n1', createdAt: T0, ...overrides };
}

function page(overrides: Partial<Page> & { id: string }): Page {
  return { createdAt: T0, ...overrides };
}

describe('canonical placement order', () => {
  it('orders by explicit position first', () => {
    const links = [
      link({ id: 'b', position: 2 }),
      link({ id: 'a', position: 1 }),
      link({ id: 'c', position: 3 }),
    ];
    expect(orderPlacements(links).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts a placement written without a position after the positioned ones', () => {
    const links = [
      link({ id: 'unpinned', createdAt: T0 + 1 }),
      link({ id: 'pinned', position: 0, createdAt: T0 + 2 }),
    ];
    expect(orderPlacements(links).map((row) => row.id)).toEqual(['pinned', 'unpinned']);
  });

  it('breaks ties on creation time then row id', () => {
    const links = [
      link({ id: 'z', position: 1, createdAt: T0 + 5 }),
      link({ id: 'b', position: 1, createdAt: T0 + 1 }),
      link({ id: 'a', position: 1, createdAt: T0 + 1 }),
    ];
    expect(orderPlacements(links).map((row) => row.id)).toEqual(['a', 'b', 'z']);
  });

  it('is a total order — no row compares as equal to a different row', () => {
    const a = link({ id: 'a', position: 1, createdAt: T0 });
    const b = link({ id: 'b', position: 1, createdAt: T0 });
    expect(comparePlacements(a, b)).toBeLessThan(0);
    expect(comparePlacements(b, a)).toBeGreaterThan(0);
    expect(comparePlacements(a, a)).toBe(0);
  });
});

describe('resolvePlacements', () => {
  it('resolves junction rows into placements carrying the page identity', () => {
    const placements = resolvePlacements(
      [link({ id: 'l1', pageId: 'named', noteId: 'n1', position: 1 }), link({ id: 'l2', pageId: 'cal', noteId: 'n1' })],
      [page({ id: 'cal', date: '2026-07-15', title: '2026-07-15' }), page({ id: 'named', slug: 'marathon-block', title: 'Marathon' })],
    );
    expect(placements).toEqual([
      { pageId: 'named', noteId: 'n1', position: 1, createdAt: T0, date: undefined, slug: 'marathon-block', title: 'Marathon' },
      { pageId: 'cal', noteId: 'n1', position: undefined, createdAt: T0, date: '2026-07-15', slug: undefined, title: '2026-07-15' },
    ]);
  });

  it('drops a placement whose page no longer exists', () => {
    const placements = resolvePlacements([link({ id: 'l1', pageId: 'gone' })], [page({ id: 'cal', date: '2026-07-15' })]);
    expect(placements).toEqual([]);
  });

  it('keeps every placement of a note — the junction is many-to-many', () => {
    const placements = resolvePlacements(
      [link({ id: 'l1', pageId: 'a' }), link({ id: 'l2', pageId: 'b' }), link({ id: 'l3', pageId: 'c' })],
      [page({ id: 'a' }), page({ id: 'b' }), page({ id: 'c' })],
    );
    expect(placements.map((placement) => placement.pageId)).toEqual(['a', 'b', 'c']);
  });
});

describe('the single-page projection', () => {
  const placement = (overrides: Partial<NotePlacement>): NotePlacement => ({
    pageId: 'p1', noteId: 'n1', createdAt: T0, ...overrides,
  });

  it('names the first placement in canonical order', () => {
    const projection = projectPlacements([
      placement({ pageId: 'first', date: '2026-07-15' }),
      placement({ pageId: 'second', slug: 'gym' }),
    ]);
    expect(projection.pageId).toBe('first');
    expect(projection.journalDate).toBe('2026-07-15');
    expect(projection.pageSlug).toBe('gym');
  });

  it('is empty when the note sits on no page', () => {
    expect(projectPlacements([])).toEqual({});
  });

  it('keeps every placement — the projection narrows, it never drops', () => {
    const placements = [
      placement({ pageId: 'cal', date: '2026-07-15' }),
      placement({ pageId: 'named', slug: 'gym' }),
      placement({ pageId: 'named-2', slug: 'travel' }),
    ];
    const projection = projectPlacements(placements);
    expect(placements).toHaveLength(3);
    expect(projection.pageSlug).toBe('gym');
  });
});
