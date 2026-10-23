import { describe, expect, it, beforeEach } from 'bun:test';
import { StorageService } from './StorageService';
import { InMemoryStorage } from './InMemoryStorage';
import type { TagTypeRecord } from '@/types/storage';

describe('TagType Storage and CRUD (Ticket 01)', () => {
  let storage: InMemoryStorage;
  let service: StorageService;

  beforeEach(() => {
    storage = new InMemoryStorage();
    service = new StorageService(storage);
  });

  it('can create, retrieve, list, and delete tag types', async () => {
    const tagType: TagTypeRecord = {
      id: 'type-equipment',
      name: 'equipment',
      label: 'Equipment',
      color: '#3b82f6',
      createdAt: 1000,
    };

    await service.putTagType(tagType);

    const allTypes = await service.getAllTagTypes();
    expect(allTypes).toHaveLength(1);
    expect(allTypes[0]).toEqual(tagType);

    const byId = await service.getTagType('type-equipment');
    expect(byId).toEqual(tagType);

    const byName = await service.getTagType('equipment');
    expect(byName).toEqual(tagType);

    await service.deleteTagType('type-equipment');
    const remaining = await service.getAllTagTypes();
    expect(remaining).toHaveLength(0);
  });

  it('filters tags by type and allows updating a tag type', async () => {
    await service.putTagType({
      id: 'type-discipline',
      name: 'discipline',
      label: 'Discipline',
      createdAt: 1000,
    });

    await service.putTag({
      id: 'tag-1',
      label: 'barbell',
      type: 'equipment',
      createdAt: 1000,
    });

    await service.putTag({
      id: 'tag-2',
      label: 'gymnastics',
      type: 'discipline',
      createdAt: 1001,
    });

    await service.putTag({
      id: 'tag-3',
      label: 'general-note',
      createdAt: 1002,
    });

    const disciplineTags = await service.getTags('discipline');
    expect(disciplineTags.map(t => t.label)).toEqual(['gymnastics']);

    const equipmentTags = await service.getTags('equipment');
    expect(equipmentTags.map(t => t.label)).toEqual(['barbell']);

    const allTags = await service.getAllTags();
    expect(allTags).toHaveLength(3);

    // Update tag type
    await service.updateTagType('tag-3', 'discipline');
    const updatedDisciplineTags = await service.getTags('discipline');
    expect(updatedDisciplineTags.map(t => t.label).sort()).toEqual(['general-note', 'gymnastics']);
  });
  it('seeds the default kinds when the registry is empty', async () => {
    await service.ensureDefaultTagTypes();

    const names = (await service.getAllTagTypes()).map(t => t.name).sort();
    expect(names).toContain('equipment');
    expect(names).toContain('discipline');
  });

  it('leaves a registry the user already filled alone', async () => {
    await service.putTagType({
      id: 'type-movement',
      name: 'movement',
      label: 'Movement',
      createdAt: 1000,
    });

    await service.ensureDefaultTagTypes();

    const names = (await service.getAllTagTypes()).map(t => t.name);
    expect(names).toEqual(['movement']);
  });
});
