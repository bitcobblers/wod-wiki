/**
 * Regression coverage for the reference-note commit seam (dogfood findings 4/9).
 *
 * Finding 4: a Property Note carrying an actionable fence (the ```query
 * widget every synthesized Tag/Category Property Note embeds) must survive
 * `commitReferenceNote` → storage → reload with its frontmatter metrics and
 * prose intact, and its contributions must be projected together with the
 * source. The deployed behavior loses the whole save: the tag/tag-type
 * branches hand `saveNoteSource` a `blocks: {}` map, `validateNoteBlocks`
 * rejects it as an "Incomplete actionable block map", the transaction
 * aborts and the caller's `void save()` swallows the error — so on reload
 * the document is re-synthesized without the user's edits.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { IndexedDBStorage } from '@bitcobblers/wod-wiki-storage/idb';
import { SEED_SCHEMA, seedNoteId, type SeedManifest } from '@bitcobblers/wod-wiki-engine';
import { compileSeedRow } from '../../../../packages/tools/src/seedbuild/compiler';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { IndexedDBFeedImportStorage } from '@/services/feed/FeedImportStorage';
import { InMemoryFeedSource } from '@/services/feed/InMemoryFeedSource';
import { runBootFeedSync, type FeedSourceSpec } from '@/services/feed/feedSync';
import { commitReferenceNote } from './referenceNotes';

beforeEach(() => {
  setStorageForTesting(new InMemoryStorage());
});

afterEach(() => {
  resetStorageForTesting();
});

describe('commitReferenceNote — Tag Category Property Note (/t/:category)', () => {
  // The exact shape buildTagCategoryNoteDocument synthesizes, plus the edit
  // from the dogfood session: one flat `metrics.resistance` frontmatter line.
  const categoryDoc = [
    '---',
    'type: tag-type',
    'id: tag-type-domain',
    'slug: domain',
    'label: Domain',
    'metrics.resistance: 12kg',
    'summaries.totalWork: sum(work)',
    '---',
    '',
    '# Domain',
    '',
    '```query',
    ':tag{type:domain}',
    '```',
  ].join('\n');

  it('persists the added metric and the prose through commit and reload', async () => {
    const result = await commitReferenceNote({
      kind: 'tag-type',
      slug: 'domain',
      title: 'Domain',
      rawContent: categoryDoc,
      expectedSourceRevision: 0,
      noteId: 't/domain',
    });

    expect(result.id).toBe('t/domain');
    expect(result.sourceRevision).toBe(1);

    // Source seam: the committed document keeps the metric AND the prose.
    const stored = await storageService.getNote('t/domain');
    expect(stored).toBeDefined();
    expect(stored!.rawContent).toContain('metrics.resistance: 12kg');
    expect(stored!.rawContent).toContain('# Domain');
    expect(stored!.rawContent).toContain('```query');

    // Projection seam: the category row resolves AND carries the frontmatter
    // as executable contributions — summary keys keep their authored case.
    const tagType = await storageService.getTagType('domain');
    expect(tagType).toBeDefined();
    expect(tagType!.label).toBe('Domain');
    expect(tagType!.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
    expect(tagType!.contributions).toContainEqual({ kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' });
  });

  it('accepts a second commit at the returned source revision', async () => {
    const first = await commitReferenceNote({
      kind: 'tag-type',
      slug: 'domain',
      title: 'Domain',
      rawContent: categoryDoc,
      expectedSourceRevision: 0,
      noteId: 't/domain',
    });
    const second = await commitReferenceNote({
      kind: 'tag-type',
      slug: 'domain',
      title: 'Domain',
      rawContent: `${categoryDoc}\n\nRefined prose.`,
      expectedSourceRevision: first.sourceRevision,
      noteId: 't/domain',
    });
    expect(second.sourceRevision).toBe(first.sourceRevision + 1);
    const stored = await storageService.getNote('t/domain');
    expect(stored!.rawContent).toContain('metrics.resistance: 12kg');
    expect(stored!.rawContent).toContain('Refined prose.');
    const tagType = await storageService.getTagType('domain');
    expect(tagType!.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
  });

  it('commits a prose-only category note (boundary: the widget fence, not the metric, must not matter)', async () => {
    const proseOnly = [
      '---',
      'type: tag-type',
      'id: tag-type-domain',
      'slug: domain',
      'label: Domain',
      'metrics.resistance: 12kg',
      '---',
      '',
      '# Domain',
    ].join('\n');
    const result = await commitReferenceNote({
      kind: 'tag-type',
      slug: 'domain',
      title: 'Domain',
      rawContent: proseOnly,
      expectedSourceRevision: 0,
      noteId: 't/domain',
    });
    expect(result.sourceRevision).toBe(1);
    const stored = await storageService.getNote('t/domain');
    expect(stored!.rawContent).toContain('metrics.resistance: 12kg');
    const tagType = await storageService.getTagType('domain');
    expect(tagType!.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
  });

  it('mirrors the source: removing the frontmatter rules removes the projection', async () => {
    await commitReferenceNote({
      kind: 'tag-type',
      slug: 'domain',
      title: 'Domain',
      rawContent: categoryDoc,
      expectedSourceRevision: 0,
      noteId: 't/domain',
    });
    const stripped = categoryDoc
      .replace('metrics.resistance: 12kg\n', '')
      .replace('summaries.totalWork: sum(work)\n', '');
    await commitReferenceNote({
      kind: 'tag-type',
      slug: 'domain',
      title: 'Domain',
      rawContent: stripped,
      expectedSourceRevision: 1,
      noteId: 't/domain',
    });
    const tagType = await storageService.getTagType('domain');
    expect(tagType!.contributions ?? []).toEqual([]);
  });
});

describe('commitReferenceNote — Tag Property Note (/t/:category/:slug)', () => {
  it('projects metric and summary contributions together with the committed source', async () => {
    const tagDoc = [
      '---',
      'type: domain',
      'id: tag-tonnage',
      'slug: tonnage',
      'label: tonnage',
      'metrics.resistance: 12kg',
      'summaries.totalWork: sum(work)',
      '---',
      '',
      '# tonnage',
      '',
      '```query',
      ':note{tags:tonnage}',
      '```',
    ].join('\n');

    await commitReferenceNote({
      kind: 'tag',
      slug: 'tonnage',
      category: 'domain',
      title: 'tonnage',
      rawContent: tagDoc,
      expectedSourceRevision: 0,
      noteId: 't/domain/tonnage',
    });

    const stored = await storageService.getNote('t/domain/tonnage');
    expect(stored).toBeDefined();
    expect(stored!.rawContent).toContain('metrics.resistance: 12kg');
    expect(stored!.rawContent).toContain('summaries.totalWork: sum(work)');

    const tags = await storageService.getAllTags();
    const tonnage = tags.find((tag) => tag.label === 'tonnage');
    expect(tonnage).toBeDefined();
    expect(tonnage!.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
    expect(tonnage!.contributions).toContainEqual({ kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' });
  });

  it('projects summary contributions for a tag that carries no nested tags', async () => {
    // The deployed commit only reaches the summaries loop from inside the
    // nested-tags loop, so a tag like `tonnage` (no `tags:` entries) loses
    // every summary contribution on save.
    const tagDoc = [
      '---',
      'type: domain',
      'id: tag-tonnage',
      'slug: tonnage',
      'label: tonnage',
      'summaries.totalWork: sum(work)',
      '---',
      '',
      '# tonnage',
    ].join('\n');

    await commitReferenceNote({
      kind: 'tag',
      slug: 'tonnage',
      category: 'domain',
      title: 'tonnage',
      rawContent: tagDoc,
      expectedSourceRevision: 0,
      noteId: 't/domain/tonnage',
    });

    const tags = await storageService.getAllTags();
    const tonnage = tags.find((tag) => tag.label === 'tonnage');
    expect(tonnage!.contributions).toContainEqual({ kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' });
  });
});

describe('WW-020 — commitReferenceNote durable IndexedDB persistence across reload and boot feed sync', () => {
  it('stamps seedOrigin=user and survives IndexedDB reopen + runBootFeedSync for effort create, clone, and tag save', async () => {
    const dbName = `ww020-refnotes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idb1 = new IndexedDBStorage({ dbName });
    setStorageForTesting(idb1);

    const effortDoc = [
      '---',
      'id: effort-user-rowing-custom',
      'slug: rowing-custom',
      'label: Rowing (Custom)',
      'aliases:',
      '  - row custom',
      'baseAttributes:',
      '  met: 8.5',
      'registrySource: user',
      '---',
      '',
      'Custom rowing body prose preserved across reload.',
    ].join('\n');

    const tagDoc = [
      '---',
      'type: domain',
      'id: tag-user-erg-test',
      'slug: erg-test',
      'label: erg-test',
      'metrics.resistance: 10',
      '---',
      '',
      '# erg-test',
    ].join('\n');

    try {
      const committedEffort = await commitReferenceNote({
        kind: 'effort',
        slug: 'rowing-custom',
        title: 'Rowing (Custom)',
        rawContent: effortDoc,
        expectedSourceRevision: 0,
      });
      expect(committedEffort.id).toBe('effort/rowing-custom');

      // Second revision commit verifies update path works cleanly inside IndexedDB transaction scope.
      const updatedEffort = await commitReferenceNote({
        kind: 'effort',
        slug: 'rowing-custom',
        title: 'Rowing (Custom)',
        rawContent: `${effortDoc}\n\nSecond line.`,
        expectedSourceRevision: committedEffort.sourceRevision,
      });
      expect(updatedEffort.sourceRevision).toBe(2);

      await commitReferenceNote({
        kind: 'tag',
        slug: 'erg-test',
        category: 'domain',
        title: 'erg-test',
        rawContent: tagDoc,
        expectedSourceRevision: 0,
      });

      const beforeClose = await storageService.getNote('effort/rowing-custom');
      expect(beforeClose?.seedOrigin).toBe('user');
      expect(beforeClose?.rawContent).toContain('Custom rowing body prose preserved across reload.');
      expect(beforeClose?.rawContent).toContain('Second line.');
    } finally {
      await idb1.close();
    }

    // Reopen fresh IndexedDBStorage against the same dbName (simulates full page reload)
    // and run boot feed sync with a core efforts chunk.
    const idb2 = new IndexedDBStorage({ dbName });
    setStorageForTesting(idb2);
    try {
      const bundledEffortRow = compileSeedRow(
        'markdown/efforts/rowing.md',
        [
          '---',
          'id: effort-rowing',
          'slug: rowing',
          'label: Rowing',
          'aliases:',
          '  - row',
          'baseAttributes:',
          '  met: 7.0',
          'registrySource: bundled',
          '---',
          '',
          'Bundled rowing.',
        ].join('\n'),
      );
      bundledEffortRow.uuid = await seedNoteId(bundledEffortRow.path);
      const manifest: SeedManifest = {
        schema: SEED_SCHEMA,
        version: 1,
        commit: 'seed-v1',
        builtAt: new Date(1000).toISOString(),
        chunks: [
          {
            id: 'efforts',
            path: 'chunks/efforts.json',
            sha256: '1'.repeat(64),
            bytes: 100,
            count: 1,
          },
        ],
      };
      const feedStorage = new IndexedDBFeedImportStorage(idb2);
      const sources: FeedSourceSpec[] = [
        {
          id: 'core',
          label: 'Core',
          source: new InMemoryFeedSource(manifest, { 'chunks/efforts.json': [bundledEffortRow] }),
          url: 'https://feed.test/core/',
          embeddedVersion: 1,
        },
      ];
      const outcome = await runBootFeedSync({ sources, storage: feedStorage, isEnabled: () => true });
      expect(outcome).toBe('imported');

      const reloadedEffortNote = await storageService.getNote('effort/rowing-custom');
      expect(reloadedEffortNote).toBeDefined();
      expect(reloadedEffortNote?.seedOrigin).toBe('user');
      expect(reloadedEffortNote?.rawContent).toContain('Custom rowing body prose preserved across reload.');
      expect(reloadedEffortNote?.rawContent).toContain('Second line.');

      const reloadedEffortProj = await storageService.getEffort('rowing-custom');
      expect(reloadedEffortProj).toBeDefined();
      expect(reloadedEffortProj?.registrySource).toBe('user');

      const reloadedTagNote = await storageService.getNote('t/domain/erg-test');
      expect(reloadedTagNote).toBeDefined();
      expect(reloadedTagNote?.seedOrigin).toBe('user');
      expect(reloadedTagNote?.rawContent).toContain('metrics.resistance: 10');
    } finally {
      await idb2.close();
    }
  });
});
