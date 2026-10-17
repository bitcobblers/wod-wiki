import { describe, it, expect } from 'vitest';
import {
  parseEffortFile,
  parseEquipmentFile,
  effortToDocument,
  documentToEffort,
} from '../../src/effort-registry/definition-markdown';
import { patchFrontmatterProperty } from '@bitcobblers/wod-wiki-core';
import type { IEffort } from '../../src/effort-registry/types';

/**
 * Consumer behavior for the shared definition format: a full effort document
 * (nested baseAttributes, hints, derivation, equipment, comments, body)
 * survives parse → single-property patch → re-parse without data loss, the
 * patch changes exactly the target property's source range (single CodeMirror
 * undo step), and the conversion direction rejects malformed drafts instead of
 * silently corrupting them.
 */
const DOC = [
  '---',
  'id: effort-bundled-dumbbell-snatch',
  'slug: dumbbell-snatch',
  'label: Dumbbell Snatch',
  '# identity block comment',
  'aliases:',
  '  - db snatch',
  'type: effort',
  'baseAttributes:',
  '  met: 6.0',
  '  discipline: strength',
  '  intensityTier: high',
  'registrySource: bundled',
  'equipment:',
  '  - dumbbell',
  'hints:',
  '  restSeconds: 90',
  'derivation:',
  '  parentSlug: snatch',
  '  coefficients:',
  '    met: 1.1',
  '  hardOverrides:',
  '    intensityTier: high',
  'custom-note: keep me',
  'tags:',
  '  - posterior',
  '  - pull',
  '---',
  '',
  '# Dumbbell Snatch',
  '',
  'Full-body power move.',
].join('\n');

const DERIVATION = {
  parentSlug: 'snatch',
  coefficients: { met: 1.1 },
  hardOverrides: { intensityTier: 'high' },
};

