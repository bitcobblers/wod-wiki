/**
 * Reference resolution behavior — public parser/resolver seam.
 *
 * Covers the accepted effort/equipment correction end to end:
 * exact equipment-prefix split, explicit JSON refs, ambiguity/unknown
 * diagnostics, note defaults exclusions, and stored-output round-trip.
 */
import { describe, expect, it } from 'vitest';
import {
  createReferenceIndex,
  extractStatementRefs,
  type IEffort,
  type IEquipment,
} from '../../src/effort-registry';
import { parseScript } from '../../src/parser/parseScript';
import { getReferenceMetadata, MetricType } from '@bitcobblers/wod-wiki-core';

const efforts: IEffort[] = [
  {
    id: 'e1', slug: 'snatch', label: 'Snatch', aliases: [],
    baseAttributes: { met: 6 }, registrySource: 'bundled',
    equipment: ['dumbbell'],
  },
  {
    id: 'e2', slug: 'clean', label: 'Clean', aliases: [],
    baseAttributes: { met: 5 }, registrySource: 'bundled',
  },
  {
    id: 'e3', slug: 'dumbbell-snatch', label: 'Dumbbell Snatch', aliases: [],
    baseAttributes: { met: 6 }, registrySource: 'bundled',
  },
  {
    id: 'e4', slug: 'press-a', label: 'Press', aliases: ['press'],
    baseAttributes: { met: 4 }, registrySource: 'bundled',
  },
  {
    id: 'e5', slug: 'press-b', label: 'Bench Press', aliases: ['press'],
    baseAttributes: { met: 4 }, registrySource: 'bundled',
  },
  {
    id: 'e6', slug: 'kettlebell-swings', label: 'Kettlebell Swings', aliases: ['swings'],
    baseAttributes: { met: 8.5 }, registrySource: 'bundled',
    equipment: ['kettlebell'],
  },
];

const equipment: IEquipment[] = [
  {
    id: 'q1', slug: 'dumbbell', label: 'Dumbbell', aliases: ['DB'],
    registrySource: 'bundled',
  },
  {
    id: 'q2', slug: 'barbell', label: 'Barbell', aliases: [],
    registrySource: 'bundled',
  },
  {
    id: 'q3', slug: 'kettlebell', label: 'Kettlebell', aliases: ['kb', 'kettlebells'],
    registrySource: 'bundled',
  },
];

function index() {
  return createReferenceIndex({ efforts, equipment });
}

function parse(text: string, overrides?: { defaults?: { effort?: string; equipment?: string[] } }) {
  return parseScript(text, { references: index(), defaults: overrides?.defaults });
}

