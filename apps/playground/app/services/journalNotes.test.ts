import { describe, expect, it } from 'bun:test';
import type { HistoryEntry } from '@/types/history';
import type { CreateNoteInput, GetNoteOptions, NoteLocator, NoteMutation, NoteQuery } from '@/services/persistence/types';
import type { INotePersistence } from '@/services/persistence';
import { createJournalNotes } from './journalNotes';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { duplicateWidget, moveWidget, updateWidget } from '@bitcobblers/wod-wiki-wql';

class MemoryNotePersistence implements Pick<INotePersistence, 'createNote' | 'getNote' | 'listNotes' | 'mutateNote' | 'deleteNote'> {
  readonly notes = new Map<string, HistoryEntry>();

  async createNote(input: CreateNoteInput): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      id: input.id,
      title: input.title,
      rawContent: input.rawContent,
      blocks: {},
      sourceRevision: 1,
      tags: input.tags ?? [],
      createdAt: 1_720_828_800_000,
      updatedAt: 1_720_828_800_000,
      targetDate: input.targetDate,
      journalDate: input.journalDate,
      type: input.type,
      slug: input.slug,
      sourceId: input.sourceId,
      schemaVersion: 1,
    };
    this.notes.set(entry.id, entry);
    return entry;
  }

  async getNote(locator: NoteLocator, _options?: GetNoteOptions): Promise<HistoryEntry> {
    const id = typeof locator === 'string' ? locator : locator.id;
    const entry = id ? this.notes.get(id) : undefined;
    if (!entry) throw new Error('not found');
    return entry;
  }

  async listNotes(query: NoteQuery = {}): Promise<HistoryEntry[]> {
    return Array.from(this.notes.values()).filter(note =>
      (!query.journalDate || note.journalDate === query.journalDate) &&
      (!query.kind || note.type === query.kind),
    );
  }

  async mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryEntry> {
    const current = await this.getNote(locator);
    if (mutation.expectedSourceRevision !== undefined && mutation.expectedSourceRevision !== current.sourceRevision) throw new Error('stale source');
    const next = {
      ...current,
      rawContent: mutation.rawContent ?? current.rawContent,
      sourceRevision: (current.sourceRevision ?? 1) + (mutation.rawContent !== undefined && mutation.rawContent !== current.rawContent ? 1 : 0),
      blocks: mutation.blocks ?? current.blocks,
      title: mutation.metadata?.title ?? current.title,
      journalDate: mutation.metadata?.journalDate ?? current.journalDate,
    };
    this.notes.set(next.id, next);
    return next;
  }

  async deleteNote(locator: NoteLocator): Promise<void> {
    const current = await this.getNote(locator);
    this.notes.delete(current.id);
  }
}