const FULL_EFFORT: IEffort = {
  id: 'effort-user-test',
  slug: 'running',
  label: 'Running',
  aliases: ['jogging', 'sprint'],
  baseAttributes: { met: 5.0, discipline: 'running', intensityTier: 'moderate' },
  registrySource: 'user',
  derivation: {
    parentSlug: 'base-running',
    coefficients: { met: 1.1 },
    hardOverrides: { label: 'Fast Running' },
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-06-01T00:00:00.000Z',
};

describe('definition-markdown source preservation', () => {
  it('parses the nested definition shape', () => {
    const effort = parseEffortFile(DOC);
    expect(effort).not.toBeNull();
    expect(effort!.baseAttributes).toEqual({ met: 6, discipline: 'strength', intensityTier: 'high' });
    expect(effort!.hints).toEqual({ restSeconds: 90 });
    expect(effort!.derivation).toEqual(DERIVATION);
    expect(effort!.equipment).toEqual(['dumbbell']);
    expect(effort!.aliases).toEqual(['db snatch']);
    expect(effort!.body).toBe('# Dumbbell Snatch\n\nFull-body power move.');
  });

  it('preserves a nested disciplineFactor', () => {
    const withFactor = DOC.replace('  intensityTier: high', '  intensityTier: high\n  disciplineFactor: 1.2');
    const parsed = parseEffortFile(withFactor);
    expect(parsed!.baseAttributes.disciplineFactor).toBe(1.2);
    const roundTrip = documentToEffort(effortToDocument(parsed!));
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.effort.baseAttributes.disciplineFactor).toBe(1.2);
  });

  it('patches nested MET as the only source change and keeps everything else', () => {
    const patched = patchFrontmatterProperty(DOC, ['baseAttributes', 'met'], 7.5);

    const oldLines = DOC.split('\n');
    const newLines = patched.split('\n');
    expect(newLines.length).toBe(oldLines.length);
    const changed = oldLines
      .map((line, i) => ({ line, i, next: newLines[i] }))
      .filter((c) => c.next !== c.line);
    expect(changed).toEqual([{ line: '  met: 6.0', i: DOC.split('\n').indexOf('  met: 6.0'), next: '  met: 7.5' }]);

    // Untouched bytes: comments, unknown fields, nested blocks, body.
    expect(patched).toContain('# identity block comment');
    expect(patched).toContain('custom-note: keep me');
    expect(patched).toContain('    met: 1.1');
    expect(patched.endsWith('# Dumbbell Snatch\n\nFull-body power move.')).toBe(true);

    const reparsed = parseEffortFile(patched)!;
    expect(reparsed.baseAttributes).toEqual({ met: 7.5, discipline: 'strength', intensityTier: 'high' });
    expect(reparsed.hints).toEqual({ restSeconds: 90 });
    expect(reparsed.derivation).toEqual(DERIVATION);
    expect(reparsed.equipment).toEqual(['dumbbell']);
    expect(reparsed.body).toBe('# Dumbbell Snatch\n\nFull-body power move.');
  });

  it('re-patching with the same value is a byte-level no-op (undo-safe)', () => {
    const once = patchFrontmatterProperty(DOC, ['baseAttributes', 'met'], 7.5);
    expect(patchFrontmatterProperty(once, ['baseAttributes', 'met'], 7.5)).toBe(once);
  });

  it('carries a safe inline comment on an edited scalar', () => {
    const commented = DOC.replace('  met: 6.0', '  met: 6.0 # metabolic ceiling');
    const patched = patchFrontmatterProperty(commented, ['baseAttributes', 'met'], 7.5);
    expect(patched).toContain('  met: 7.5 # metabolic ceiling');
  });

  it('serializes empty arrays as [] so they parse back as cleared, not malformed', () => {
    const cleared = patchFrontmatterProperty(DOC, ['equipment'], []);
    expect(cleared).toContain('equipment: []');
    const parsed = parseEffortFile(cleared);
    expect(parsed).not.toBeNull();
    expect(parsed!.equipment).toBeUndefined();
  });

  it('keeps multiline values on a single escaped source line', () => {
    const patched = patchFrontmatterProperty(DOC, ['label'], 'Snatch\nDay');
    expect(patched.split('\n').length).toBe(DOC.split('\n').length);
    expect(patched).toContain('label: "Snatch\\nDay"');
    expect(documentToEffort(patched).effort.label).toBe('Snatch\nDay');
  });

  it('removal deletes exactly the property range and keeps adjacent comments', () => {
    const small = ['---', 'equipment:', '  - dumbbell', '# keep', 'label: Snatch', '---', 'Body'].join('\n');
    const replaced = patchFrontmatterProperty(small, ['equipment'], ['barbell']);
    expect(replaced).toBe(['---', 'equipment:', '  - barbell', '# keep', 'label: Snatch', '---', 'Body'].join('\n'));

    const removed = patchFrontmatterProperty(DOC, ['baseAttributes', 'met'], null);
    expect(removed).not.toMatch(/^ {2}met:/m);
    expect(removed).toContain('  discipline: strength');
    expect(removed).toContain('    met: 1.1'); // derivation.coefficients untouched
    expect(parseEffortFile(removed)).toBeNull(); // met is required — never fabricated

    const noTags = patchFrontmatterProperty(DOC, ['tags'], null);
    expect(noTags).not.toContain('posterior');
    expect(noTags).toContain('custom-note: keep me');
    expect(noTags).toContain('# identity block comment');
  });

  it('inserts flat dotted keys literally and missing nested chains', () => {
    const withDefaults = patchFrontmatterProperty(DOC, ['metrics.equipment'], ['barbell', 'dumbbell']);
    expect(withDefaults).toContain('metrics.equipment:');
    expect(withDefaults).toContain('  - barbell');
    // The dotted key is literal — the nested walker still finds baseAttributes.
    const bumped = patchFrontmatterProperty(withDefaults, ['baseAttributes', 'met'], 8);
    expect(bumped).toContain('  met: 8');
    expect(bumped).toContain('metrics.equipment:');

    const withEffortDefault = patchFrontmatterProperty(DOC, ['metrics.effort'], 'snatch');
    expect(withEffortDefault).toContain('metrics.effort: snatch');

    const fresh = patchFrontmatterProperty('no frontmatter body', ['title'], 'Snatch Day');
    expect(fresh).toBe('---\ntitle: Snatch Day\n---\nno frontmatter body');
  });

  it('preserves CRLF line endings outside the patched value', () => {
    const crlf = DOC.replace(/\n/g, '\r\n');
    const patched = patchFrontmatterProperty(crlf, ['baseAttributes', 'met'], 7.5);
    expect(patched.includes('\r\n')).toBe(true);
    expect(patched.replace(/\r\n/g, '\n')).toBe(patchFrontmatterProperty(DOC, ['baseAttributes', 'met'], 7.5));
  });
});

