/**
 * createPlaygroundPage (intake module) — contract tests over in-memory fakes.
 *
 * Covers the deep-module guarantees every intake path relies on:
 *  - fresh entries are UUID-keyed Notes with slug/type/sourceId set;
 *  - reuse updates the SAME Note (UUID stable) across runs;
 *  - a moved (promoted) entry is never updated in place of the journal note;
 *  - promotion clears source + slug while preserving identity.
 */
import { describe, expect, it } from 'bun:test';
import { v7 as uuidv7 } from 'uuid';

import type { HistoryEntry } from '@/types/history';
import type { CreateNoteInput, GetNoteOptions, NoteLocator, NoteMutation, NoteQuery } from '@/services/persistence/types';
import type { INotePersistence } from '@/services/persistence';

import { createPlaygroundIntake, type PlaygroundPageStore } from './createPlaygroundPage';
import type { PlaygroundPage } from './playgroundContent';

type MemoryNote = HistoryEntry;

class MemoryPersistence implements Pick<INotePersistence, 'createNote' | 'mutateNote'> {
  readonly notes = new Map<string, MemoryNote>();
  readonly mutations: Array<{ locator: NoteLocator; mutation: NoteMutation }> = [];

  async createNote(input: CreateNoteInput): Promise<HistoryEntry> {
    if (this.notes.has(input.id)) throw new Error(`Note already exists: ${input.id}`);
    const entry: MemoryNote = {
      id: input.id,
      title: input.title,
      createdAt: input.targetDate,
      updatedAt: input.targetDate,
      targetDate: input.targetDate,
      rawContent: input.rawContent,
      tags: input.tags ?? [],
      type: input.type ?? 'note',
      slug: input.slug,
      sourceId: input.sourceId,
      schemaVersion: 1,
    };
    this.notes.set(entry.id, entry);
    return entry;
  }

  /** Mirrors the provider's id-or-slug resolution. */
  async findByIdOrSlug(idOrSlug: string): Promise<MemoryNote | undefined> {
    const direct = this.notes.get(idOrSlug);
    if (direct) return direct;
    for (const note of this.notes.values()) {
      if (note.slug === idOrSlug) return note;
    }
    return undefined;
  }

  async getNote(locator: NoteLocator, _options?: GetNoteOptions): Promise<HistoryEntry> {
    const id = typeof locator === 'string' ? locator : locator.id;
    const entry = id ? await this.findByIdOrSlug(id) : undefined;
    if (!entry) throw new Error('not found');
    return entry;
  }

  async listNotes(_query: NoteQuery = {}): Promise<HistoryEntry[]> {
    return Array.from(this.notes.values());
  }

  async mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryEntry> {
    this.mutations.push({ locator, mutation });
    const id = typeof locator === 'string' ? locator : (locator.id ?? '');
    const entry = await this.findByIdOrSlug(id);
    if (!entry) throw new Error('not found');
    const meta = mutation.metadata ?? {};
    if (meta.title !== undefined) entry.title = meta.title;
    if (meta.journalDate !== undefined) entry.journalDate = meta.journalDate;
    if (meta.type !== undefined) entry.type = meta.type;
    if (meta.sourceId !== undefined) {
      if (meta.sourceId === null) delete entry.sourceId;
      else entry.sourceId = meta.sourceId;
    }
    if (meta.slug !== undefined) {
      if (meta.slug === null) delete entry.slug;
      else entry.slug = meta.slug;
    }
    return entry;
  }

  async deleteNote(locator: NoteLocator): Promise<void> {
    const id = typeof locator === 'string' ? locator : locator.id;
    if (id) this.notes.delete(id);
  }
}

/**
 * Same-store view over MemoryPersistence, the way playgroundContent reads the
 * shared wodwiki-db the intake writes through notePersistence.
 */
class MemoryPages implements PlaygroundPageStore {
  constructor(private readonly persistence: MemoryPersistence) {}

  async getPage(id: string): Promise<PlaygroundPage | undefined> {
    const note = await this.persistence.findByIdOrSlug(id);
    if (!note) return undefined;
    const routeId = note.slug ?? note.id;
    return {
      id: note.id,
      slug: note.slug ?? undefined,
      category: routeId.includes('/') ? routeId.slice(0, routeId.indexOf('/')) : routeId,
      name: note.title || routeId,
      content: note.rawContent ?? '',
      updatedAt: note.updatedAt ?? note.createdAt ?? 0,
      type: note.type,
      sourceId: note.sourceId ?? undefined,
    };
  }

