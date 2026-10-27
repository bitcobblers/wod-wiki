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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
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
