import { describe, expect, it } from 'vitest';
import {
  MemoryFeedTree,
  applySeedChunk,
  createParser,
  emptySeedMeta,
  prepareJournalSessionRun,
  promoteNoteToNotebooks,
  publishFeedFromStorage,
  reconcileNoteBlocks,
  resolveScopedPropertyCatalog,
  saveScopedPropertyOverride,
  setNotebookPublic,
  type Note,
} from '../src/index';
import { compileSeedRow } from '../../tools/src/seedbuild/compiler';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';

function createRealSqlStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

describe('Candidate 03 — Scoped Property Note Override Inheritance & Publish Promotion', () => {
  it('resolves defaults -> subscribed Feed Notebook overrides -> custom overrides on the same canonical slug, and supports choosing custom runtime vs source Notebook precedence', async () => {
    const storage = createRealSqlStorage();

    // 1. Seed read-only `defaults` primitive for 'thruster' (MET 6.0) via core feed
    const defaultThrusterMd = [
      '---',
      'id: effort-core-thruster',
      'slug: thruster',
      'label: Thruster',
      'aliases:',
      '  - thrusters',
      'baseAttributes:',
      '  met: 6.0',
      '---',
      '# Thruster (Default)',
      '',
    ].join('\n');
    const coreRow = compileSeedRow('markdown/efforts/weightlifting/thruster.md', defaultThrusterMd);
    const coreManifest = {
      schema: 9 as const,
      version: 1,
      builtAt: '2026-11-10T00:00:00Z',
      chunks: [{ id: 'efforts', path: 'chunks/efforts.00000001.json', sha256: '0'.repeat(64), bytes: 100, count: 1 }],
    };
    await applySeedChunk(storage, {
      chunkId: 'efforts',
      rows: [coreRow],
      manifest: coreManifest,
      expectedMeta: undefined,
      meta: {
        ...emptySeedMeta('seed:core'),
        seedVersion: 1,
        builtAt: coreManifest.builtAt,
        importedAt: 1000,
        tier: 'core',
        chunks: { efforts: { sha256: '0'.repeat(64) } },
      },
    });

    // 2. Subscribe to a peer Feed ('coach-kb') publishing 'notebook.kettlebell-wod' AND its own override of 'thruster' (MET 9.5)
    const feedThrusterMd = [
      '---',
      'id: effort-feed-thruster',
      'slug: thruster',
      'label: Double KB Thruster',
      'aliases:',
      '  - thrusters',
      'baseAttributes:',
      '  met: 9.5',
      '---',
      '# Double KB Thruster (Feed Override)',
      '',
    ].join('\n');
    const feedWorkoutMd = '# KB Fran\n\n```time\n21-15-9\n  Thrusters\n```\n';
    const feedEffortRow = compileSeedRow('markdown/efforts/thruster.md', feedThrusterMd);
    const feedNoteRow = compileSeedRow('markdown/notebooks/kettlebell-wod/kb-fran.md', feedWorkoutMd);
    const peerManifest = {
      schema: 9 as const,
      version: 1,
      builtAt: '2026-11-10T01:00:00Z',
      chunks: [
        { id: 'notebook.kettlebell-wod', path: 'chunks/notebook.kettlebell-wod.11111111.json', sha256: '1'.repeat(64), bytes: 100, count: 1, kind: 'notes' as const },
        { id: 'efforts', path: 'chunks/efforts.22222222.json', sha256: '2'.repeat(64), bytes: 100, count: 1 },
      ],
      notebooks: [
        {
          notebookId: 'notebook.kettlebell-wod',
          label: 'Kettlebell WOD',
          category: 'kettlebell-wod',
          indexPath: 'indexes/notebooks/notebook.kettlebell-wod.json',
          version: 1,
          commit: '',
          updatedAt: '2026-11-10T01:00:00Z',
          builtAt: '2026-11-10T01:00:00Z',
          sha256: '1'.repeat(64),
          bytes: 100,
          count: 1,
        },
      ],
    };
    const peerMeta1 = {
      ...emptySeedMeta('seed:coach-kb'),
      seedVersion: 1,
      builtAt: peerManifest.builtAt,
      importedAt: 2000,
      tier: 'imported' as const,
      chunks: { 'notebook.kettlebell-wod': { sha256: '1'.repeat(64) } },
    };
    await applySeedChunk(storage, {
      chunkId: 'notebook.kettlebell-wod',
      rows: [feedNoteRow],
      manifest: peerManifest,
      expectedMeta: undefined,
      meta: peerMeta1,
    });
    const peerMeta2 = {
      ...peerMeta1,
      chunks: {
        ...peerMeta1.chunks,
        efforts: { sha256: '2'.repeat(64) },
      },
    };
    await applySeedChunk(storage, {
      chunkId: 'efforts',
      rows: [feedEffortRow],
      manifest: peerManifest,
      expectedMeta: peerMeta1,
      meta: peerMeta2,
    });

    // 3. User ALSO creates a personal override of 'thruster' (MET 7.5) in `notebook/custom` on the SAME canonical slug 'thruster'
    const customThrusterMd = [
      '---',
      'slug: thruster',
      'label: Barbell Thruster (My Custom)',
      'aliases:',
      '  - thrusters',
      'baseAttributes:',
      '  met: 7.5',
      '---',
      '# My Custom Thruster',
      '',
    ].join('\n');
    await saveScopedPropertyOverride(storage, {
      targetNotebookId: 'notebook/custom',
      kind: 'effort',
      slug: 'thruster',
      rawContent: customThrusterMd,
    });

    // A) Pure defaults resolution -> MET 6.0
    const defaultsCat = await resolveScopedPropertyCatalog(storage, {
      notebookId: 'notebook/defaults',
    });
    expect(defaultsCat.referenceIndex.resolveEffort('thruster')?.baseAttributes.met).toBe(6.0);
    expect(defaultsCat.originByKey.get('effort:thruster')).toBe('notebook/defaults');

    // B) Ordinary user Journal workout -> uses user's `notebook/custom` override (MET 7.5) on exact slug 'thruster'
    const journalCat = await resolveScopedPropertyCatalog(storage, {
      notebookId: 'notebook/journal',
    });
    expect(journalCat.referenceIndex.resolveEffort('thruster')?.baseAttributes.met).toBe(7.5);
    expect(journalCat.originByKey.get('effort:thruster')).toBe('notebook/custom');

    // Parser resolves `Thrusters` in workout syntax directly against the scoped catalog!
    const parsedScript = createParser({
      references: journalCat.referenceIndex,
      tags: journalCat.tagIndex,
    }).read('21 Thrusters');
    expect(parsedScript.statements.length).toBeGreaterThan(0);

    // C) Linking/running KB Fran from subscribed `notebook/kettlebell-wod` (and its Journal run clone!):
    //    - Default ('source-first'): uses the subscribed Notebook's override (MET 9.5, Double KB Thruster)!
    //    - 'custom-runtime': user chooses to process runtime with their personal `notebook/custom` override (MET 7.5)!
    const allNotes = await storage.readonly('notes').getAll();
    const kbFranNote = allNotes.find((n) => n.sourcePath === 'markdown/notebooks/kettlebell-wod/kb-fran.md')!;
    expect(kbFranNote).toBeDefined();

    const feedNoteCat = await resolveScopedPropertyCatalog(storage, {
      note: kbFranNote,
      mode: 'source-first',
    });
    expect(feedNoteCat.referenceIndex.resolveEffort('thruster')?.baseAttributes.met).toBe(9.5);
    expect(feedNoteCat.originByKey.get('effort:thruster')).toBe('notebook/kettlebell-wod');

    // Run KB Fran -> creates Journal clone carrying provenance.sourceNotebookId = 'notebook/kettlebell-wod'
    const run = await prepareJournalSessionRun(storage, {
      noteId: kbFranNote.id,
      journalDate: '2026-11-10',
    });
    const cloneSourceFirst = await resolveScopedPropertyCatalog(storage, {
      note: run.note,
      mode: 'source-first',
    });
    expect(cloneSourceFirst.referenceIndex.resolveEffort('thruster')?.baseAttributes.met).toBe(9.5);

    const cloneCustomRuntime = await resolveScopedPropertyCatalog(storage, {
      note: run.note,
      mode: 'custom-runtime',
    });
    expect(cloneCustomRuntime.referenceIndex.resolveEffort('thruster')?.baseAttributes.met).toBe(7.5);

    await storage.close();
  });

  it('promotes referenced custom overrides into a user Notebook upon publish and emits them in the outbound Feed', async () => {
    const storage = createRealSqlStorage();

    // User creates an override in `notebook/custom` for `thruster` (MET 8.2)
    await saveScopedPropertyOverride(storage, {
      targetNotebookId: 'notebook/custom',
      kind: 'effort',
      slug: 'thruster',
      rawContent: [
        '---',
        'slug: thruster',
        'label: Heavy Pause Thruster',
        'aliases:',
        '  - thrusters',
        'baseAttributes:',
        '  met: 8.2',
        '---',
        '# Heavy Pause Thruster',
        '',
      ].join('\n'),
    });

    // User creates a Journal workout referencing `Thrusters` and promotes it to `notebook/competition-prep`
    const wodRaw = '# Heavy 15\n\n```time\n15 Thrusters 135lb\n```\n';
    const blocks = reconcileNoteBlocks(wodRaw, { sourceRevision: 1 });
    const wod = Object.values(blocks)[0]!;
    const note: Note = {
      id: '01950000-0000-7000-8000-000000000301',
      title: 'Heavy 15',
      rawContent: wodRaw,
      sourceRevision: 1,
      blocks,
      createdAt: 1000,
      type: 'journal',
      seedOrigin: 'user',
    };
    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(note);
      await tx.readwrite('block_revisions').put({
        noteId: note.id,
        blockId: wod.id,
        version: 1,
        kind: 'wod',
        rawContent: wodRaw.slice(wod.from, wod.to),
        savedAt: 1000,
        dialect: 'time',
      });
    });

    await promoteNoteToNotebooks(storage, {
      noteId: note.id,
      notebookIds: ['notebook/competition-prep'],
    });
    await setNotebookPublic(storage, 'notebook/competition-prep', true);

    const tree = new MemoryFeedTree();
    const published = await publishFeedFromStorage(storage, tree, {
      layout: 'feed',
      name: 'Competition Prep Feed',
    });

    // 1. The referenced `thruster` override from `notebook/custom` was promoted to `notebook/competition-prep`
    const promotedOverrides = await storage
      .readonly('property_overrides')
      .getAllFromIndex('by-notebook', 'notebook/competition-prep');
    expect(promotedOverrides.map((o) => `${o.kind}:${o.slug}`)).toContain('effort:thruster');

    // 2. And emitted into the outbound Feed (`markdown/efforts/thruster.md` + `efforts` chunk in manifest)!
    expect(published.manifest.chunks.some((c) => c.id === 'efforts')).toBe(true);
    const emittedEffortMd = new TextDecoder().decode(await tree.read('markdown/efforts/thruster.md'));
    expect(emittedEffortMd).toContain('Heavy Pause Thruster');
    expect(emittedEffortMd).toContain('8.2');

    await storage.close();
  });
});
