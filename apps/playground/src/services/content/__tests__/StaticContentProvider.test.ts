import { describe, it, expect } from 'bun:test';
import { StaticContentProvider } from '../StaticContentProvider';
import { createNotePersistence } from '../../persistence';

describe('StaticContentProvider', () => {
  const content = '# Test Workout\n\n```time\n10:00 Run\n```';

  it('should have mode "static"', () => {
    const provider = new StaticContentProvider(content);
    expect(provider.mode).toBe('static');
  });

  it('should have mutable in-memory capabilities', () => {
    const provider = new StaticContentProvider(content);
    expect(provider.capabilities.canWrite).toBe(true);
    expect(provider.capabilities.canDelete).toBe(false);
    expect(provider.capabilities.canFilter).toBe(false);
    expect(provider.capabilities.canMultiSelect).toBe(false);
    expect(provider.capabilities.supportsHistory).toBe(true);
  });

  it('getRecords should return a single entry', async () => {
    const provider = new StaticContentProvider(content);
    const entries = await provider.getRecords();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('static');
    expect(entries[0].rawContent).toBe(content);
    expect(entries[0].schemaVersion).toBe(1);
  });

  it('getRecord should return entry for id "static"', async () => {
    const provider = new StaticContentProvider(content);
    const entry = await provider.getRecord('static');
    expect(entry).not.toBeNull();
    expect(entry!.rawContent).toBe(content);
  });

  it('getRecord should return the singleton entry for any id', async () => {
    const provider = new StaticContentProvider(content);
    const entry = await provider.getRecord('unknown-id');
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('static');
  });

  it('saveRecord should update the singleton entry', async () => {
    const provider = new StaticContentProvider(content);
    const original = await provider.getRecord('static');
    const saved = await provider.saveRecord({ title: 'X', rawContent: 'new content', tags: [], targetDate: 1, sourceRevision: original!.sourceRevision });
    expect(saved.id).toBe('static');
    expect(saved.rawContent).toBe('new content');
    const fetched = await provider.getRecord('static');
    expect(fetched!.rawContent).toBe('new content');
  });

  it('updateRecord should patch the singleton entry', async () => {
    const provider = new StaticContentProvider(content);
    const updated = await provider.updateRecord('static', { title: 'New' });
    expect(updated.title).toBe('New');
    expect(updated.rawContent).toBe(content);
  });

  it('deleteRecord should be a no-op', async () => {
    const provider = new StaticContentProvider(content);
    await provider.deleteRecord('static');
    const entry = await provider.getRecord('static');
    expect(entry).not.toBeNull();
  });

  it('starts against its own immutable revision and preserves never-run versions', async () => {
    const provider = new StaticContentProvider(content);
    const persistence = createNotePersistence(provider);
    const saved = await persistence.getNote('static');
    const blockId = Object.keys(saved.blocks!)[0]!;
    const changed = content.replace('10:00', '12:00');
    const next = await persistence.saveNote({ noteId: saved.id, rawContent: changed,
      blocks: saved.blocks!, expectedSourceRevision: saved.sourceRevision! });
    const started = await persistence.startSession({ noteId: saved.id, rawContent: changed,
      blocks: next.blocks!, expectedSourceRevision: next.sourceRevision! },
      { id: 'static-run', noteId: saved.id, blockId, startTime: 1, endTime: 1,
        duration: 0, completed: false, createdAt: 1 });
    expect(started.session.blockVersion).toBe(2);
    expect(started.revision.rawContent).toContain('12:00');
    expect((await persistence.getBlockHistory(saved.id, blockId)).map(row => row.version)).toEqual([1, 2]);

    await expect(provider.saveRecord({ title: 'Stale', rawContent: content, tags: [], targetDate: 1,
      sourceRevision: saved.sourceRevision })).rejects.toMatchObject({ code: 'STALE_SOURCE' });
  });
});
