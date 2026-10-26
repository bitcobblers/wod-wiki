import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { migrateMarkdownContent } from './migrate-seed-markdown';

test('flattens baseAttributes into Property Note keys and prepends type: effort', () => {
  const before = [
    '---',
    'id: effort-bundled-thruster',
    'slug: thruster',
    'label: Thruster',
    'aliases:',
    '  - thrusters',
    'baseAttributes:',
    '  met: 8.0',
    '  discipline: strength',
    '  intensityTier: high',
    'equipment:',
    '  - barbell',
    'registrySource: bundled',
    '---',
    'Markdown body goes here.',
  ].join('\n');

  const after = migrateMarkdownContent(before, 'markdown/efforts/strength/thruster.md');

  const expected = [
    '---',
    'type: effort',
    'id: effort-bundled-thruster',
    'slug: thruster',
    'label: Thruster',
    'aliases:',
    '  - thrusters',
    'metrics.met: 8.0',
    'discipline: strength',
    'intensityTier: high',
    'equipment:',
    '  - barbell',
    'registrySource: bundled',
    '---',
    'Markdown body goes here.',
  ].join('\n');

  assert.equal(after, expected);
});

test('handles disciplineFactor and replaces non-canonical weightlifting with strength', () => {
  const before = [
    '---',
    'id: effort-snatch',
    'slug: snatch',
    'label: Snatch',
    'baseAttributes:',
    '  met: 6.0',
    '  disciplineFactor: 1.1',
    '  discipline: weightlifting',
    '  intensityTier: high',
    '---',
  ].join('\n');

  const after = migrateMarkdownContent(before, 'markdown/efforts/strength/snatch.md');

  assert.match(after, /^type: effort/m);
  assert.match(after, /^metrics\.met: 6\.0/m);
  assert.match(after, /^metrics\.disciplineFactor: 1\.1/m);
  assert.match(after, /^discipline: strength/m);
  assert.doesNotMatch(after, /weightlifting/);
  assert.doesNotMatch(after, /baseAttributes:/);
});

test('is idempotent when run on already-migrated markdown', () => {
  const migrated = [
    '---',
    'type: effort',
    'id: effort-bundled-thruster',
    'slug: thruster',
    'label: Thruster',
    'metrics.met: 8.0',
    'discipline: strength',
    'intensityTier: high',
    'equipment:',
    '  - barbell',
    '---',
    'Body unchanged.',
  ].join('\n');

  const reRun = migrateMarkdownContent(migrated, 'markdown/efforts/strength/thruster.md');
  assert.equal(reRun, migrated);
});

test('leaves non-effort files and files without frontmatter untouched', () => {
  const noFm = '# Just a markdown note\nWithout frontmatter.';
  assert.equal(migrateMarkdownContent(noFm, 'markdown/notes/test.md'), noFm);

  const eq = [
    '---',
    'type: equipment',
    'id: equipment-barbell',
    'slug: barbell',
    'label: Barbell',
    '---',
    'Barbell description.',
  ].join('\n');
  assert.equal(migrateMarkdownContent(eq, 'markdown/equipment/barbell.md'), eq);
});