describe('definition-markdown validation', () => {
  it('rejects met values that are not finite positive numbers', () => {
    for (const met of ['Infinity', '-1', '0', 'abc']) {
      const doc = DOC.replace('  met: 6.0', `  met: ${met}`);
      expect(parseEffortFile(doc)).toBeNull();
      expect(documentToEffort(doc).errors.join('\n')).toContain('baseAttributes.met');
    }
  });

  it('rejects invalid identity in both parsers', () => {
    expect(parseEffortFile(DOC.replace('slug: dumbbell-snatch', 'slug: Bad Slug!'))).toBeNull();
    expect(parseEffortFile(DOC.replace('label: Dumbbell Snatch', 'label: ""'))).toBeNull();
    expect(parseEffortFile(DOC.replace('slug: dumbbell-snatch', ''))).toBeNull();

    const eq = ['---', 'id: e1', 'slug: dumbbell', 'label: Dumbbell', 'type: equipment', 'aliases: []', '---'].join('\n');
    expect(parseEquipmentFile(eq)).not.toBeNull();
    expect(parseEquipmentFile(eq.replace('slug: dumbbell', 'slug: Dumbbell!'))).toBeNull();
    expect(parseEquipmentFile(eq.replace('label: Dumbbell', 'label: ""'))).toBeNull();
  });

  it('rejects blank, duplicate, or non-canonical list entries instead of emptying them', () => {
    expect(parseEffortFile(DOC.replace('  - dumbbell', '  - dumbbell\n  - dumbbell'))).toBeNull();
    expect(parseEffortFile(DOC.replace('  - dumbbell', '  - Dumbbell Bar'))).toBeNull();
    expect(parseEffortFile(DOC.replace('  - dumbbell', '  - ""'))).toBeNull();
    expect(parseEffortFile(DOC.replace('  - db snatch', '  - db snatch\n  - db snatch'))).toBeNull();
    // Malformed scalar forms are rejected, never silently emptied.
    expect(parseEffortFile(DOC.replace('equipment:\n  - dumbbell', 'equipment: dumbbell'))).toBeNull();
    expect(parseEffortFile(DOC.replace('aliases:\n  - db snatch', 'aliases: db snatch'))).toBeNull();
    const converted = documentToEffort(DOC.replace('  - dumbbell', '  - dumbbell\n  - dumbbell'));
    expect(converted.errors.join('\n')).toContain('equipment');
  });

  it('routes equipment definitions to parseEquipmentFile and never parses them as efforts', () => {
    const EQUIPMENT_DOC = [
      '---',
      'id: eq-dumbbell',
      'slug: dumbbell',
      'label: Dumbbell',
      'type: equipment',
      'aliases:',
      '  - dbs',
      '---',
      '',
      'Handle with care.',
    ].join('\n');

    expect(parseEquipmentFile(EQUIPMENT_DOC)).toEqual({
      id: 'eq-dumbbell',
      slug: 'dumbbell',
      label: 'Dumbbell',
      aliases: ['dbs'],
      registrySource: 'bundled',
      body: 'Handle with care.',
    });
    expect(parseEffortFile(EQUIPMENT_DOC)).toBeNull();
    expect(parseEquipmentFile(DOC)).toBeNull();
  });
});