describe('Journal Notes', () => {
  it('creates every journal document with a fresh UUID and logical journal date', async () => {
    const persistence = new MemoryNotePersistence();
    let sequence = 0;
    const journalNotes = createJournalNotes({
      persistence,
      uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    });

    const first = await journalNotes.create({
      journalDate: '2026-07-13',
      title: 'Fran',
      rawContent: '# Fran',
    });
    const second = await journalNotes.create({
      journalDate: '2026-07-13',
      title: 'Fran',
      rawContent: '# Fran',
    });

    expect(first.id).not.toBe(second.id);
    expect(first.journalDate).toBe('2026-07-13');
    expect(first.type).toBe('journal');
    expect(persistence.notes).toHaveLength(2);
  });

  it('lists every Note in a date group in stable creation order', async () => {
    const persistence = new MemoryNotePersistence();
    let sequence = 0;
    const journalNotes = createJournalNotes({
      persistence,
      uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    });
    const later = await journalNotes.create({ journalDate: '2026-07-13', title: 'Later', rawContent: '# Later' });
    const earlier = await journalNotes.create({ journalDate: '2026-07-13', title: 'Earlier', rawContent: '# Earlier' });
    persistence.notes.set(later.id, { ...later, createdAt: 2 });
    persistence.notes.set(earlier.id, { ...earlier, createdAt: 1 });
    await journalNotes.create({ journalDate: '2026-07-14', title: 'Tomorrow', rawContent: '# Tomorrow' });

    const notes = await journalNotes.listByDate('2026-07-13');

    expect(notes.map(note => note.title)).toEqual(['Earlier', 'Later']);
  });

  it('strips leading Markdown heading markers from stored titles', async () => {
    const persistence = new MemoryNotePersistence();
    const journalNotes = createJournalNotes({ persistence });

    const note = await journalNotes.create({
      journalDate: '2026-07-13',
      title: '# Welcome workout',
      rawContent: '# Welcome workout\n\n```time\n5 push-ups\n```',
    });

    expect(note.title).toBe('Welcome workout');
    expect(persistence.notes.get(note.id)?.title).toBe('Welcome workout');
  });

  it('updates titles from the first Markdown heading', async () => {
    const persistence = new MemoryNotePersistence();
    const journalNotes = createJournalNotes({ persistence });

    const note = await journalNotes.create({
      journalDate: '2026-07-13',
      title: 'Fran',
      rawContent: '# Fran',
    });
    await journalNotes.update(note, '# Changed heading\n\nSome text');

    expect(persistence.notes.get(note.id)?.title).toBe('Changed heading');
  });

  it('rejects an older queued baseline and recovers after a failed write without losing the draft', async () => {
    const persistence = new MemoryNotePersistence();
    const journalNotes = createJournalNotes({ persistence });
    const note = await journalNotes.create({
      journalDate: '2026-07-13',
      title: 'Fran',
      rawContent: '# Fran',
    });

    let releaseFirst!: () => void;
    const firstSettles = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const original = persistence.mutateNote.bind(persistence);
    let mutationCalls = 0;
    persistence.mutateNote = async (locator, mutation) => {
      if (++mutationCalls === 1) await firstSettles;
      return original(locator, mutation);
    };

    const firstUpdate = journalNotes.update(note, '# Fran mid-typing document');
    const secondUpdate = journalNotes.update(note, '# Fran mid-typing document + typed tail');
    releaseFirst();
    await firstUpdate;
    await expect(secondUpdate).rejects.toThrow('stale source');
    const latest = await persistence.getNote(note.id);
    const second = await journalNotes.update(latest, '# Fran mid-typing document + typed tail');
    expect(second.rawContent).toContain('+ typed tail');
    expect(persistence.notes.get(note.id)?.rawContent).toContain('+ typed tail');

    // A failed write rejects its caller but must not wedge the next update.
    persistence.mutateNote = async () => { throw new Error('storage offline'); };
    await expect(journalNotes.update(second, '# doomed')).rejects.toThrow('storage offline');
    persistence.mutateNote = original;
    const recovered = await journalNotes.update(second, '# Fran recovered');
    expect(recovered.rawContent).toBe('# Fran recovered');
  });

  it('preserves equal-query occurrence identity across explicit moves and creates fresh copies', async () => {
    const storage = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(storage, new IndexedDBContentProvider(storage));
    const journal = createJournalNotes({ persistence, uuid: () => 'dashboard-note' });
    const rawContent = '---\ndashboard: true\n---\n\n## First\n\n```query:value\nsum:tis{}\n```\n\n## Second\n\n```query:value\nsum:tis{}\n```\n';
    const saved = await journal.create({ title: 'Board', rawContent, type: 'dashboard' });
    const originalIds = Object.keys(saved.blocks!);
    const history = await persistence.getNoteBlockHistory(saved.id);
    const move = moveWidget(rawContent, 'w0', 'sum:tis{}', 1);
    if (!move.ok) throw new Error(move.reason);
    const moved = await journal.update(saved, move.note, move);
    expect(Object.values(moved.blocks!).sort((a, b) => a.from - b.from).map(block => block.id)).toEqual([...originalIds].reverse());
    expect(await persistence.getNoteBlockHistory(saved.id)).toEqual(history);
    const duplicate = duplicateWidget(moved.rawContent, 'w0', 'sum:tis{}');
    if (!duplicate.ok) throw new Error(duplicate.reason);
    const copied = await journal.update(moved, duplicate.note, duplicate);
    const copiedIds = Object.values(copied.blocks!).sort((a, b) => a.from - b.from).map(block => block.id);
    expect(copiedIds[0]).toBe(originalIds[1]);
    expect(copiedIds[2]).toBe(originalIds[0]);
    expect(originalIds).not.toContain(copiedIds[1]);
    const update = updateWidget(copied.rawContent, 'w0', 'sum:tis{}', { title: 'Changed', type: 'value', wql: 'sum:tns{}' });
    if (!update.ok) throw new Error(update.reason);
    const updated = await journal.update(copied, update.note, update);
    expect(updated.blocks?.[originalIds[1]!]?.version).toBe(2);
    await expect(journal.update(saved, move.note, move)).rejects.toMatchObject({ code: 'STALE_SOURCE' });
    const prose = await journal.update(updated, updated.rawContent.replace('dashboard: true', 'dashboard: true\ntitle: Changed'));
    expect(Object.keys(prose.blocks!)).toEqual(Object.keys(updated.blocks!));
    expect(await persistence.getNoteBlockHistory(saved.id)).toHaveLength(4);
  });

  describe('moveToDate', () => {
    it('calls the atomic move operation with the primary date placement as source', async () => {
      const persistence = new MemoryNotePersistence();
      await persistence.createNote({ id: 'n1', title: 'A', rawContent: 'x', targetDate: 1, journalDate: '2026-10-15' });
      persistence.notes.get('n1')!.placements = [
        { pageId: 'cal-1', noteId: 'n1', date: '2026-10-15', createdAt: 1 },
        { pageId: 'named-1', noteId: 'n1', slug: 'gym', createdAt: 2 },
      ];
      const calls: unknown[] = [];
      const journal = createJournalNotes({
        persistence,
        moveEntryPlacement: (...args) => { calls.push(['move', ...args]); return Promise.resolve(persistence.notes.get('n1')!); },
        addEntryPlacement: (...args) => { calls.push(['add', ...args]); return Promise.resolve(persistence.notes.get('n1')!); },
      });

      await journal.moveToDate('n1', '2026-10-16');

      expect(calls).toEqual([['move', 'n1', 'cal-1', { date: '2026-10-16' }]]);
    });

    it('attaches when the note has no calendar placement yet', async () => {
      const persistence = new MemoryNotePersistence();
      await persistence.createNote({ id: 'n1', title: 'A', rawContent: 'x', targetDate: 1 });
      const calls: unknown[] = [];
      const journal = createJournalNotes({
        persistence,
        moveEntryPlacement: (...args) => { calls.push(['move', ...args]); return Promise.resolve(persistence.notes.get('n1')!); },
        addEntryPlacement: (...args) => { calls.push(['add', ...args]); return Promise.resolve(persistence.notes.get('n1')!); },
      });

      await journal.moveToDate('n1', '2026-10-16');

      expect(calls).toEqual([['add', 'n1', { date: '2026-10-16' }]]);
    });

    it('moves the date placement only — other placements survive, and an added second date never collapses the first', async () => {
      const storage = new StorageService(new InMemoryStorage());
      const persistence = new IndexedDBNotePersistence(storage, new IndexedDBContentProvider(storage));
      const provider = new IndexedDBContentProvider(storage);
      const journal = createJournalNotes({
        persistence,
        moveEntryPlacement: (noteId, fromPageId, target) => provider.moveEntryPlacement(noteId, fromPageId, target),
        addEntryPlacement: (noteId, target) => provider.addEntryPlacement(noteId, target),
      });
      const saved = await persistence.createNote({ id: 'move-note', title: 'A', rawContent: 'x', targetDate: 1 });

      await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
      await provider.addEntryPlacement(saved.id, { slug: 'gym' });

      // A move detaches exactly one source page — the old date — and keeps
      // every other placement.
      await journal.moveToDate(saved.id, '2026-10-16');
      let entry = await provider.getEntry(saved.id);
      expect(entry?.placements?.map((placement) => placement.date ?? placement.slug).sort())
        .toEqual(['2026-10-16', 'gym']);

      // Additive: a second date attaches without detaching the first…
      await provider.addEntryPlacement(saved.id, { date: '2026-10-18' });
      // …and the next move preserves both the named page and that second date.
      await journal.moveToDate(saved.id, '2026-10-17');
      entry = await provider.getEntry(saved.id);
      expect(entry?.placements?.map((placement) => placement.date ?? placement.slug).sort())
        .toEqual(['2026-10-17', '2026-10-18', 'gym']);
    });

    it('keeps the primary date deterministic when every placement ties on createdAt', async () => {
      // Regression: unpositioned rows tie on createdAt, and the random
      // junction id then decides the canonical order — a move could detach
      // the newer second date instead of the original primary. Explicit
      // append positions make the order structural, not temporal.
      const realNow = Date.now;
      Date.now = () => 1_720_828_800_000;
      try {
        const storage = new StorageService(new InMemoryStorage());
        const persistence = new IndexedDBNotePersistence(storage, new IndexedDBContentProvider(storage));
        const provider = new IndexedDBContentProvider(storage);
        const journal = createJournalNotes({
          persistence,
          moveEntryPlacement: (noteId, fromPageId, target) => provider.moveEntryPlacement(noteId, fromPageId, target),
          addEntryPlacement: (noteId, target) => provider.addEntryPlacement(noteId, target),
        });
        const saved = await persistence.createNote({ id: 'frozen-note', title: 'A', rawContent: 'x', targetDate: 1 });

        await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
        await provider.addEntryPlacement(saved.id, { slug: 'gym' });
        await journal.moveToDate(saved.id, '2026-10-16');
        await provider.addEntryPlacement(saved.id, { date: '2026-10-18' });
        await journal.moveToDate(saved.id, '2026-10-17');
        // …and once more, to pin repeated add/move cycles: the move detaches
        // the earliest surviving date (2026-10-18), never the just-added one.
        await provider.addEntryPlacement(saved.id, { date: '2026-10-19' });
        await journal.moveToDate(saved.id, '2026-10-20');

        const entry = await provider.getEntry(saved.id);
        expect(entry?.placements?.map((placement) => placement.date ?? placement.slug).sort())
          .toEqual(['2026-10-17', '2026-10-19', '2026-10-20', 'gym']);
      } finally {
        Date.now = realNow;
      }
    });
  });
});
