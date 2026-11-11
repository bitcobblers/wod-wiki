import { describe, expect, it } from 'bun:test';
import type { Tag } from '@bitcobblers/wod-wiki-core';
import type { IEffort, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { extractLiveNoteFacets, type LiveFacetCatalog } from './useLiveNoteFacets';

function makeCatalog(): LiveFacetCatalog {
  const efforts: IEffort[] = [
    {
      id: 'effort-thruster',
      slug: 'thruster',
      label: 'Thruster',
      aliases: ['thrusters'],
      baseAttributes: { met: 8 },
      registrySource: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'effort-pull-up',
      slug: 'pull-up',
      label: 'Pull-Up',
      aliases: ['pull-ups', 'pullups'],
      baseAttributes: { met: 8 },
      registrySource: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const equipment: IEquipment[] = [
    {
      id: 'eq-kettlebell',
      slug: 'kettlebell',
      label: 'Kettlebell',
      aliases: ['kb'],
      registrySource: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'eq-barbell',
      slug: 'barbell',
      label: 'Barbell',
      aliases: [],
      registrySource: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const tags: Tag[] = [
    { id: 't-benchmark', label: 'benchmark', type: 'workout-type', createdAt: 1 },
    { id: 't-heavy', label: 'heavy', createdAt: 1 },
  ];

  return {
    efforts,
    equipment,
    tags,
    tagTypes: ['workout-type', 'discipline', 'equipment', 'effort'],
  };
}

describe('extractLiveNoteFacets', () => {
  it('extracts recognized tags, efforts, and equipment from frontmatter, prose #tags, and wod blocks', () => {
    const raw = [
      '---',
      'tags: [benchmark]',
      'equipment: [barbell]',
      '---',
      '# Fran Session #heavy',
      '',
      '```wod',
      '21-15-9',
      '  Thrusters 95 lb',
      '  Pull-ups',
      '```',
    ].join('\n');

    const facets = extractLiveNoteFacets(raw, makeCatalog());
    expect(facets.tags).toEqual([
      { slug: 'benchmark', label: 'benchmark', type: 'workout-type' },
      { slug: 'heavy', label: 'heavy', type: 'general' },
    ]);
    expect(facets.efforts.map((e) => e.slug)).toEqual(['thruster', 'pull-up']);
    expect(facets.equipment.map((eq) => eq.slug)).toEqual(['barbell']);
    expect(facets.unrecognized).toEqual([]);
  });

  it('merges effort-typed and equipment-typed frontmatter tags into Efforts and Equipment without duplicating into Tags', () => {
    const raw = [
      '---',
      'effort: [thruster]',
      'equipment: [kettlebell]',
      '---',
      '# Prep',
    ].join('\n');

    const facets = extractLiveNoteFacets(raw, makeCatalog());
    expect(facets.tags).toEqual([]);
    expect(facets.efforts).toEqual([{ slug: 'thruster', label: 'Thruster' }]);
    expect(facets.equipment).toEqual([{ slug: 'kettlebell', label: 'Kettlebell' }]);
  });

  it('splits known equipment prefix from an unrecognized movement remainder and flags unrecognized #tags', () => {
    const raw = [
      '# Accessory Work #hyroxprep',
      '',
      '```wod',
      '3 rounds',
      '  12 Kettlebell Zottman Curl',
      '```',
    ].join('\n');

    const facets = extractLiveNoteFacets(raw, makeCatalog());
    expect(facets.equipment).toEqual([{ slug: 'kettlebell', label: 'Kettlebell' }]);
    expect(facets.unrecognized).toEqual([
      {
        rawLabel: 'hyroxprep',
        candidateSlug: 'hyroxprep',
        suggestedKind: 'tag',
      },
      {
        rawLabel: 'Zottman Curl',
        candidateSlug: 'zottman-curl',
        suggestedKind: 'effort',
      },
    ]);
  });
});