  async savePage(page: PlaygroundPage): Promise<string> {
    const note = await this.persistence.findByIdOrSlug(page.id);
    if (!note) throw new Error(`Note not found: ${page.id}`);
    note.rawContent = page.content;
    note.title = page.name;
    if (page.slug !== undefined) note.slug = page.slug;
    note.updatedAt = page.updatedAt;
    return note.id;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setup(now = () => 1_700_000_000_000) {
  const persistence = new MemoryPersistence();
  const pages = new MemoryPages(persistence);
  const intake = createPlaygroundIntake({ persistence, pages, now });
  return { persistence, pages, intake };
}

describe('playground intake — createPage', () => {
  it('persists a UUID-keyed playground Note with slug, type, and sourceId', async () => {
    const { persistence, pages, intake } = setup();
    const name = await intake.createPage('# New playground\n');

    expect(name).toBe('2023-11-14-22-13-20-000');
    const page = await pages.getPage(`playground/${name}`);
    expect(page).toBeDefined();
    expect(page!.id).toMatch(UUID_REGEX);
    expect(page!.slug).toBe(`playground/${name}`);
    expect(page!.type).toBe('playground');
    expect(page!.sourceId).toBe('playground');
    expect(page!.content).toBe('# New playground\n');
    expect(persistence.notes.get(page!.id)!.slug).toBe(`playground/${name}`);
  });

  it('upserts on same-millisecond recreation instead of duplicating', async () => {
    const { persistence, pages, intake } = setup();
    const name = await intake.createPage('first');
    await intake.createPage('second');

    expect(persistence.notes.size).toBe(1);
    expect((await pages.getPage(`playground/${name}`))!.content).toBe('second');
    expect(name).toBe('2023-11-14-22-13-20-000');
  });
});

describe('playground intake — ensureEntry', () => {
  it('without reuseKey returns the created Note UUID (never a fabricated fallback)', async () => {
    const { intake } = setup();
    const entry = await intake.ensureEntry('zip body');

    expect(entry.noteId).toMatch(UUID_REGEX);
    expect(entry.routeId).toBe('playground/2023-11-14-22-13-20-000');
  });

  it('sanitizes reuse keys into slugs', async () => {
    const { pages, intake } = setup();
    const entry = await intake.ensureEntry('body', { reuseKey: '/guide/syntax/Basics!' });

    expect(entry.routeId).toBe('playground/guide-syntax-basics');
    expect((await pages.getPage(entry.routeId))!.id).toBe(entry.noteId);
  });

  it('reuses one Note across runs: second call updates content, keeps UUID, title, and routeId', async () => {
    const { persistence, pages, intake } = setup();
    const first = await intake.ensureEntry('run one', { reuseKey: 'home', title: 'Home playground' });
    const second = await intake.ensureEntry('run two — edited', { reuseKey: 'home', title: 'Home playground' });

    expect(second.noteId).toBe(first.noteId);
    expect(second.routeId).toBe('playground/home');
    expect(persistence.notes.size).toBe(1);
    expect((await pages.getPage('playground/home'))!.content).toBe('run two — edited');
    // Title stability: created once, never overwritten by later runs.
    expect((await pages.getPage('playground/home'))!.name).toBe('Home playground');
  });

  it('never updates a moved journal note in place of the departed playground entry', async () => {
    const { pages, persistence, intake } = setup();
    const first = await intake.ensureEntry('original', { reuseKey: 'home', title: 'Home playground' });
    await intake.moveToJournal(first.noteId, '2026-09-05');

    // The promoted note now holds journal content.
    expect(persistence.notes.get(first.noteId)!.type).toBe('journal');
    expect(persistence.notes.get(first.noteId)!.sourceId).toBeUndefined();
    expect(persistence.notes.get(first.noteId)!.slug).toBeUndefined();

    const next = await intake.ensureEntry('after move', { reuseKey: 'home', title: 'Home playground' });

    // The journal note is untouched…
    expect(persistence.notes.get(first.noteId)!.rawContent).toBe('original');
    // …and the freed slug hosts a brand-new entry — the moved Note's UUID is
    // never reused or updated.
    expect(next.noteId).not.toBe(first.noteId);
    expect(next.noteId).toMatch(UUID_REGEX);
    expect(next.routeId).toBe('playground/home');
    expect((await pages.getPage(next.routeId))!.content).toBe('after move');
    expect(persistence.notes.size).toBe(2);
  });
});

describe('playground intake — snapshotEntry', () => {
  it('mints a fresh playground Note named page-section-timestamp', async () => {
    const { persistence, pages, intake } = setup();
    const entry = await intake.snapshotEntry('# body', { pageTitle: 'Home', sectionTitle: 'Run' });

    expect(entry.noteId).toMatch(UUID_REGEX);
    expect(entry.routeId).toBe('playground/home-run-2023-11-14-22-13-20-000');
    const page = await pages.getPage(entry.routeId);
    expect(page!.id).toBe(entry.noteId);
    expect(page!.type).toBe('playground');
    expect(page!.sourceId).toBe('playground');
    expect(page!.content).toBe('# body');
    expect(persistence.notes.get(entry.noteId)!.title).toBe('Home Run 2023-11-14-22-13-20-000');
  });

  it('names with page-timestamp alone when no section is given', async () => {
    const { intake } = setup();
    const entry = await intake.snapshotEntry('body', { pageTitle: 'Syntax Basics' });

    expect(entry.routeId).toBe('playground/syntax-basics-2023-11-14-22-13-20-000');
  });

  it('slugifies messy titles in the route id', async () => {
    const { intake } = setup();
    const entry = await intake.snapshotEntry('body', {
      pageTitle: 'Syntax / Basics!',
      sectionTitle: 'Chapter 2 — Timers',
    });

    expect(entry.routeId).toBe('playground/syntax-basics-chapter-2-timers-2023-11-14-22-13-20-000');
  });

  it('keeps every snapshot a distinct immutable note (never updated in place)', async () => {
    const { persistence, intake } = setup();
    const first = await intake.snapshotEntry('run one', { pageTitle: 'Home', sectionTitle: 'Run' });
    const second = await intake.snapshotEntry('run two — edited', { pageTitle: 'Home', sectionTitle: 'Run' });

    expect(second.noteId).not.toBe(first.noteId);
    expect(persistence.notes.size).toBe(2);
    // First snapshot untouched — its run's results join it forever.
    expect(persistence.notes.get(first.noteId)!.rawContent).toBe('run one');
    expect(persistence.notes.get(first.noteId)!.slug).toBe(first.routeId);
  });

  it('disambiguates same-millisecond snapshots with a numeric suffix — slugs never collide', async () => {
    const { persistence, pages, intake } = setup();
    const first = await intake.snapshotEntry('run one', { pageTitle: 'Home', sectionTitle: 'Run' });
    const second = await intake.snapshotEntry('run two', { pageTitle: 'Home', sectionTitle: 'Run' });
    const third = await intake.snapshotEntry('run three', { pageTitle: 'Home', sectionTitle: 'Run' });

    expect(first.routeId).toBe('playground/home-run-2023-11-14-22-13-20-000');
    expect(second.routeId).toBe('playground/home-run-2023-11-14-22-13-20-000-2');
    expect(third.routeId).toBe('playground/home-run-2023-11-14-22-13-20-000-3');
    expect(persistence.notes.size).toBe(3);
    // Each slug resolves to its own note with its own content.
    expect((await pages.getPage(first.routeId))!.content).toBe('run one');
    expect((await pages.getPage(second.routeId))!.content).toBe('run two');
    expect((await pages.getPage(third.routeId))!.content).toBe('run three');
  });
});

describe('playground intake — moveToJournal', () => {
  it('sets journalDate + journal type and clears source and slug on the same Note', async () => {
    const { persistence, intake } = setup();
    const created = await intake.ensureEntry('keep me', { reuseKey: 'home', title: 'Home playground' });

    const moved = await intake.moveToJournal(created.noteId, '2026-09-05');

    // Same identity — nothing copied, no duplicate.
    expect(moved.id).toBe(created.noteId);
    expect(persistence.mutations).toHaveLength(1);
    expect(persistence.mutations[0]!.locator).toEqual({ id: created.noteId });
    expect(persistence.mutations[0]!.mutation.metadata).toEqual({
      journalDate: '2026-09-05',
      type: 'journal',
      sourceId: null,
      slug: null,
    });
    const note = persistence.notes.get(created.noteId)!;
    expect(note.journalDate).toBe('2026-09-05');
    expect(note.type).toBe('journal');
    expect(note.sourceId).toBeUndefined();
    expect(note.slug).toBeUndefined();
    // Content and title survive the move (blocks/results/attachments join
    // on the unchanged UUID).
    expect(note.rawContent).toBe('keep me');
    expect(note.title).toBe('Home playground');
  });
});

// uuidv7 stays imported for the module under test; reference it so the
// import is not flagged as unused in environments with import elision.
void uuidv7;
