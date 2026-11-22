import type { IStorage, StoreName, StoreType } from '@bitcobblers/wod-wiki-storage';
import type { Tag, TagTypeRecord } from '@bitcobblers/wod-wiki-core';
import {
  buildDomainWorld,
  resetTestingVocabulary,
  type DomainWorld,
  type DomainWorldInput,
} from '@bitcobblers/wod-wiki-core/testing';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';

export const PERSIST_WORLD_STORES: StoreName[] = [
  'notes',
  'block_revisions',
  'note_revisions',
  'block_index',
  'block_efforts',
  'block_equipment',
  'tags',
  'tag_types',
  'note_tags',
  'notebook_links',
  'property_overrides',
  'efforts',
  'equipment',
  'page',
  'page_notes',
  'schedule_items',
  'sessions',
  'events',
];

/**
 * Persists a complete domain world snapshot to storage in a single transaction.
 * Projects bundled/defaults efforts & equipment, and projects property overrides into tags & tag_types.
 */
export async function persistDomainWorld(
  storage: IStorage,
  worldInput?: DomainWorld | DomainWorldInput,
): Promise<DomainWorld> {
  const isBuiltWorld =
    worldInput !== undefined &&
    'revisions' in worldInput &&
    Array.isArray((worldInput as DomainWorld).revisions) &&
    'events' in worldInput &&
    Array.isArray((worldInput as DomainWorld).events);

  let world: DomainWorld;
  if (isBuiltWorld) {
    world = worldInput as DomainWorld;
  } else {
    resetTestingVocabulary();
    world = buildDomainWorld(worldInput ?? {});
  }

  const explicitNoteIds = new Set(world.notes.map((n) => n.id));

  await storage.transaction([...PERSIST_WORLD_STORES], 'readwrite', async (tx) => {
    for (const nb of world.notebooks) {
      if (!explicitNoteIds.has(nb.id)) {
        await tx.readwrite('notes').put(nb);
      }
    }
    if (world.notes.length) await tx.readwrite('notes').putMany(world.notes);
    if (world.revisions.length) await tx.readwrite('block_revisions').putMany(world.revisions);
    if (world.noteRevisions?.length) await tx.readwrite('note_revisions').putMany(world.noteRevisions);
    if (world.blockIndex.length) await tx.readwrite('block_index').putMany(world.blockIndex);
    if (world.blockEfforts.length) await tx.readwrite('block_efforts').putMany(world.blockEfforts);
    if (world.blockEquipment.length) await tx.readwrite('block_equipment').putMany(world.blockEquipment);
    if (world.tags.length) await tx.readwrite('tags').putMany(world.tags);
    if (world.noteTags.length) await tx.readwrite('note_tags').putMany(world.noteTags);
    if (world.notebookLinks.length) await tx.readwrite('notebook_links').putMany(world.notebookLinks);

    for (const override of world.propertyOverrides) {
      await tx.readwrite('property_overrides').put(override);
      if (override.kind === 'tag' && override.payload) {
        await tx.readwrite('tags').put(override.payload as unknown as Tag);
      } else if (override.kind === 'tag-type' && override.payload) {
        await tx.readwrite('tag_types').put(override.payload as unknown as TagTypeRecord);
      }
    }

    // Project bundled/defaults Effort and Equipment Property Notes into lookup stores
    if (!isBuiltWorld && (worldInput as DomainWorldInput | undefined)?.propertyNotes) {
      for (const propInput of (worldInput as DomainWorldInput).propertyNotes ?? []) {
        const isDefault =
          !propInput.asOverride &&
          (propInput.notebookId === undefined || propInput.notebookId === 'notebook/defaults');
        if (!isDefault) continue;
        if (propInput.kind === 'effort') {
          const effortRow: StoreType<'efforts'> = {
            id: propInput.id ?? `effort-${propInput.slug}`,
            slug: propInput.slug,
            label: propInput.label,
            aliases: propInput.aliases ?? [],
            baseAttributes: {
              met: 5.0,
              ...(propInput.baseAttributes ?? {}),
            } as IEffort['baseAttributes'],
            registrySource: 'bundled',
            sourceId: 'core',
            ...(propInput.body ? { body: propInput.body } : {}),
          };
          await tx.readwrite('efforts').put(effortRow);
        } else if (propInput.kind === 'equipment') {
          const equipRow: StoreType<'equipment'> = {
            id: propInput.id ?? `equipment-${propInput.slug}`,
            slug: propInput.slug,
            label: propInput.label,
            aliases: propInput.aliases ?? [],
            registrySource: 'bundled',
            sourceId: 'core',
            ...(propInput.body ? { body: propInput.body } : {}),
          };
          await tx.readwrite('equipment').put(equipRow);
        }
      }
    }

    if (world.pages.length) await tx.readwrite('page').putMany(world.pages);
    if (world.pageNotes.length) await tx.readwrite('page_notes').putMany(world.pageNotes);
    if (world.scheduleItems?.length) await tx.readwrite('schedule_items').putMany(world.scheduleItems);
    if (world.sessions.length) await tx.readwrite('sessions').putMany(world.sessions);
    if (world.events.length) await tx.readwrite('events').putMany(world.events);
  });

  return world;
}
