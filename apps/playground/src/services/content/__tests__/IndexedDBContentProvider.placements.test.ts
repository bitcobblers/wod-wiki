/**
 * Provider placement behavior — the user-visible many-to-many placement
 * model:
 *
 * - a note can be placed on more than one page and appears in each of them,
 * - placing it on a second page never detaches it from the first,
 * - a move detaches from the source and attaches at the destination,
 * - the note keeps its canonical route (/notes/<id>) throughout — a
 *   placement change never clones or deletes it.
 */
import { describe, expect, it } from 'bun:test';

import { InMemoryStorage } from '../../storage/InMemoryStorage';
import { StorageService } from '../../storage/StorageService';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';
import { NotePersistenceError } from '../../persistence/types';

const SOURCE = '```time\n10 Pushups\n```';

async function makeProvider(): Promise<{ service: StorageService; provider: IndexedDBContentProvider }> {
  const service = new StorageService(new InMemoryStorage());
  return { service, provider: new IndexedDBContentProvider(service) };
}

describe('placing a note on several pages', () => {
  it('lists every page the note is placed on', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });

    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
    await provider.addEntryPlacement(saved.id, { slug: 'gym' });

    const entry = await provider.getEntry(saved.id);
    expect(entry?.placements?.map((placement) => placement.pageId)).toHaveLength(2);
    expect(entry?.placements?.some((placement) => placement.date === '2026-10-15')).toBe(true);
    expect(entry?.placements?.some((placement) => placement.slug === 'gym')).toBe(true);
  });

  it('keeps the note on its first page when it is placed on a second', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, journalDate: '2026-10-15', type: 'journal' });

    await provider.addEntryPlacement(saved.id, { slug: 'gym' });

    const entry = await provider.getEntry(saved.id);
    expect(entry?.placements?.map((placement) => placement.slug ?? placement.date).sort())
      .toEqual(['2026-10-15', 'gym']);
  });

  it('shows the note in both date listings', async () => {
    const { service, provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });

    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
    await provider.addEntryPlacement(saved.id, { date: '2026-10-16' });

    const first = await provider.getEntries();
    expect(first.filter((entry) => entry.placements?.some((placement) => placement.date === '2026-10-15'))).toHaveLength(1);
    expect(first.filter((entry) => entry.placements?.some((placement) => placement.date === '2026-10-16'))).toHaveLength(1);
    expect(await service.getAllPageNotes()).toHaveLength(2);
  });

  it('keeps the note\u2019s canonical route — placement never clones or deletes it', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });

    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
    await provider.addEntryPlacement(saved.id, { slug: 'gym' });
    const moved = await provider.moveEntryPlacement(saved.id, (await provider.getEntry(saved.id))!.placements![0].pageId, { slug: 'travel' });

    expect(moved.id).toBe(saved.id);
    expect(moved.sourceId).toBeUndefined();
    expect((await provider.getEntries()).map((entry) => entry.id)).toEqual([saved.id]);
  });
});

describe('removing a placement', () => {
  it('detaches the note from that page only', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });
    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
    await provider.addEntryPlacement(saved.id, { slug: 'gym' });

    const entry = await provider.getEntry(saved.id);
    const datePage = entry!.placements!.find((placement) => placement.date === '2026-10-15')!;
    const updated = await provider.removeEntryPlacement(saved.id, datePage.pageId);

    expect(updated.placements?.map((placement) => placement.slug)).toEqual(['gym']);
  });
});