describe('reference resolver (exact index)', () => {
  it('flags an equipment alias as equipment, without a hash', () => {
    const resolved = index().resolve('KB swings');
    expect(resolved.matched).toBe('split');
    expect(resolved.equipment.map(ref => ref.slug)).toEqual(['kettlebell']);
    expect(resolved.diagnostics).toEqual([]);
  });

  it('resolves an equipment prefix and the movement after it', () => {
    // `KB Snatch` — the kettlebell, and the snatch.
    const statement = parse('KB Snatch').statements[0];
    const effort = statement.getMetric(MetricType.Effort);
    const equipment = statement.getMetric(MetricType.Equipment);

    expect(effort?.value).toBe('snatch');
    expect(equipment?.value).toEqual(['kettlebell']);
  });

  it('marks the equipment token, not the whole phrase', () => {
    const statement = parse('KB swings').statements[0];
    const equipment = statement.getMetric(MetricType.Equipment);
    const effort = statement.getMetric(MetricType.Effort);
    // The equipment is `KB`; the effort is `swings`. Their marks must not
    // cover each other.
    expect(statement.metricMeta.get(equipment!)?.raw).toBe('KB');
    expect(statement.metricMeta.get(effort!)?.raw).toBe('KB swings');
  });

  it('splits an exact equipment prefix + remaining effort even when the whole phrase is also a record', () => {
    const resolved = index().resolve('Dumbbell Snatch');
    expect(resolved.matched).toBe('split');
    expect(resolved.effortRef?.slug).toBe('snatch');
    expect(resolved.remaining).toBe('Snatch');
    expect(resolved.equipment.map(ref => ref.slug)).toEqual(['dumbbell']);
    expect(resolved.diagnostics).toEqual([]);
  });

  it('keeps authored source and diagnostics on unknown labels without fallback', () => {
    const resolved = index().resolve('Frobnicator');
    expect(resolved.matched).toBe('none');
    expect(resolved.effort).toBeNull();
    expect(resolved.diagnostics.map(d => d.reason)).toEqual(['unknown-effort']);
    expect(resolved.label).toBe('Frobnicator');
  });

  it('reports alias ambiguity and never falls through to defaults', () => {
    const resolved = index().resolve('Press', { effort: 'snatch' });
    expect(resolved.effort).toBeNull();
    expect(resolved.diagnostics[0]?.reason).toBe('ambiguous-effort');
    expect(resolved.diagnostics[0]?.candidates?.sort()).toEqual(['press-a', 'press-b']);
  });

  it('explicit JSON refs win and unknown explicit values never fall back', () => {
    const good = index().resolve('{"effort":"snatch","equipment":["db","dumbbell"]}');
    expect(good.matched).toBe('explicit');
    expect(good.effortRef?.slug).toBe('snatch');
    expect(good.equipment.map(ref => ref.slug)).toEqual(['dumbbell']);

    const bad = index().resolve('{"effort":"nope","equipment":["barbell"]}');
    expect(bad.matched).toBe('explicit');
    expect(bad.effort).toBeNull();
    expect(bad.diagnostics.map(d => d.reason)).toEqual(['invalid-explicit']);

    const malformed = index().resolve('{"effort":');
    expect(malformed.diagnostics.map(d => d.reason)).toEqual(['malformed-json']);
  });

  it('flags explicit equipment contradicting the effort definition equipment', () => {
    const resolved = index().resolve('{"effort":"snatch","equipment":["barbell"]}');
    expect(resolved.equipment.map(ref => ref.slug)).toEqual(['barbell']);
    expect(resolved.diagnostics.map(d => d.reason)).toContain('conflict');
  });

  it('fills note defaults only for an entirely missing movement', () => {
    const filled = index().resolve('', { effort: 'snatch', equipment: ['dumbbell'] });
    expect(filled.matched).toBe('default');
    expect(filled.effortRef?.slug).toBe('snatch');
    expect(filled.equipment.map(ref => ref.slug)).toEqual(['dumbbell']);

    // A named-but-unknown movement stays unknown — defaults never mask it.
    const unknown = index().resolve('Blorps', { effort: 'snatch' });
    expect(unknown.matched).toBe('none');
    expect(unknown.diagnostics.map(d => d.reason)).toEqual(['unknown-effort']);
  });

  it('ranks note defaults above effort-definition equipment', () => {
    const resolved = index().resolve('Clean', { equipment: ['barbell'] });
    expect(resolved.effortRef?.slug).toBe('clean');
    expect(resolved.equipment.map(ref => ref.slug)).toEqual(['barbell']);
  });
  it('resolves slug and alias collisions deterministically across tiers (core < community < imported < user)', () => {
    const tieredIndex = createReferenceIndex({
      efforts: [
        {
          id: 'core-snatch', slug: 'snatch', label: 'Snatch', aliases: ['dumbbell snatch'],
          baseAttributes: { met: 6 }, registrySource: 'bundled', sourceId: 'core',
        },
        {
          id: 'comm-db-snatch', slug: 'dumbbell-snatch', label: 'Dumbbell Snatch', aliases: ['db snatch'],
          baseAttributes: { met: 8 }, registrySource: 'bundled', sourceId: 'community',
        },
        {
          id: 'imp-db-snatch', slug: 'imported-db-snatch', label: 'Imported DB Snatch', aliases: ['db snatch'],
          baseAttributes: { met: 9 }, registrySource: 'bundled', sourceId: 'custom-pack',
        },
        {
          id: 'user-snatch', slug: 'snatch-custom', label: 'My Snatch', aliases: ['db snatch'],
          baseAttributes: { met: 10 }, registrySource: 'user',
        },
      ],
      equipment: [],
    });

    // Community label 'Dumbbell Snatch' overrides core alias 'dumbbell snatch' (community > core).
    expect(tieredIndex.resolveEffort('Dumbbell Snatch')?.slug).toBe('dumbbell-snatch');
    expect(tieredIndex.resolve('Dumbbell Snatch').effortRef?.slug).toBe('dumbbell-snatch');

    // User alias 'db snatch' overrides imported and community aliases (user > imported > community).
    expect(tieredIndex.resolveEffort('db snatch')?.slug).toBe('snatch-custom');
  });
});

