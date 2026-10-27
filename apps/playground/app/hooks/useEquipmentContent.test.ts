/**
 * Regression coverage for clone-on-save of a bundled equipment definition
 * (the equipment twin of dogfood finding 5): saving an edit to a bundled
 * definition must persist the clone under its own note
 * (`equipment/sled-custom`) and leave the bundled note untouched. The
 * deployed behavior points the commit at the bundled note id, so the
 * "clone" overwrites the bundled source and no custom note copy exists.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { useEquipmentContent, type UseEquipmentContentResult } from './useEquipmentContent';
import { EquipmentRegistryProvider } from '../contexts/EquipmentRegistryContext';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';

const SLED_DOC = [
  '---',
  'type: equipment',
  'id: equipment-bundled-sled',
  'slug: sled',
  'label: Sled',
  'aliases: []',
  'registrySource: bundled',
  '---',
  '',
  '# Sled',
].join('\n');

beforeEach(() => {
  setStorageForTesting(new InMemoryStorage());
});

afterEach(() => {
  cleanup();
  resetStorageForTesting();
});

async function seedBundledSled(): Promise<void> {
  await storageService.saveEquipment({
    id: 'equipment-bundled-sled',
    slug: 'sled',
    label: 'Sled',
    aliases: [],
    registrySource: 'bundled',
    ownerNoteId: 'equipment/sled',
    sourceId: 'equipment',
    sourcePath: 'equipment/sled',
  });
  await storageService.saveNoteSource({
    noteId: 'equipment/sled',
    rawContent: SLED_DOC,
    expectedSourceRevision: 0,
    metadata: { title: 'Sled', sourceId: 'equipment' },
    createdAt: Date.now(),
  });
}

function EquipmentProbe(props: { slug: string; expose: (result: UseEquipmentContentResult) => void }) {
  props.expose(useEquipmentContent(props.slug));
  return null;
}

describe('useEquipmentContent — editing a bundled definition clones it', () => {
  it('persists the clone under its own note and leaves the bundled note untouched', async () => {
    await seedBundledSled();

    let latest: UseEquipmentContentResult | undefined;
    render(
      createElement(
        EquipmentRegistryProvider,
        null,
        createElement(EquipmentProbe, { slug: 'sled', expose: (result: UseEquipmentContentResult) => { latest = result; } }),
      ),
    );
    await waitFor(() => expect(latest!.equipment?.slug).toBe('sled'), { timeout: 5000 });
    await waitFor(() => expect(latest!.document).toContain('label: Sled'), { timeout: 5000 });
    expect(latest!.isEditable).toBe(false);

    // The user's edit: relabel the loaded bundled document.
    const edited = latest!.document.replace('label: Sled', 'label: Heavy Sled');
    await act(async () => { await latest!.save(edited); });

    // The clone owns its note — the deployed code wrote the clone content
    // over `equipment/sled` instead, leaving no custom copy.
    const cloneNote = await storageService.getNote('equipment/sled-custom');
    expect(cloneNote).toBeDefined();
    expect(cloneNote!.sourceRevision).toBe(1);
    expect(cloneNote!.rawContent).toContain('slug: sled-custom');
    expect(cloneNote!.rawContent).toContain('registrySource: user');
    expect(cloneNote!.rawContent).toContain('Heavy Sled');

    const clone = await storageService.getEquipment('sled-custom');
    expect(clone).toBeDefined();
    expect(clone!.registrySource).toBe('user');
    expect(clone!.id).not.toBe('equipment-bundled-sled');
    expect(clone!.ownerNoteId).toBe('equipment/sled-custom');

    // Bundled source and projection are read-only seed state: unchanged.
    const bundledNote = await storageService.getNote('equipment/sled');
    expect(bundledNote!.rawContent).toContain('slug: sled');
    expect(bundledNote!.rawContent).toContain('label: Sled');
    expect(bundledNote!.rawContent).not.toContain('sled-custom');
    expect(bundledNote!.sourceRevision).toBe(1);
    expect((await storageService.getEquipment('sled'))!.registrySource).toBe('bundled');

    // A follow-up edit updates the clone in place at its own revision.
    await act(async () => { await latest!.save(cloneNote!.rawContent.replace('# Sled', '# Heavy Sled')); });
    const updated = await storageService.getNote('equipment/sled-custom');
    expect(updated!.sourceRevision).toBe(2);
    expect(updated!.rawContent).toContain('# Heavy Sled');
    expect(await storageService.getNote('equipment/sled-custom-custom')).toBeUndefined();
    expect(await storageService.getEquipment('sled-custom-custom')).toBeUndefined();
  });
});
