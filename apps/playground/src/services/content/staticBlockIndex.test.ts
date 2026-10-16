/**
 * Pure date-key and whole-Note tag derivations for composer suggestions.
 */
import { describe, expect, it } from 'bun:test';
import type { BlockIndexRow } from '@/types/storage';

// The corpus plane reads the shared `block_index` store — mock the service
// before importing the module under test.
import { storageService } from '@/services/storage';
const blockRows: BlockIndexRow[] = [];
storageService.getAllBlockIndex = async () => blockRows;
storageService.getAllTags = async () => [];
import {
  invalidateCorpusBlocks,
  staticTagIndexFromNotes,
} from './staticBlockIndex';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { invalidateSuggestions, loadSuggestions } from '@bitcobblers/wod-wiki-ui';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';

function blockRow(partial: Partial<BlockIndexRow>): BlockIndexRow {
  return {
    id: 'note:block',
    noteId: 'feeds/feed-a/2026-01-12/note',
    blockId: 'block',
    blockVersion: 1,
    sourceRevision: 1,
    from: 0,
    to: 1,
    position: 0,
    dataType: 'query',
    rawContent: '',
    noteTitle: 'Note',
    createdAt: 0,
    isStatic: true,
    ...partial,
  } as BlockIndexRow;
}

describe('staticTagIndexFromNotes', () => {
  it('maps authored frontmatter tags including prose-only Notes', () => {
    const index = staticTagIndexFromNotes([
      { id: 'feed-a', rawContent: '---\ntags:\n  - strength\n  - conditioning\n---\nProse' },
      { id: 'fran', rawContent: '---\ntags: [strength, benchmark]\n---\n```time\n10 Pushups\n```' },
      { id: 'untagged', rawContent: 'tags: not-frontmatter' },
    ]);
    expect([...(index.get('strength') ?? [])].sort()).toEqual(['feed-a', 'fran']);
    expect(index.get('conditioning')).toEqual(new Set(['feed-a']));
    expect(index.get('benchmark')).toEqual(new Set(['fran']));
    expect(index.get('not-frontmatter')).toBeUndefined();
  });
  it('returns an empty index without tags', () => {
    expect(staticTagIndexFromNotes([{ id: 'n', rawContent: 'Prose' }]).size).toBe(0);
  });
});

describe('composer suggestion bindings (vault/canonical normalization)', () => {
  it('ranks vault values first, canonical spelling wins enum keys, effort value is the registry slug', async () => {
    blockRows.length = 0;
    blockRows.push(blockRow({ dataType: 'wod' }));
    invalidateCorpusBlocks();
    storageService.getAllEfforts = async () => [];
    await getAppEffortRegistry().loadBundled([
      {
        slug: 'air-squat',
        label: 'Air Squat',
        baseAttributes: { met: 3, discipline: 'Strength', intensityTier: 'MODERATE' },
        registrySource: 'user',
      },
      {
        slug: 'Rowing-Intervals',
        label: 'Rowing Intervals',
        baseAttributes: { met: 7, discipline: 'rowing', intensityTier: 'high' },
        registrySource: 'bundled',
      },
    ] as IEffort[]);
    invalidateSuggestions();

    // Vault disciplines first (case-deduped to canonical spelling), then the
    // canonical static vocabulary — no bogus crossfit/climbing/yoga entries.
    expect((await loadSuggestions('discipline')).map((item) => item.value)).toEqual([
      'strength',
      'rowing',
      'bodyweight',
      'cycling',
      'gymnastics',
      'kettlebell',
      'recovery',
      'running',
      'swimming',
      'walking',
    ]);
    expect((await loadSuggestions('intensity')).map((item) => item.value)).toEqual(['moderate', 'high', 'low']);

    const efforts = await loadSuggestions('effort');
    expect(efforts.map((item) => item.value)).toEqual(['air-squat', 'Rowing-Intervals']);
    expect(efforts.map((item) => item.label)).toEqual(['Air Squat', 'Rowing Intervals']);

    expect((await loadSuggestions('type')).map((item) => item.value)).toEqual(['wod', 'query', 'widget', 'embed']);
  });
});
