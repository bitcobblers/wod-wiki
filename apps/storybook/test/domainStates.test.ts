import { describe, expect, it } from 'vitest';
import { validateNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { buildDomainWorld } from '@bitcobblers/wod-wiki-core/testing';
import { DOMAIN_STATE_PRESETS, resolveDomainStateWorld } from '../src/testing/domainStates';
import type { DomainStatePresetName } from '../src/testing/domainStates';

const PRESET_NAMES = Object.keys(DOMAIN_STATE_PRESETS) as DomainStatePresetName[];

describe('domain state presets', () => {
  it('exposes exactly the six documented presets and resolves them by name', () => {
    expect([...PRESET_NAMES].sort()).toEqual([
      'activeSession',
      'empty',
      'populatedJournal',
      'readOnlyFeedNote',
      'scopedPropertyOverride',
      'skippedDependencyDiagnostic',
    ]);
    for (const name of PRESET_NAMES) {
      expect(resolveDomainStateWorld(name)).toBe(DOMAIN_STATE_PRESETS[name]);
    }
  });

  it('passes custom DomainWorldInput specs through unchanged', () => {
    const custom = { notes: [{ id: 'note-custom', title: 'Custom', rawContent: '# Custom\n' }] };
    expect(resolveDomainStateWorld(custom)).toBe(custom);
  });

  it.each(PRESET_NAMES)(
    '%s builds a world with valid Note blocks, Session pins and ScopedPropertyOverride ids',
    (name) => {
      const world = buildDomainWorld(resolveDomainStateWorld(name));

      const notesById = new Map(world.notes.map((note) => [note.id, note]));
      expect(notesById.size).toBe(world.notes.length);
      for (const note of world.notes) {
        validateNoteBlocks(note.rawContent, note.blocks, note.sourceRevision);
        expect(note.id.length).toBeGreaterThan(0);
      }

      for (const session of world.sessions) {
        const note = notesById.get(session.noteId);
        expect(note, `session ${session.id} pins a stored note`).toBeDefined();
        const block = note?.blocks[session.blockId];
        expect(block, `session ${session.id} pins an existing block`).toBeDefined();
        expect(block?.version).toBe(session.blockVersion);
        for (const event of world.events) {
          if (event.resultId === session.id) {
            expect(event.noteId).toBe(session.noteId);
            expect(event.blockId).toBe(session.blockId);
            expect(event.blockVersion).toBe(session.blockVersion);
          }
        }
      }

      for (const override of world.propertyOverrides) {
        expect(override.id).toBe(`${override.notebookId}:${override.kind}:${override.slug}`);
        expect(override.notebookId.startsWith('notebook/')).toBe(true);
        expect(notesById.get(override.ownerNoteId), `override ${override.id} has its owner note`).toBeDefined();
      }

      const sessionIds = new Set(world.sessions.map((session) => session.id));
      for (const event of world.events) {
        expect(sessionIds.has(event.resultId), `event ${event.id} belongs to a session`).toBe(true);
      }
    },
  );

  it('keeps the per-preset guarantees the stories rely on', () => {
    const empty = buildDomainWorld(resolveDomainStateWorld('empty'));
    expect(empty.notes).toEqual([]);
    expect(empty.sessions).toEqual([]);
    expect(empty.propertyOverrides).toEqual([]);
    expect(empty.events).toEqual([]);

    const active = buildDomainWorld(resolveDomainStateWorld('activeSession'));
    const fran = active.sessions.find((session) => session.id === 'sess-active-fran');
    expect(fran?.noteId).toBe('note-active-fran');
    expect(
      active.events.some((event) =>
        event.metrics.some((metric) => metric.type === 'resistance' && metric.unit === 'lb' && metric.value === 95),
      ),
    ).toBe(true);

    const overrideIds = buildDomainWorld(resolveDomainStateWorld('scopedPropertyOverride')).propertyOverrides.map(
      (override) => override.id,
    );
    expect(overrideIds).toEqual(expect.arrayContaining(['notebook/olympic-lifting:effort:snatch', 'notebook/custom:effort:snatch']));

    const diagnostic = buildDomainWorld(resolveDomainStateWorld('skippedDependencyDiagnostic'));
    expect(
      diagnostic.events.some((event) => event.metrics.some((metric) => metric.type === 'diagnostic' && metric.origin === 'compiler')),
    ).toBe(true);

    const feed = buildDomainWorld(resolveDomainStateWorld('readOnlyFeedNote'));
    expect(feed.sessions).toEqual([]);
    expect(feed.notes.find((note) => note.id === 'seed-note-helen')).toMatchObject({
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
    });

    const journal = buildDomainWorld(resolveDomainStateWorld('populatedJournal'));
    expect(journal.sessions.length).toBeGreaterThan(0);
    expect(journal.events.length).toBeGreaterThan(0);
    for (const session of journal.sessions) expect(session.notebookIds).toContain('notebook/journal');
  });
});
