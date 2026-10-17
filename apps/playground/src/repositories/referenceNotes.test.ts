/** Atomic reference-note commit: projection + source + links commit or roll back together. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { storageService, setStorageForTesting, resetStorageForTesting } from '@/services/storage';
import { commitReferenceNote, deleteReferenceNote } from './referenceNotes';

const KETTLEBELL_DOC = [
  '---',
  'type: equipment',
  'id: equipment-user-test-kettlebell',
  'slug: kettlebell',
  'label: Kettlebell',
  'aliases: []',
  'registrySource: user',
  '---',
  '',
  '```time',
  '10 Kettlebell Swings @24kg',
  '```',
  '',
].join('\n');

const BUNDLED_DOC = [
  '---',
  'type: equipment',
  'id: equipment-bundled-dumbbell',
  'slug: dumbbell',
  'label: Dumbbell',
  'aliases: []',
  'registrySource: bundled',
  '---',
  '',
].join('\n');

beforeEach(() => {
  setStorageForTesting(new InMemoryStorage());
});

afterEach(() => {
  resetStorageForTesting();
});

describe('commitReferenceNote', () => {
  it('commits projection, owning note and derived links as one visible save', async () => {
    const saved = await commitReferenceNote({
      kind: 'equipment',
      slug: 'kettlebell',
      rawContent: KETTLEBELL_DOC,
      title: 'Kettlebell',
      expectedSourceRevision: 0,
    });

    expect(saved.id).toBe('equipment/kettlebell');
    expect(saved.sourceRevision).toBeGreaterThan(0);

    const projection = await storageService.getEquipment('kettlebell');
    expect(projection).toMatchObject({
      id: 'equipment-user-test-kettlebell',
      slug: 'kettlebell',
      registrySource: 'user',
      ownerNoteId: 'equipment/kettlebell',
      sourceId: 'equipment',
    });

    const note = await storageService.getNote('equipment/kettlebell');
    expect(note?.rawContent).toBe(KETTLEBELL_DOC);
    expect(note?.title).toBe('Kettlebell');
    expect(note?.sourceId).toBe('equipment');
    // Derived containment from the definition's own example block.
    const links = await storageService.getAllFromIndex('block_equipment', 'by-note', 'equipment/kettlebell');
    expect(Array.isArray(links)).toBe(true);
  });

  it('rolls the whole commit back on a stale revision — no partial projection or source', async () => {
    await commitReferenceNote({ kind: 'equipment', slug: 'kettlebell', rawContent: KETTLEBELL_DOC, title: 'Kettlebell', expectedSourceRevision: 0 });
    const before = await storageService.getNote('equipment/kettlebell');

    await expect(commitReferenceNote({
      kind: 'equipment',
      slug: 'kettlebell',
      rawContent: KETTLEBELL_DOC,
      title: 'Kettlebell',
      expectedSourceRevision: 0, // stale: the note already exists at revision 1
    })).rejects.toThrow();

    expect(await storageService.getEquipment('kettlebell')).toMatchObject({ id: 'equipment-user-test-kettlebell' });
    expect((await storageService.getNote('equipment/kettlebell'))?.sourceRevision).toBe(before?.sourceRevision);
  });

  it('rejects invalid documents before any write, keeping the draft state untouched', async () => {
    await commitReferenceNote({ kind: 'equipment', slug: 'kettlebell', rawContent: KETTLEBELL_DOC, title: 'Kettlebell', expectedSourceRevision: 0 });
    const countBefore = (await storageService.getAllEquipment()).length;

    await expect(commitReferenceNote({
      kind: 'equipment',
      slug: 'kettlebell',
      rawContent: 'no frontmatter at all',
      title: 'Kettlebell',
      expectedSourceRevision: 0,
    })).rejects.toThrow();

    expect((await storageService.getAllEquipment()).length).toBe(countBefore);
    await expect(storageService.getNote('equipment/kettlebell')).resolves.toBeDefined();
  });

  it('refuses to save over a bundled definition', async () => {
    await storageService.saveEquipment({
      id: 'equipment-bundled-dumbbell', slug: 'dumbbell', label: 'Dumbbell', aliases: [], registrySource: 'bundled',
    });
    await expect(commitReferenceNote({
      kind: 'equipment',
      slug: 'dumbbell',
      rawContent: BUNDLED_DOC,
      title: 'Dumbbell',
      expectedSourceRevision: 0,
    })).rejects.toThrow(/bundled/);
    expect(await storageService.getNote('equipment/dumbbell')).toBeUndefined();
  });

  it('removes exactly the user-owned projection and its note — never bundled rows', async () => {
    await storageService.saveEquipment({
      id: 'equipment-bundled-dumbbell', slug: 'dumbbell', label: 'Dumbbell', aliases: [], registrySource: 'bundled',
    });
    await commitReferenceNote({ kind: 'equipment', slug: 'kettlebell', rawContent: KETTLEBELL_DOC, title: 'Kettlebell', expectedSourceRevision: 0 });

    await expect(deleteReferenceNote('equipment', 'dumbbell')).rejects.toThrow(/not user-owned/);
    expect(await storageService.getEquipment('dumbbell')).toBeDefined();

    await deleteReferenceNote('equipment', 'kettlebell');
    expect(await storageService.getEquipment('kettlebell')).toBeUndefined();
    expect(await storageService.getNote('equipment/kettlebell')).toBeUndefined();
  });
});
