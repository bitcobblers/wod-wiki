import { describe, expect, it } from 'bun:test';

import type { INotePersistence } from '@/services/persistence';
import type { HistoryRecord } from '@/types/history';
import type {
  CreateNoteInput,
  GetNoteOptions,
  NoteLocator,
  NoteMutation,
  NoteQuery,
} from '@/services/persistence';
import { parseFrontmatter } from '@/lib/frontmatter';

import { createJournalNotes } from './journalNotes';
import { createDashboardNotes } from './dashboardNotes';

class MemoryNotePersistence implements Pick<INotePersistence, 'createNote' | 'getNote' | 'listNotes' | 'mutateNote' | 'deleteNote'> {
  readonly notes = new Map<string, HistoryRecord>();

  async createNote(input: CreateNoteInput): Promise<HistoryRecord> {
    const entry: HistoryRecord = {
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

  async getNote(locator: NoteLocator, _options?: GetNoteOptions): Promise<HistoryRecord> {
    const id = typeof locator === 'string' ? locator : locator.id;
    const entry = id ? this.notes.get(id) : undefined;
    if (!entry) throw new Error('not found');
    return entry;
  }

  async listNotes(query: NoteQuery = {}): Promise<HistoryRecord[]> {
    return Array.from(this.notes.values()).filter(
      (note) =>
        (!query.journalDate || note.journalDate === query.journalDate) &&
        (!query.kind || note.type === query.kind),
    );
  }

  async mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryRecord> {
    const current = await this.getNote(locator);
    const next = {
      ...current,
      rawContent: mutation.rawContent ?? current.rawContent,
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

function setup() {
  const persistence = new MemoryNotePersistence();
  let sequence = 0;
  const journal = createJournalNotes({
    persistence,
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  const dashboards = createDashboardNotes({ persistence, journal });
  return { persistence, journal, dashboards };
}

describe('createDashboardNotes.createDashboard', () => {
  it('creates a dashboard note in the locked format, marked active', async () => {
    const { persistence, dashboards } = await setup();

    const note = await dashboards.createDashboard('Road to Regionals');

    const stored = await persistence.getNote(note.id);
    const { meta } = parseFrontmatter(stored.rawContent);
    expect(meta['dashboard']).toBe('true');
    expect(meta['dashboard.active']).toBe('true');
    expect(meta['title']).toBe('Road to Regionals');
    expect(stored.rawContent).toContain('```query:');
  });

  it('defaults the title', async () => {
    const { dashboards } = await setup();
    const note = await dashboards.createDashboard();
    expect(note.title).toBe('New Dashboard');
  });

  it('is not filed under a journal date', async () => {
    const { dashboards } = await setup();
    const note = await dashboards.createDashboard();
    expect(note.journalDate).toBeUndefined();
    expect(note.type).toBe('dashboard');
    expect(note.sourceId).toBe('dashboards');
  });

  it('deactivates the previously active dashboard', async () => {
    const { persistence, dashboards } = await setup();
    const first = await dashboards.createDashboard('First');

    const second = await dashboards.createDashboard('Second');

    const firstMeta = parseFrontmatter((await persistence.getNote(first.id)).rawContent).meta;
    const secondMeta = parseFrontmatter((await persistence.getNote(second.id)).rawContent).meta;
    expect(firstMeta['dashboard']).toBe('true');
    expect(firstMeta['dashboard.active']).toBeUndefined();
    expect(secondMeta['dashboard.active']).toBe('true');
  });

  it('leaves non-dashboard and already-inactive notes untouched', async () => {
    const { persistence, journal, dashboards } = await setup();
    const plain = await journal.create({ title: 'Fran', rawContent: '# Fran' });
    const inactive = await dashboards.createDashboard('Old');
    await dashboards.createDashboard('New'); // deactivates Old

    const before = (await persistence.getNote(plain.id)).rawContent;
    await dashboards.createDashboard('Newer');

    expect((await persistence.getNote(plain.id)).rawContent).toBe(before);
    expect(parseFrontmatter((await persistence.getNote(inactive.id)).rawContent).meta['dashboard.active']).toBeUndefined();
  });
});
