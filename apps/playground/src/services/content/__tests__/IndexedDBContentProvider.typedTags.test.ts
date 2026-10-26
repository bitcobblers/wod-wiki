import { describe, expect, it, beforeEach } from 'bun:test';
import { InMemoryStorage } from '../../storage/InMemoryStorage';
import { StorageService } from '../../storage/StorageService';
import { IndexedDBContentProvider } from '../IndexedDBContentProvider';

describe('IndexedDBContentProvider Typed Tags Sync (Ticket 02)', () => {
  let storage: InMemoryStorage;
  let service: StorageService;
  let provider: IndexedDBContentProvider;

  beforeEach(() => {
    storage = new InMemoryStorage();
    service = new StorageService(storage);
    provider = new IndexedDBContentProvider(service);
  });

  it('synchronizes frontmatter matching tag types to Tag and NoteTag records on note save', async () => {
    // 1. Register tag types
    await service.putTagType({
      id: 'type-equipment',
      name: 'equipment',
      label: 'Equipment',
      createdAt: 1000,
    });
    await service.putTagType({
      id: 'type-discipline',
      name: 'discipline',
      label: 'Discipline',
      createdAt: 1000,
    });

    // 2. Save note with frontmatter containing equipment and discipline
    const rawContent = `---
title: Fran
equipment:
  - barbell
  - pullup-bar
discipline: gymnastics
tags:
  - benchmark
---
21-15-9
Thrusters
Pull-ups
`;

    const entry = await provider.saveRecord({
      title: 'Fran',
      rawContent,
      targetDate: Date.now(),
      tags: [],
    });

    const noteTags = await service.getTagsForNote(entry.id);
    const labels = noteTags.map((t) => t.label).sort();
    expect(labels).toEqual(['barbell', 'benchmark', 'gymnastics', 'pullup-bar']);

    const equipmentTags = await service.getTags('equipment');
    expect(equipmentTags.map((t) => t.label).sort()).toEqual(['barbell', 'pullup-bar']);

    const disciplineTags = await service.getTags('discipline');
    expect(disciplineTags.map((t) => t.label)).toEqual(['gymnastics']);

    // 3. Update note removing barbell and pullup-bar, leaving only kettlebell
    const updatedContent = `---
title: Fran
equipment:
  - kettlebell
tags:
  - benchmark
---
21-15-9
Thrusters
Pull-ups
`;

    await provider.updateRecord(entry.id, {
      rawContent: updatedContent,
      expectedSourceRevision: entry.sourceRevision,
    });

    const updatedNoteTags = await service.getTagsForNote(entry.id);
    const updatedLabels = updatedNoteTags.map((t) => t.label).sort();
    expect(updatedLabels).toEqual(['benchmark', 'kettlebell']);

    // barbell still exists in tags store, but is no longer linked to this note
    const allEquipment = await service.getTags('equipment');
    expect(allEquipment.map((t) => t.label).sort()).toEqual(['barbell', 'kettlebell', 'pullup-bar']);
  });
});
