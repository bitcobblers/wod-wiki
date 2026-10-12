/**
 * createPlaygroundPage — the deep intake module for playground entries.
 *
 * One seam owns every path that turns content into a persisted playground
 * Note: the New/Reset page buttons, ZIP imports (/load?zip=), home shares
 * (/load?z=), and runnable home / syntax examples (which persist before the
 * runtime starts). All entries share one shape:
 *
 *  - Note id: a UUID (the V8 note shape) — results, attachments, and events
 *    join on it, and it survives a later promotion to the journal.
 *  - `slug`: `playground/<name>` — the route id `/playground/:id` resolves
 *    (getEntry falls back to by-slug lookup), so old composite-id links keep
 *    working and new entries are UUID-keyed.
 *  - `sourceId: 'playground'` — the `:note{source:playground}` library
 *    scope (sourceMatches: exact `playground` id).
 *  - `type: 'playground'`, no journalDate until the user promotes the entry
 *    to a journal date (`movePlaygroundToJournal`).
 *
 * Surfaces that run the same active playground repeatedly (home hero/runway,
 * syntax canvas routes) used to pass a `reuseKey`: one Note per surface,
 * updated in place on later runs. Since the shared run lifecycle
 * (usePlaygroundRun) that policy applies only to non-run content shares
 * (`/load?z=`, ZIP) — every explicit Run/Reset now mints a FRESH immutable
 * snapshot note via `snapshotEntry` (named `<page> <section> <timestamp>`),
 * so each run's results join their own note forever.
 */
import { v7 as uuidv7 } from 'uuid';

import type { INotePersistence } from '@/services/persistence';
import { notePersistence } from '@/services/persistence';
import type { HistoryEntry } from '@/types/history';
import { formatPlaygroundTimestampId } from '@/lib/playgroundDisplay';

import { playgroundContent, pageId, type PlaygroundPage } from './playgroundContent';

/** A persisted playground entry: the canonical Note UUID + its route id. */
export interface PlaygroundEntry {
  /** Canonical Note UUID — the Session.noteId join key. */
  noteId: string;
  /** `playground/<name>` route id — open at /playground/<name>. */
  routeId: string;
}

export interface EnsurePlaygroundEntryOptions {
  /**
   * Stable per-surface key ('home', 'guide-syntax-basics', 'chapter-basics').
   * The entry slug becomes `playground/<reuseKey>`: first call creates it,
   * later calls update the same Note (UUID preserved). Omit for a fresh
   * entry every call (ZIP import semantics).
   */
  reuseKey?: string;
  /** Display title for a newly created reused entry (kept stable on update). */
  title?: string;
}

/** Naming inputs for a fresh immutable run/reset snapshot note. */
export interface SnapshotEntryOptions {
  /** Page title, e.g. 'Home' or 'Syntax Basics' — always part of the name. */
  pageTitle: string;
  /** Optional section title, e.g. 'Hero' or 'Chapter timers'. */
  sectionTitle?: string;
}

/** Route-id pages view the intake needs (playgroundContent satisfies this). */
export interface PlaygroundPageStore {
  getPage(id: string): Promise<PlaygroundPage | undefined>;
  savePage(page: PlaygroundPage): Promise<string>;
}

export interface PlaygroundIntakeDependencies {
  persistence: Pick<INotePersistence, 'createNote' | 'mutateNote'>;
  pages: PlaygroundPageStore;
  now?: () => number;
}

const PLAYGROUND_SOURCE_ID = 'playground';

/** Slug-safe reuse key: 'guide/syntax/basics' → 'guide-syntax-basics'. */
function slugifyReuseKey(reuseKey: string): string {
  return (
    reuseKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry'
  );
}

/** Creation options for a fresh playground page. */
export interface CreatePlaygroundPageOptions {
  /**
   * Provenance: the app path the page was spawned from (e.g. `/c/girls/fran`
   * via "Open in Playground"). Stored as the note's sourceId so the
   * provenance chip and journal-copy backlinks resolve; classification is
   * unaffected (`type: 'playground'` keeps the note in the
   * `source:playground` domain). Omitted ≡ the bare intake marker.
   */
  sourcePath?: string;
}

export interface PlaygroundIntake {
  /**
   * Create a fresh playground page and return its route name (the `<name>`
   * segment of `/playground/<name>`). Signature unchanged since the original
   * page-store version — callers navigate with the returned name.
   */
  createPage(content: string, opts?: CreatePlaygroundPageOptions): Promise<string>;
  /** Create or update a playground entry; see EnsurePlaygroundEntryOptions. */
  ensureEntry(content: string, opts?: EnsurePlaygroundEntryOptions): Promise<PlaygroundEntry>;
  /**
   * Mint a FRESH immutable snapshot note named `<page> <section> <timestamp>`
   * (slug `playground/<page>-<section>-<timestamp>`). One snapshot per
   * run/reset — snapshots are never updated in place afterwards, so each
   * run's results join their own note forever.
   */
  snapshotEntry(content: string, opts: SnapshotEntryOptions): Promise<PlaygroundEntry>;
  /**
   * Promote a playground entry onto a journal date — the SAME Note (UUID,
   * blocks, results, attachments all preserved; nothing is copied, so no
   * duplicate playground entry remains). The source bucket is cleared so the
   * note leaves the `source:playground` scope and joins the journal page.
   */
  moveToJournal(noteId: string, journalDate: string): Promise<HistoryEntry>;
}

