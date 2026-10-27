/**
 * Regression coverage for clone-on-save of a bundled effort (dogfood
 * finding 5): editing bundled Thruster (MET 8 → 9) and saving must clone —
 * a fresh user-owned identity, its own note at revision 1, the bundled
 * source and projection untouched — and a follow-up save must bump the
 * clone's revision, never spawn another clone.
 *
 * The deployed behavior computes the stale-source guard from the bundled
 * note while the commit writes the brand-new `effort/thruster-custom`
 * note, so the whole transaction aborts ("Note effort/thruster-custom
 * changed since it was loaded") and no custom copy exists.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { useEffortContent, type UseEffortContentResult } from './useEffortContent';
import { EffortRegistryProvider } from '../contexts/EffortRegistryContext';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';

const THRUSTER_DOC = [
  '---',
  'id: effort-bundled-thruster',
  'slug: thruster',
  'label: Thruster',
  'aliases: []',
  'baseAttributes:',
  '  met: 8',
  'registrySource: bundled',
  '---',
  '',
  '# Thruster',
].join('\n');

beforeEach(() => {
  setStorageForTesting(new InMemoryStorage());
});

afterEach(() => {
  cleanup();
  resetStorageForTesting();
});

/** Seed the bundled Thruster exactly as the seed sync leaves it: a
 *  read-only projection row plus its owning note at revision 1. */
async function seedBundledThruster(): Promise<void> {
  await storageService.saveEffort({
    id: 'effort-bundled-thruster',
    slug: 'thruster',
    label: 'Thruster',
    aliases: [],
    baseAttributes: { met: 8 },
    registrySource: 'bundled',
    ownerNoteId: 'effort/thruster',
    sourceId: 'efforts',
    sourcePath: 'effort/thruster',
  });
  await storageService.saveNoteSource({
    noteId: 'effort/thruster',
    rawContent: THRUSTER_DOC,
    expectedSourceRevision: 0,
    metadata: { title: 'Thruster', sourceId: 'efforts' },
    createdAt: Date.now(),
  });
}

function EffortProbe(props: { slug: string; expose: (result: UseEffortContentResult) => void }) {
  props.expose(useEffortContent(props.slug));
  return null;
}

describe('useEffortContent — editing a bundled effort clones it', () => {
  it('creates a user-owned clone with its own note and leaves the bundled source untouched', async () => {
    await seedBundledThruster();

    let latest: UseEffortContentResult | undefined;
    render(
      createElement(
        EffortRegistryProvider,
        null,
        createElement(EffortProbe, { slug: 'thruster', expose: (result: UseEffortContentResult) => { latest = result; } }),
      ),
    );
    await waitFor(() => expect(latest!.effort?.slug).toBe('thruster'), { timeout: 5000 });
    await waitFor(() => expect(latest!.document).toContain('met: 8'), { timeout: 5000 });
    expect(latest!.isEditable).toBe(false);

    // The user's edit: MET 8 → 9 in the loaded document.
    const edited = latest!.document.replace('met: 8', 'met: 9');
    await act(async () => { await latest!.save(edited); });

    // The clone gets its own note at a fresh revision, carrying the edit
    // and the patched user identity.
    const cloneNote = await storageService.getNote('effort/thruster-custom');
    expect(cloneNote).toBeDefined();
    expect(cloneNote!.sourceRevision).toBe(1);
    expect(cloneNote!.rawContent).toContain('slug: thruster-custom');
    expect(cloneNote!.rawContent).toContain('registrySource: user');
    expect(cloneNote!.rawContent).toContain('met: 9');
    expect(cloneNote!.rawContent).not.toContain('effort-bundled-thruster');

    // The clone projection is user-owned, derived from Thruster, and owns
    // the clone note.
    const clone = await storageService.getEffort('thruster-custom');
    expect(clone).toBeDefined();
    expect(clone!.registrySource).toBe('user');
    expect(clone!.id).not.toBe('effort-bundled-thruster');
    expect(clone!.derivation?.parentSlug).toBe('thruster');
    expect(clone!.ownerNoteId).toBe('effort/thruster-custom');

    // Bundled source and projection are read-only seed state: unchanged.
    const bundledNote = await storageService.getNote('effort/thruster');
    expect(bundledNote!.rawContent).toContain('met: 8');
    expect(bundledNote!.rawContent).toContain('registrySource: bundled');
    expect(bundledNote!.sourceRevision).toBe(1);
    const bundled = await storageService.getEffort('thruster');
    expect(bundled!.registrySource).toBe('bundled');
    expect(bundled!.baseAttributes.met).toBe(8);

    // A follow-up edit updates the clone in place at its own revision —
    // it must not clone again.
    await act(async () => { await latest!.save(cloneNote!.rawContent.replace('met: 9', 'met: 10')); });
    const updated = await storageService.getNote('effort/thruster-custom');
    expect(updated!.sourceRevision).toBe(2);
    expect(updated!.rawContent).toContain('met: 10');
    expect(await storageService.getNote('effort/thruster-custom-custom')).toBeUndefined();
    expect(await storageService.getEffort('thruster-custom-custom')).toBeUndefined();
  });
});