describe('effort document conversion', () => {
  it('round-trips a full effort', () => {
    const doc = effortToDocument(FULL_EFFORT);
    const { effort, errors } = documentToEffort(doc);
    expect(errors).toEqual([]);
    expect(effort).toEqual(FULL_EFFORT);
  });

  it('round-trips a minimal effort', () => {
    const minimal: IEffort = {
      id: 'effort-user-min',
      slug: 'push-ups',
      label: 'Push-ups',
      aliases: [],
      baseAttributes: { met: 3.8 },
      registrySource: 'user',
    };
    const doc = effortToDocument(minimal);
    const { effort, errors } = documentToEffort(doc);
    expect(errors).toEqual([]);
    expect(effort).toEqual(minimal);
  });

  it('uses fallback for missing frontmatter', () => {
    const { effort, errors } = documentToEffort('no frontmatter here', FULL_EFFORT);
    expect(errors.length).toBeGreaterThan(0);
    expect(effort.id).toBe(FULL_EFFORT.id);
  });

  it('quotes strings with special characters', () => {
    const effort: IEffort = { ...FULL_EFFORT, label: 'Run: Fast!', aliases: ['run: fast'] };
    const doc = effortToDocument(effort);
    expect(doc).toContain('label: "Run: Fast!"');
    expect(doc).toContain('- "run: fast"');
    const { effort: parsed, errors } = documentToEffort(doc);
    expect(errors).toEqual([]);
    expect(parsed.label).toBe('Run: Fast!');
    expect(parsed.aliases).toContain('run: fast');
  });

  it('normalizes empty aliases to []', () => {
    const doc = effortToDocument({ ...FULL_EFFORT, aliases: [] });
    expect(doc).toContain('aliases: []');
    const { effort: parsed, errors } = documentToEffort(doc);
    expect(errors).toEqual([]);
    expect(parsed.aliases).toEqual([]);
  });

  it('round-trips body text and omits an undefined body', () => {
    const doc = effortToDocument({ ...FULL_EFFORT, body: 'Great for cardio.\n\nStart slow and build up.' });
    expect(doc).toContain('---\n\nGreat for cardio.');
    const { effort: parsed, errors } = documentToEffort(doc);
    expect(errors).toEqual([]);
    expect(parsed.body).toBe('Great for cardio.\n\nStart slow and build up.');

    const bodyless = effortToDocument(FULL_EFFORT);
    const lines = bodyless.split('\n');
    expect(lines.slice(lines.lastIndexOf('---') + 1).join('\n').trim()).toBe('');
    const { effort: noBody } = documentToEffort(bodyless);
    expect(noBody.body).toBeUndefined();
  });

  it('names baseAttributes.met for missing or misplaced met and keeps the edit fallback', () => {
    const missing = documentToEffort('---\nslug: run\nlabel: Run\n---\n');
    expect(missing.errors.join('\n')).toContain('baseAttributes.met');
    expect(missing.effort.baseAttributes.met).toBeUndefined();

    const misplacedDoc = '---\nslug: run\nlabel: Run\nmet: 5\n---\n';
    expect(documentToEffort(misplacedDoc).errors.join('\n')).toContain('baseAttributes.met');
    expect(documentToEffort(misplacedDoc, FULL_EFFORT).errors.join('\n')).toContain('baseAttributes.met');

    const nested = documentToEffort('---\nslug: run\nlabel: Run\nbaseAttributes:\n  met: 5\n---\n');
    expect(nested.errors).toEqual([]);
    expect(nested.effort.baseAttributes.met).toBe(5);

    const edited = documentToEffort('---\nslug: run\nlabel: Run\n---\n', FULL_EFFORT);
    expect(edited.errors).toEqual([]);
    expect(edited.effort.baseAttributes.met).toBe(FULL_EFFORT.baseAttributes.met);
  });

  it('rejects a non-finite met arriving via the edit fallback', () => {
    const bad: IEffort = { ...FULL_EFFORT, baseAttributes: { ...FULL_EFFORT.baseAttributes, met: Infinity } };
    const { errors } = documentToEffort('---\nslug: run\nlabel: Run\n---\n', bad);
    expect(errors.join('\n')).toContain('baseAttributes.met');
  });

  it('equipment: explicit [] clears, absence falls back, entries validate', () => {
    const withEquipment: IEffort = { ...FULL_EFFORT, equipment: ['dumbbell', 'bench'] };

    // Removing the lines alone is not enough — the base effort still supplies them.
    const docOnly = '---\nslug: run\nlabel: Run\nbaseAttributes:\n  met: 5\n---\n';
    expect(documentToEffort(docOnly, withEquipment).effort.equipment).toEqual(['dumbbell', 'bench']);

    // Explicit [] clears the relation (removal is expressible in source).
    const cleared = documentToEffort(docOnly.replace('met: 5', 'met: 5\nequipment: []'), withEquipment);
    expect(cleared.errors).toEqual([]);
    expect(cleared.effort.equipment).toEqual([]);

    const entryError = documentToEffort(docOnly.replace('met: 5', 'met: 5\nequipment:\n  - Bench Press'), withEquipment);
    expect(entryError.errors.join('\n')).toContain('equipment');
  });

  it('never serializes persistence/ownership fields as YAML and never smuggles unknown fields', () => {
    const owned: IEffort = { ...FULL_EFFORT, ownerNoteId: 'note/1', sourceId: 'seed', sourcePath: 'a/b.md' };
    const doc = effortToDocument(owned);
    expect(doc).not.toMatch(/ownerNoteId|sourceId|sourcePath/);
    const { effort } = documentToEffort(doc);
    expect(effort.ownerNoteId).toBeUndefined();
    expect(effort.sourceId).toBeUndefined();

    // Unknown frontmatter fields stay in the note source, not the projection.
    const withUnknown = `${doc.replace('---\n', '---\ncustom-note: keep me\n')}`;
    const { effort: parsed, errors } = documentToEffort(withUnknown);
    expect(errors).toEqual([]);
    expect(Object.keys(parsed)).not.toContain('custom-note');
  });
});