export function createPlaygroundIntake({
  persistence,
  pages,
  now = Date.now,
}: PlaygroundIntakeDependencies): PlaygroundIntake {
  async function writeEntry(routeId: string, title: string, content: string, sourcePath?: string): Promise<string> {
    const entry = await persistence.createNote({
      id: uuidv7(),
      title,
      rawContent: content,
      targetDate: now(),
      type: 'playground',
      slug: routeId,
      sourceId: sourcePath ?? PLAYGROUND_SOURCE_ID,
    });
    return entry.id;
  }

  async function updateEntry(entry: PlaygroundPage, routeId: string, title: string, content: string): Promise<void> {
    await pages.savePage({
      id: entry.id,
      slug: routeId,
      category: 'playground',
      name: title,
      content,
      sourceRevision: entry.sourceRevision,
      updatedAt: now(),
    });
  }

  return {
    async createPage(content, opts) {
      const name = formatPlaygroundTimestampId(now());
      const routeId = pageId('playground', name);
      // Same-millisecond recreations upsert the just-created page instead of
      // piling up two Notes behind one slug (the old composite-id behavior).
      const existing = await pages.getPage(routeId);
      if (existing) {
        await updateEntry(existing, existing.slug ?? routeId, existing.name || name, content);
        return name;
      }
      await writeEntry(routeId, name, content, opts?.sourcePath);
      return name;
    },

    async ensureEntry(content, opts = {}) {
      if (!opts.reuseKey) {
        const name = formatPlaygroundTimestampId(now());
        const routeId = pageId('playground', name);
        const noteId = await writeEntry(routeId, name, content);
        return { noteId, routeId };
      }
      const name = slugifyReuseKey(opts.reuseKey);
      const routeId = pageId('playground', name);
      const existing = await pages.getPage(routeId);
      // Only a genuine playground Note may be updated in place. A moved
      // (promoted) entry no longer answers this slug — the slug is cleared on
      // move — but a legacy composite-id row's id IS the route id, so a moved
      // legacy note would still resolve here. Its type says 'journal' now:
      // never touch it, mint a fresh entry under a suffixed slug instead.
      if (existing && existing.type === 'playground') {
        await updateEntry(existing, existing.slug ?? routeId, existing.name || name, content);
        return { noteId: existing.id, routeId };
      }
      if (existing) {
        console.warn(
          `[playground-intake] reuse key '${name}' resolves to a non-playground note (${existing.id}); ` +
          'minting a fresh entry instead of overwriting it.',
        );
        const freshName = `${name}-${formatPlaygroundTimestampId(now())}`;
        const freshRouteId = pageId('playground', freshName);
        const noteId = await writeEntry(freshRouteId, opts.title ?? freshName, content);
        return { noteId, routeId: freshRouteId };
      }
      const noteId = await writeEntry(routeId, opts.title ?? name, content);
      return { noteId, routeId };
    },

    async snapshotEntry(content, opts) {
      const stamp = formatPlaygroundTimestampId(now());
      const base = [slugifyReuseKey(opts.pageTitle), opts.sectionTitle ? slugifyReuseKey(opts.sectionTitle) : null, stamp]
        .filter(Boolean)
        .join('-');
      // Same-millisecond snapshots of the same page+section must never share
      // a slug: snapshots are immutable, so a numeric suffix disambiguates
      // instead of upserting (createPage's same-ms behavior).
      let routeId = pageId('playground', base);
      for (let n = 2; await pages.getPage(routeId); n += 1) {
        routeId = pageId('playground', `${base}-${n}`);
      }
      const title = [opts.pageTitle, opts.sectionTitle, stamp].filter(Boolean).join(' ');
      const noteId = await writeEntry(routeId, title, content);
      return { noteId, routeId };
    },

    moveToJournal(noteId, journalDate) {
      return persistence.mutateNote({ id: noteId }, {
        metadata: {
          journalDate,
          type: 'journal',
          // null clears the source bucket AND the route slug: the promoted
          // note leaves the playground scope (`:note{source:playground}`)
          // and stops answering /playground/<name>, so a later same-key
          // ensure can never update the journal note in the playground's
          // place. UUID, blocks, results, and attachments are untouched —
          // nothing is copied, so no duplicate playground entry remains.
          sourceId: null,
          slug: null,
        },
      });
    },
  };
}

/** Production intake over the notePersistence + playgroundContent singletons. */
export const playgroundIntake = createPlaygroundIntake({
  persistence: notePersistence,
  pages: playgroundContent,
});

/** Create a fresh playground page; returns the route name (see intake.createPage). */
export function createPlaygroundPage(content: string, opts?: CreatePlaygroundPageOptions): Promise<string> {
  return playgroundIntake.createPage(content, opts);
}

/** Create or update a playground entry (see intake.ensureEntry). */
export function ensurePlaygroundEntry(
  content: string,
  opts?: EnsurePlaygroundEntryOptions,
): Promise<PlaygroundEntry> {
  return playgroundIntake.ensureEntry(content, opts);
}

/** Promote a playground entry to a journal date, preserving its UUID. */
export function movePlaygroundToJournal(noteId: string, journalDate: string): Promise<HistoryEntry> {
  return playgroundIntake.moveToJournal(noteId, journalDate);
}
