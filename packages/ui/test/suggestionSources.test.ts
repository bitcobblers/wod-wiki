import { describe, expect, it } from 'vitest';
import { EFFORT_DISCIPLINES } from '@bitcobblers/wod-wiki-lang';
import {
  CANONICAL_BLOCK_TYPES,
  canonicalSuggestionItems,
  catalogIdsFromBlocks,
  mergeSuggestionItems,
  SUGGESTION_BINDINGS,
} from '../src/composer/suggestionSources';
import { WQL_INTENSITY_TIERS } from '@bitcobblers/wod-wiki-wql';

describe('canonical suggestion values', () => {
  it('builtin discipline/intensity/type are exactly the canonical vocabularies', async () => {
    expect((await SUGGESTION_BINDINGS.discipline.load()).map((item) => item.value))
      .toEqual([...EFFORT_DISCIPLINES]);
    expect((await SUGGESTION_BINDINGS.intensity.load()).map((item) => item.value))
      .toEqual([...WQL_INTENSITY_TIERS]);
    expect((await SUGGESTION_BINDINGS.type.load()).map((item) => item.value))
      .toEqual([...CANONICAL_BLOCK_TYPES]);
  });

  it('merge dedups case-insensitively: vault first, canonical spelling for enum keys', () => {
    const merged = mergeSuggestionItems(
      [{ value: 'Strength', label: 'Strength' }, { value: 'Rowing', label: 'Rowing' }],
      canonicalSuggestionItems(EFFORT_DISCIPLINES),
    );
    expect(merged.map((item) => item.value)).toEqual([
      'strength',
      'rowing',
      ...EFFORT_DISCIPLINES.filter((d) => d !== 'strength' && d !== 'rowing'),
    ]);
    expect(merged.filter((item) => item.value === 'rowing').length).toBe(1);
  });
});

it('offers catalog slugs rather than imported note UUIDs', () => {
  expect(catalogIdsFromBlocks([{
    id: '1c36bebe-022d-5743-8d50-7ed2be4f1840:s',
    noteId: '1c36bebe-022d-5743-8d50-7ed2be4f1840',
    blockId: 's',
    blockVersion: 1,
    sourceRevision: 1,
    from: 0,
    to: '```time\n21 Pullups\n```'.length,
    dataType: 'wod',
    rawContent: '```time\n21 Pullups\n```',
    noteTitle: 'Fran',
    createdAt: 0,
    sourceId: 'collection:crossfit-girls/fran',
  }])).toEqual(['crossfit-girls']);
});
