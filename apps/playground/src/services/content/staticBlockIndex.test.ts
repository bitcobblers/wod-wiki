/**
 * Pure derivations over the static block-index corpus (issue #853):
 *   - feedDateToCreatedAt: feed path date keys → createdAt ms, 0 when
 *     malformed (undated rows are excluded from dated windows).
 *   - staticTagIndexFromBlocks: tag → noteIds from frontmatter rows — the
 *     corpus tag vocabulary the composer's `tag:` suggestions list.
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
  feedDateToCreatedAt,
  invalidateCorpusBlocks,
  staticTagIndexFromBlocks,
} from './staticBlockIndex';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { invalidateSuggestions, loadSuggestions } from '@bitcobblers/wod-wiki-ui';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';

function blockRow(partial: Partial<BlockIndexRow>): BlockIndexRow {
  return {
    id: 'static:note:seg:1',
    noteId: 'feeds/feed-a/2026-01-12/note',
    segmentId: 'seg',
    segmentVersion: 1,
    position: 0,
    dataType: 'markdown',
    rawContent: '',
    noteTitle: 'Note',
    createdAt: 0,
    isStatic: true,
    ...partial,
  } as BlockIndexRow;
}

describe('feedDateToCreatedAt', () => {
  it('parses a yyyy-mm-dd key to UTC midnight', () => {
    expect(feedDateToCreatedAt('2026-01-12')).toBe(Date.parse('2026-01-12T00:00:00Z'));
  });

  it('returns 0 for malformed keys', () => {
    expect(feedDateToCreatedAt('jan-12')).toBe(0);
    expect(feedDateToCreatedAt('2026-1-2')).toBe(0);
    expect(feedDateToCreatedAt('')).toBe(0);
  });

  it('returns 0 for impossible dates', () => {
    expect(feedDateToCreatedAt('2026-13-01')).toBe(0);
  });
});

describe('staticTagIndexFromBlocks', () => {
  it('maps frontmatter tags to their note ids, both YAML forms', () => {
    const blocks = [
      blockRow({ noteId: 'feeds/feed-a/2026-01-12/note-a', dataType: 'frontmatter', rawContent: 'tags:\n  - strength\n  - conditioning' }),
      blockRow({ noteId: 'crossfit-girls/fran', dataType: 'frontmatter', rawContent: 'tags: [strength, benchmark]' }),
      blockRow({ noteId: 'crossfit-girls/fran', dataType: 'wod', rawContent: 'tags: not-frontmatter' }),
      blockRow({ noteId: 'feeds/feed-a/2026-01-13/note-b', dataType: 'frontmatter', rawContent: 'met: 7.0' }),
    ];
    const index = staticTagIndexFromBlocks(blocks);
    expect([...(index.get('strength') ?? [])].sort()).toEqual([
      'crossfit-girls/fran',
      'feeds/feed-a/2026-01-12/note-a',
    ]);
    expect(index.get('conditioning')).toEqual(new Set(['feeds/feed-a/2026-01-12/note-a']));
    expect(index.get('benchmark')).toEqual(new Set(['crossfit-girls/fran']));
    expect(index.get('not-frontmatter')).toBeUndefined();
    expect(index.get('met')).toBeUndefined();
  });

  it('returns an empty index when no frontmatter rows carry tags', () => {
    expect(staticTagIndexFromBlocks([blockRow({})]).size).toBe(0);
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

    expect((await loadSuggestions('type')).map((item) => item.value)).toEqual(['wod', 'movement', 'workout']);
  });
});
