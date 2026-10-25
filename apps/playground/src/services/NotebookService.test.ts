import { describe, expect, it, beforeEach } from 'bun:test';
import { NotebookService } from './NotebookService';
import { LocalStore, InMemoryBackend } from './storage/LocalStore';

describe('NotebookService', () => {
  let backend: InMemoryBackend;
  let service: NotebookService;

  beforeEach(() => {
    backend = new InMemoryBackend();
    service = new NotebookService(new LocalStore('wodwiki:', backend));
  });

  it('starts with no notebooks', () => {
    expect(service.getAll()).toEqual([]);
    expect(service.getActiveId()).toBeNull();
  });

  it('creates and retrieves notebooks', async () => {
    const nb = await service.create('CrossFit WODs', 'Daily training logs', '🏋️');
    expect(nb.name).toBe('CrossFit WODs');
    expect(nb.description).toBe('Daily training logs');
    expect(nb.icon).toBe('🏋️');
    expect(nb.id).toBeDefined();

    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(nb.id);

    const fetched = service.getById(nb.id);
    expect(fetched?.name).toBe('CrossFit WODs');
  });

  it('updates an existing notebook', async () => {
    const nb = await service.create('Old Name');
    const updated = await service.update(nb.id, { name: 'New Name', icon: '🔥' });
    expect(updated.name).toBe('New Name');
    expect(updated.icon).toBe('🔥');

    expect(service.getById(nb.id)?.name).toBe('New Name');
  });

  it('deletes a notebook and clears active ID if deleted was active', async () => {
    const nb1 = await service.create('Notebook 1');
    const nb2 = await service.create('Notebook 2');
    await service.setActiveId(nb1.id);

    expect(service.getActiveId()).toBe(nb1.id);
    await service.delete(nb1.id);

    expect(service.getAll()).toHaveLength(1);
    expect(service.getAll()[0].id).toBe(nb2.id);
    expect(service.getActiveId()).toBeNull();
  });

  it('ensureDefault creates default notebook when empty', async () => {
    const activeId = await service.ensureDefault();
    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('My Workouts');
    expect(activeId).toBe(all[0].id);
    expect(service.getActiveId()).toBe(all[0].id);
  });

  it('ensureDefault reuses existing active notebook', async () => {
    const nb1 = await service.create('Existing');
    await service.setActiveId(nb1.id);

    const activeId = await service.ensureDefault();
    expect(activeId).toBe(nb1.id);
    expect(service.getAll()).toHaveLength(1);
  });

  it('assigns canonical notebook/{slug} identifiers and exposes predefined defaults (journal, playground, guides)', async () => {
    const defaults = service.getDefaultNotebooks();
    expect(defaults.map((n) => n.notebookId)).toEqual([
      'notebook/journal',
      'notebook/playground',
      'notebook/guides',
    ]);
    expect(defaults.find((n) => n.slug === 'guides')?.feedEntryId).toBe('core');
    expect(defaults.find((n) => n.slug === 'guides')?.sourceUrl).toContain('seed/core/');

    const created = await service.create('2027 Open Prep', '8-week block', '🔥');
    expect(created.slug).toBe('2027-open-prep');
    expect(created.id).toBe('notebook/2027-open-prep');
    expect(created.notebookId).toBe('notebook/2027-open-prep');
    expect(created.origin).toBe('user');
  });

  it('binds feed-delivered notebooks to the registered feed entry and URL where the feed is pulled from', () => {
    const seedNotebooks = service.getFeedNotebooks();
    const girls = seedNotebooks.find((n) => n.notebookId === 'notebook/crossfit-girls');
    expect(girls).toBeDefined();
    expect(girls?.origin).toBe('feed');
    // The split corpus binds each notebook to its own repo's seed source.
    expect(girls?.feedEntryId).toBe('seed-crossfit');
    expect(girls?.packageId).toBe('community-crossfit-girls');
    expect(girls?.sourceUrl).toContain('wod-wiki-seed-crossfit');
  });
});
