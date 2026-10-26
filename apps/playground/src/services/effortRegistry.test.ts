/**
 * Hydration contract: the typed projection stores (`efforts` / `equipment`)
 * are the SINGLE read index for definition hydration.
 *
 * Every writer — seed import, app commit, CLI import, delete — puts a
 * definition's note and its projection rows in ONE transaction, so the
 * projection is the note index's typed form, not an independently
 * maintained source. Hydration reads only the projection: a definition
 * note whose projection was removed never resurrects through hydration.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'bun:test';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import { createAppEffortRegistry, hydrateAppEffortRegistry } from './effortRegistry';
import { storageService, storage } from '@/services/storage';

function projection(overrides: Partial<IEffort> & { slug: string }): IEffort {
  return {
    id: `effort-${overrides.slug}`,
    slug: overrides.slug,
    label: overrides.slug,
    aliases: [],
    baseAttributes: { met: 5.3 },
    registrySource: 'bundled',
    ownerNoteId: `note-${overrides.slug}`,
    ...overrides,
  };
}

describe('hydrateAppEffortRegistry — the projection is the single read index', () => {
  // The storage singleton is shared across tests in this file — clear the
  // projection store so each case starts from an empty index.
  async function clearEfforts(): Promise<void> {
    for (const effort of await storageService.getAllEfforts()) {
      await storageService.deleteEffort(effort.slug);
    }
  }

  it('hydrates the bundled tier from the typed projection, exactly', async () => {
    await clearEfforts();
    await storageService.saveEffort(projection({ slug: 'fran' }));
    await storageService.saveEffort(projection({ slug: 'grace' }));
    await storageService.saveEffort(projection({ slug: 'custom-thruster', registrySource: 'user' }));

    const registry = createAppEffortRegistry();
    await hydrateAppEffortRegistry(registry);

    // The bundled tier is the bundled projection rows — nothing more,
    // nothing less. The user row belongs to the user tier's storage adapter,
    // not this load.
    expect(registry.listByOrigin('bundled').map((effort) => effort.slug)).toEqual(['fran', 'grace']);
  });

  it('an emptied projection leaves no stale rows — notes never feed hydration', async () => {
    await clearEfforts();
    await storageService.saveEffort(projection({ slug: 'fran' }));
    // The owning note OUTLIVES its projection (deletion semantics are a
    // later ticket) — it must not resurrect the definition on hydration.
    await storage.transaction(['notes'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        id: 'note-fran', title: 'Fran', createdAt: 0, type: 'note',
        rawContent: '---\nslug: fran\n---\n', sourceRevision: 1, blocks: {},
      });
    });

    const registry = createAppEffortRegistry();
    await hydrateAppEffortRegistry(registry);
    expect(registry.listByOrigin('bundled')).toHaveLength(1);

    await storageService.deleteEffort('fran');
    await hydrateAppEffortRegistry(registry);

    expect(registry.listByOrigin('bundled')).toHaveLength(0);
  });
});