describe('parser reference metrics', () => {
  it('parses 10 Dumbbell Snatch @15kg into canonical rep/effort/equipment/resistance', () => {
    const script = parse('10 Dumbbell Snatch @15kg');
    const statement = script.statements[0];
    const effortMetric = statement.getMetric(MetricType.Effort);
    const equipmentMetric = statement.getMetric(MetricType.Equipment);

    expect(effortMetric?.value).toBe('snatch');
    expect(effortMetric?.image).toBe('Dumbbell Snatch');
    const reference = getReferenceMetadata(effortMetric?.metadata);
    expect(reference?.matched).toBe('split');
    expect(reference?.source).toBe('Dumbbell Snatch');
    expect(reference?.remaining).toBe('Snatch');

    expect(equipmentMetric?.value).toEqual(['dumbbell']);
    expect(getReferenceMetadata(equipmentMetric?.metadata)?.refs?.[0]).toEqual(
      { kind: 'equipment', slug: 'dumbbell', label: 'Dumbbell' },
    );

    const resistance = statement.getMetric(MetricType.Resistance);
    expect(resistance?.value).toMatchObject({ amount: 15, unit: 'kg' });

    // Authored line is untouched.
    expect(statement.raw).toBe('10 Dumbbell Snatch @15kg');
  });

  it('keeps explicit JSON overrides and dedupes ordered equipment arrays', () => {
    const script = parse('10 {"effort":"snatch","equipment":["db","dumbbell"]}');
    const statement = script.statements[0];
    expect(statement.getMetric(MetricType.Effort)?.value).toBe('snatch');
    expect(statement.getMetric(MetricType.Equipment)?.value).toEqual(['dumbbell']);
  });

  it('surfaces malformed explicit refs as visible diagnostics, not silent properties', () => {
    const script = parse('10 {"effort":"nope"}');
    const statement = script.statements[0];
    const reference = getReferenceMetadata(statement.getMetric(MetricType.Effort)?.metadata);
    expect(reference?.diagnostics?.map(d => d.reason)).toEqual(['invalid-explicit']);
    expect(statement.raw).toContain('"effort":"nope"');
  });

  it('applies note defaults only to leaf exercise lines missing a movement', () => {
    const defaults = { effort: 'snatch', equipment: ['dumbbell'] };

    const filled = parse('3 reps @60kg', { defaults }).statements[0];
    expect(filled.getMetric(MetricType.Effort)?.value).toBe('snatch');
    expect(filled.getMetric(MetricType.Equipment)?.value).toEqual(['dumbbell']);

    // Timer-only (rest) line: no default effort, no default equipment.
    const rest = parse('1:00', { defaults }).statements[0];
    expect(rest.hasMetric(MetricType.Effort)).toBe(false);
    expect(rest.hasMetric(MetricType.Equipment)).toBe(false);

    // Group heading: never receives defaults.
    const heading = parse('### Group A\n3 reps @60kg', { defaults });
    const headingStatement = heading.statements.find(s => s.text?.startsWith('###'));
    expect(headingStatement?.hasMetric(MetricType.Effort)).toBe(false);

    // Structural rest keyword is left authored — never resolved, never defaulted.
    const restLine = parse('Rest 1:00', { defaults }).statements[0];
    expect(restLine.getMetric(MetricType.Effort)?.value).toBe('Rest');
    expect(restLine.getMetric(MetricType.Equipment)).toBeUndefined();
  });

  it('survives the stored-logs JSON round-trip with canonical refs intact', () => {
    const script = parse('10 Dumbbell Snatch @15kg');
    const reloaded = JSON.parse(JSON.stringify(script.statements[0].metrics.toArray()));
    const effortMetric = reloaded.find((m: { type: string }) => m.type === MetricType.Effort);
    const equipmentMetric = reloaded.find((m: { type: string }) => m.type === MetricType.Equipment);

    expect(effortMetric.value).toBe('snatch');
    expect(effortMetric.image).toBe('Dumbbell Snatch');
    expect(getReferenceMetadata(equipmentMetric.metadata)?.refs).toEqual([
      { kind: 'equipment', slug: 'dumbbell', label: 'Dumbbell' },
    ]);
  });

  it('projects only validated canonical refs for indices', () => {
    const parsed = parse('10 Dumbbell Snatch @15kg\n10 Frobnicator');
    const refs = extractStatementRefs(parsed.statements);
    expect(refs.efforts).toEqual(['snatch']);
    expect(refs.equipment).toEqual(['dumbbell']);
  });
});