describe('moving a placement', () => {
  it('detaches from the source and attaches at the destination', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });
    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
    await provider.addEntryPlacement(saved.id, { slug: 'gym' });

    const entry = await provider.getEntry(saved.id);
    const source = entry!.placements!.find((placement) => placement.date === '2026-10-15')!;
    const updated = await provider.moveEntryPlacement(saved.id, source.pageId, { date: '2026-10-16' });

    expect(updated.placements?.some((placement) => placement.date === '2026-10-15')).toBe(false);
    expect(updated.placements?.some((placement) => placement.date === '2026-10-16')).toBe(true);
    // The named page placement survives the move.
    expect(updated.placements?.some((placement) => placement.slug === 'gym')).toBe(true);
  });

  it('refuses to move from a page the note is not placed on', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });
    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });

    const failure = await provider.moveEntryPlacement(saved.id, 'some-other-page', { date: '2026-10-16' })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(NotePersistenceError);
    if (!(failure instanceof NotePersistenceError)) throw new Error('expected NotePersistenceError');
    expect(failure.code).toBe('NOTE_NOT_PLACED');
    expect(failure.message).toMatch(/not placed/);
    // Nothing changed: the note is still on its original page only.
    const entry = await provider.getEntry(saved.id);
    expect(entry?.placements?.map((placement) => placement.date)).toEqual(['2026-10-15']);
  });

  it('never resolves a page slug as a note — a slug naming several notes picks none', async () => {
    const { provider } = await makeProvider();
    const first = await provider.saveEntry({ title: 'First', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });
    const second = await provider.saveEntry({ title: 'Second', rawContent: SOURCE, tags: [], targetDate: 2, type: 'journal' });
    await provider.addEntryPlacement(first.id, { slug: 'gym' });
    await provider.addEntryPlacement(second.id, { slug: 'gym' });

    // The page slug addresses a PAGE, not a note: passing it where a note id
    // is required must fail instead of silently picking the first note.
    const failure = await provider.addEntryPlacement('gym', { date: '2026-10-15' })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(NotePersistenceError);
    if (!(failure instanceof NotePersistenceError)) throw new Error('expected NotePersistenceError');
    expect(failure.code).toBe('NOTE_NOT_FOUND');

    await expect(provider.removeEntryPlacement('gym', 'any-page')).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await expect(provider.moveEntryPlacement('gym', 'any-page', { date: '2026-10-16' })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });

    // Neither note gained a placement from the failed operations.
    for (const note of [first, second]) {
      const entry = await provider.getEntry(note.id);
      expect(entry?.placements?.map((placement) => placement.slug)).toEqual(['gym']);
    }
  });
});

describe('the named-page listing', () => {
  it('returns every note on the page in canonical placement order, each addressing its own note', async () => {
    const { provider } = await makeProvider();
    const first = await provider.saveEntry({ title: 'First', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });
    const second = await provider.saveEntry({ title: 'Second', rawContent: SOURCE, tags: [], targetDate: 2, type: 'journal' });

    await provider.addEntryPlacement(first.id, { slug: 'gym' });
    await provider.addEntryPlacement(second.id, { slug: 'gym' });

    const listing = await provider.getPageEntries('gym');
    // Both notes are on the listing; canonical order itself is pinned by the
    // core comparePlacements suite.
    expect([...listing.map((entry) => entry.id)].sort()).toEqual([first.id, second.id].sort());
    expect(listing.map((entry) => entry.title).sort()).toEqual(['First', 'Second']);
    // Each listed entry carries its own canonical address, never the page.
    expect(listing.every((entry) => entry.id !== 'gym')).toBe(true);
  });

  it('is empty for an unknown page', async () => {
    const { provider } = await makeProvider();
    expect(await provider.getPageEntries('missing')).toEqual([]);
  });
});

describe('the primary projection', () => {
  it('names the first placement in canonical order and keeps every placement', async () => {
    const { provider } = await makeProvider();
    const saved = await provider.saveEntry({ title: 'A', rawContent: SOURCE, tags: [], targetDate: 1, type: 'journal' });
    await provider.addEntryPlacement(saved.id, { date: '2026-10-15' });
    await provider.addEntryPlacement(saved.id, { slug: 'gym' });

    const entry = await provider.getEntry(saved.id);
    expect(entry?.placements).toHaveLength(2);
    expect(entry?.journalDate).toBe('2026-10-15');
    expect(entry?.slug).toBe('gym');
  });
});
