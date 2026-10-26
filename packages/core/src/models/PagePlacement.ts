/**
 * Page placement — the resolved form of one `page_notes` junction row.
 *
 * Placement is many-to-many: a note may sit on several pages (a calendar
 * day, a named collection, …) and a page may hold several notes. The
 * junction row is the only membership record; a note carries no page
 * reference of its own.
 *
 * One ordering decides everything placement-related — the **canonical
 * placement order**: explicit `position` first (smaller first, a row
 * without one last), then creation time, then the row id. It reads a
 * page's notes in order and picks the *primary* placement when only one
 * page may be shown.
 */

import type { Page, PageNote } from '../types/storage';

/** One placement of a note on a page. */
export interface NotePlacement {
  /** The page the note is placed on. */
  pageId: string;
  /** The note that is placed on the page. */
  noteId: string;
  /** Ordinal within the page, when the placement carries one. */
  position?: number;
  /** When the placement was created — the second ordering tie-breaker. */
  createdAt: number;
  /** Calendar date of the page, when the page is a date page. */
  date?: string;
  /** Route slug of the page, when the page is a named page. */
  slug?: string;
  /** Display title of the page, when it has one. */
  title?: string;
}

/**
 * A page addressed by its public identity — a calendar date (`date`) or a
 * named route (`slug`). A page row may carry both; either one resolves it.
 */
export interface PageTarget {
  /** YYYY-MM-DD — the calendar page for that day. */
  date?: string;
  /** Route slug — the named page for that route. */
  slug?: string;
}

/**
 * Canonical placement order: explicit position first (smaller first, a
 * row without a position last), then creation time, then the row id.
 *
 * A placement written without an explicit position therefore lands after
 * every positioned row — appending is the default.
 */
export function comparePlacements(a: PageNote, b: PageNote): number {
  const positionA = a.position ?? Infinity;
  const positionB = b.position ?? Infinity;
  if (positionA !== positionB) return positionA - positionB;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The canonical placement order of a note's junction rows. */
export function orderPlacements(links: readonly PageNote[]): PageNote[] {
  return [...links].sort(comparePlacements);
}

/**
 * Resolve junction rows into placements, in canonical order. Rows whose
 * page is missing are dropped — a placement without a page addresses
 * nothing.
 */
export function resolvePlacements(links: readonly PageNote[], pages: readonly Page[]): NotePlacement[] {
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const out: NotePlacement[] = [];
  for (const link of orderPlacements(links)) {
    const page = pageById.get(link.pageId);
    if (!page) continue;
    out.push({
      pageId: page.id,
      noteId: link.noteId,
      position: link.position,
      createdAt: link.createdAt,
      date: page.date,
      slug: page.slug,
      title: page.title,
    });
  }
  return out;
}

/** The primary placement of a note — the first in canonical order. */
export function primaryPlacement(placements: readonly NotePlacement[]): NotePlacement | undefined {
  return placements[0];
}

/** The page identity of a placement — what a caller addresses it by. */
export function placementTarget(placement: NotePlacement): PageTarget {
  return placement.date ? { date: placement.date } : { slug: placement.slug };
}

/**
 * The single-page projections of a note's placements.
 *
 * A note may sit on several pages, so `pageId`, `journalDate` and
 * `pageSlug` are projections — never the membership itself. The rule is
 * deterministic:
 *
 * - `pageId` — the page of the **primary placement**: the first placement
 *   in the canonical placement order.
 * - `journalDate` — the date of the first calendar placement in that order.
 * - `pageSlug` — the slug of the first named placement (a page with a slug
 *   and no date) in that order.
 *
 * A note placed on several pages keeps every placement; only these three
 * fields are narrowed, and they always name the same placements for the
 * same inputs.
 */
export interface PlacementProjection {
  /** The page id of the primary placement. */
  pageId?: string;
  /** The calendar date of the first calendar placement. */
  journalDate?: string;
  /** The route slug of the first named placement. */
  pageSlug?: string;
}

/** Project a note's placements onto the single-page fields. */
export function projectPlacements(placements: readonly NotePlacement[]): PlacementProjection {
  const projection: PlacementProjection = {};
  for (const placement of placements) {
    if (projection.pageId === undefined) projection.pageId = placement.pageId;
    if (projection.journalDate === undefined && placement.date) projection.journalDate = placement.date;
    if (projection.pageSlug === undefined && placement.slug && !placement.date) projection.pageSlug = placement.slug;
  }
  return projection;
}

/**
 * The placements of a note that carry a given calendar date — the note
 * appears in that date's listing when this list is non-empty.
 */
export function placementsOnDate(placements: readonly NotePlacement[], date: string): NotePlacement[] {
  return placements.filter((placement) => placement.date === date);
}

/**
 * The placements of a note that carry a given named-page slug — the note
 * appears in that page's listing when this list is non-empty.
 */
export function placementsOnSlug(placements: readonly NotePlacement[], slug: string): NotePlacement[] {
  return placements.filter((placement) => placement.slug === slug && !placement.date);
}
