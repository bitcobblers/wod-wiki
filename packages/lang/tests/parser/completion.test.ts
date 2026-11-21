import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { LanguageSupport } from '@codemirror/language';
import {
  whiteboardScript,
  whiteboardScriptCompletion,
  whiteboardScriptCompletionSource,
  whiteboardScriptSnippets,
  applyTemplateDefaults,
  whiteboardParser,
} from '../../src/index';
import { UnitRegistry } from '../../src/index';
import type { WhiteboardScriptCompletionOptions } from '../../src/index';

/** Run the standalone-extension completion source at `pos` (default: end of doc). */
async function labels(doc: string, options: WhiteboardScriptCompletionOptions = {}, pos = doc.length): Promise<string[]> {
  const state = EditorState.create({ doc, extensions: whiteboardScript(options) });
  const context = new CompletionContext(state, pos, true);
  const result = await whiteboardScriptCompletionSource(options)(context);
  return result ? result.options.map(option => option.label) : [];
}

describe('whiteboardScriptCompletionSource — syntax slots', () => {
  it('offers all structure snippets and structure keywords on an empty statement', async () => {
    const offered = await labels('');
    for (const snippet of whiteboardScriptSnippets) {
      expect(offered).toContain(snippet.label);
    }
    for (const keyword of ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME', 'Rest']) {
      expect(offered).toContain(keyword);
    }
  });

  it('offers effort keywords after a timer fragment but not structure snippets', async () => {
    const offered = await labels('10:00 AM');
    expect(offered).toContain('AMRAP');
    expect(offered).not.toContain('Ladder');
  });

  it('offers catalog efforts on an empty statement and filters effort slots accurately', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
    };
    expect(await labels('', options)).toContain('Back Squat');
    expect(await labels('10 ', options)).toContain('Back Squat');
    expect(await labels('10 Back', options)).toContain('Back Squat');
    expect(await labels('10 Push', options)).not.toContain('Back Squat');
  });

  it('suppresses a second effort after a completed effort but allows a new statement', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
    };
    expect(await labels('10 Push Ups ', options)).not.toContain('Back Squat');
    expect(await labels('10 Push Ups\n', options)).toContain('Back Squat');
  });

  it('keeps effort suggestions in choice and compose slots', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
    };
    expect(await labels('10 Push Ups | ', options)).toContain('Back Squat');
    expect(await labels('+ ', options)).toContain('Back Squat');
  });

  it('suppresses additional values after a singleton property but preserves repeated tags', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Fran' }],
      tags: () => [{ value: 'classic' }, { value: 'loud' }],
    };
    expect(await labels('effort: Fran ', options)).toEqual([]);
    expect(await labels('sound: #classic #', options)).toContain('classic');
    expect(await labels('sound: #classic #', options)).toContain('loud');
  });

  it('does not offer singleton property keys already supplied in the section', async () => {
    const offered = await labels('effort: Fran\nsound: #classic\nsoun');
    expect(offered).not.toContain('effort');
    expect(offered).not.toContain('sound');
    expect(offered).toContain('equipment');
    expect(offered).toContain('Circuit');
  });

  it('uses dialect-extended units on glued numbers and limits resistance quantities to mass', async () => {
    const units = UnitRegistry.standard().extend({ canonical: 'pood', dimension: 'mass', aliases: ['poods'] });
    const offered = await labels('10', { units });
    expect(offered).toContain('pood');
    expect(offered).toContain('poods');

    const resistance = await labels('@100 ', { units });
    expect(resistance).toContain('kg');
    expect(resistance).toContain('pood');
    expect(resistance).not.toContain('km');
    expect(resistance).not.toContain('cal');
    expect(resistance).not.toContain('reps');
    expect(resistance).not.toContain('rounds');
  });

  it('offers no second unit after a number already has one', async () => {
    const offered = await labels('10 kg ', {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
    });
    expect(offered).not.toContain('lb');
    expect(offered).not.toContain('kg');
    expect(offered).toContain('Back Squat');
  });

  it('offers STANDARD_UNITS canonical spellings and aliases when typing a number', async () => {
    const offered = await labels('100');
    expect(offered).toContain('reps');
    expect(offered).toContain('rounds');
    expect(offered).toContain('kg');
    expect(offered).toContain('lbs');
    expect(offered).toContain('mile');
    const kg = offered.indexOf('kg');
    expect(kg).toBeGreaterThanOrEqual(0);
  });

  it('allows units after glued compose quantities but not inside action syntax', async () => {
    expect(await labels('+ 5')).toContain('kg');
    expect(await labels('[10 ')).not.toContain('kg');
  });

  it('keeps multiword effort completion anchored at the effort phrase', async () => {
    const state = EditorState.create({
      doc: '10 Back Sq',
      extensions: whiteboardScript({ efforts: () => [{ value: 'Back Squat' }] }),
    });
    const result = await whiteboardScriptCompletionSource({ efforts: () => [{ value: 'Back Squat' }] })(
      new CompletionContext(state, state.doc.length, true),
    );
    expect(result?.from).toBe('10 '.length);
    expect(result?.options.map(option => option.label)).toContain('Back Squat');
  });

  it('anchors unit options at the partial unit word start', async () => {
    const state = EditorState.create({ doc: '100 kilo', extensions: [whiteboardScript()] });
    const result = await whiteboardScriptCompletionSource()(new CompletionContext(state, state.doc.length, true));
    expect(result?.from).toBe('100 '.length);
    const offered = result ? result.options.map(option => option.label) : [];
    expect(offered).toContain('kg');
    expect(offered).toContain('kilo');
  });

  it('offers no units inside a timer token, but effort keywords after it', async () => {
    expect(await labels('10:0')).toEqual([]);
    const afterTimer = await labels('10:00 ');
    expect(afterTimer).toContain('AMRAP');
    expect(afterTimer).not.toContain('kg');
  });

  it('offers no units while an inline ladder is in progress', async () => {
    expect(await labels('(21-15')).toEqual([]);
  });

  it('offers effort vocabulary but no units after an x/X round scheme', async () => {
    // Cursor past the trailing space: the tree has closed the RoundScheme
    // node, so the suppression is positional (`x`/`X` directly before the
    // number) — `kg`/`lbs` would lex `5x5 kg` as rounds × weight.
    const offered = await labels('5x5 ');
    expect(offered).toContain('AMRAP');
    expect(offered).not.toContain('kg');
    expect(offered).not.toContain('lbs');
    // In-tree: the number is part of an open RoundScheme node.
    expect(await labels('5x5')).not.toContain('kg');
    expect(await labels('3 x 5 ')).not.toContain('kg');
  });

  it('quotes property catalog values the grammar Identifier cannot represent', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'back-squat' }, { value: 'fran' }],
      equipment: () => [{ value: 'pull-up-bar' }],
    };
    const applies = async (doc: string, source: WhiteboardScriptCompletionOptions) =>
      (await whiteboardScriptCompletionSource(source)(new CompletionContext(
        EditorState.create({ doc, extensions: whiteboardScript(source) }), doc.length, true,
      )))?.options.map(option => option.apply);

    // Hyphenated slugs only lex as quoted `String` values.
    expect(await applies('effort: back', options)).toContain('"back-squat"');
    expect(await applies('equipment: pull', options)).toContain('"pull-up-bar"');
    // Ordinary identifiers insert bare.
    expect(await applies('effort: fr', options)).toContain('fran');
  });

  it('offers property keys at an Identifier line start', async () => {
    const offered = await labels('soun');
    expect(offered).toEqual(expect.arrayContaining([
      'effort', 'equipment', 'rpe', 'rir', 'intensity', 'load', 'volume', 'work', 'sound',
    ]));
  });

  it('combines property keys with catalog efforts at a fresh bare word', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Burpee', label: 'Burpee' }],
    };
    const freshWord = await labels('Bur', options);
    expect(freshWord).toContain('Burpee');
    expect(await labels('soun', options)).toContain('sound');
    expect(await labels('circ', options)).toContain('Circuit');
  });

  it('offers catalog values per property key and nothing for numeric properties', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat', detail: 'effort' }],
      equipment: () => [{ value: 'barbell' }],
      sounds: () => [{ value: 'classic', label: 'Classic' }],
    };
    expect(await labels('effort: ', options)).toContain('Back Squat');
    expect(await labels('equipment: ', options)).toContain('barbell');
    expect(await labels('sound: Cla', options)).toContain('Classic');
    expect(await labels('rpe: ', options)).toEqual([]);
  });

  it('offers tag slugs after a # tag reference', async () => {
    const offered = await labels('10 Push Ups #he', { tags: () => [{ value: 'heavy' }] });
    expect(offered).toContain('heavy');
  });

  it('offers tag slugs immediately on bare # inside workout blocks while keeping # Heading suppressed', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      tags: () => [{ value: 'emom' }, { value: 'heavy' }],
    };
    expect(await labels('20 #', options)).toEqual(expect.arrayContaining(['emom', 'heavy']));
    expect(await labels('#', options)).toEqual(expect.arrayContaining(['emom', 'heavy']));
    expect(await labels('# Warmup', options)).toEqual([]);
  });

  it('excludes structure keywords on quantities, boosts preferred units above efforts, and transitions after space', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Kettlebell Swing' }],
      preferredUnits: () => ['lb'],
    };
    const gluedState = EditorState.create({ doc: '20', extensions: whiteboardScript(options) });
    const gluedResult = await whiteboardScriptCompletionSource(options)(
      new CompletionContext(gluedState, gluedState.doc.length, true),
    );
    const gluedOpts = gluedResult?.options ?? [];
    const gluedOffered = gluedOpts.map(o => o.label);
    expect(gluedOffered).not.toContain('AMRAP');
    expect(gluedOffered).not.toContain('EMOM');
    expect(gluedOffered).not.toContain('FOR TIME');
    expect(gluedOffered).toContain('reps');
    expect(gluedOffered).toContain('rounds');
    const lbOpt = gluedOpts.find(o => o.label === 'lb');
    const kgOpt = gluedOpts.find(o => o.label === 'kg');
    const bwOpt = gluedOpts.find(o => o.label === 'bw');
    const secRank = (s: typeof gluedOpts[number]['section']) => (typeof s === 'object' ? (s?.rank ?? 999) : 999);
    expect((lbOpt?.boost ?? 0)).toBeGreaterThan(kgOpt?.boost ?? 0);
    expect((kgOpt?.boost ?? 0)).toBeGreaterThan(bwOpt?.boost ?? 0);

    const spacedState = EditorState.create({ doc: '20 ', extensions: whiteboardScript(options) });
    const spacedResult = await whiteboardScriptCompletionSource(options)(
      new CompletionContext(spacedState, spacedState.doc.length, true),
    );
    const spacedOpts = spacedResult?.options ?? [];
    const spacedOffered = spacedOpts.map(o => o.label);
    expect(spacedOffered).toContain('Kettlebell Swing');
    expect(spacedOffered).not.toContain('kg');
    expect(spacedOffered).not.toContain('lb');
    expect(spacedOffered).not.toContain('reps');
    expect(spacedOffered).not.toContain('rounds');
    expect(secRank(kgOpt?.section)).toBeLessThan(secRank(spacedOpts.find(o => o.label === 'Kettlebell Swing')?.section));
  });

  it('deduplicates EMOM/AMRAP at line start and demotes property keys with trailing colon', async () => {
    const state = EditorState.create({ doc: 'em', extensions: whiteboardScript() });
    const startResult = await whiteboardScriptCompletionSource()(new CompletionContext(state, state.doc.length, true));
    const opts = startResult?.options ?? [];
    expect(opts.filter(o => o.label === 'EMOM')).toHaveLength(1);
    expect(opts.filter(o => o.label === 'AMRAP')).toHaveLength(1);

    const propState = EditorState.create({ doc: 'soun', extensions: whiteboardScript() });
    const propResult = await whiteboardScriptCompletionSource()(new CompletionContext(propState, propState.doc.length, true));
    const soundOpt = propResult?.options.find(o => o.label === 'sound');
    expect(soundOpt?.apply).toBe('sound: ');
    expect((soundOpt?.boost ?? 0)).toBeLessThan(0);
  });

  it('offers inline + Create option for unknown efforts and unknown tags when handlers are provided', async () => {
    let createdEffort = '';
    let createdTag = '';
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat' }],
      tags: () => [{ value: 'heavy' }],
      onCreateEffort: (raw) => { createdEffort = raw; },
      onCreateTag: (slug) => { createdTag = slug; },
    };
    const effortState = EditorState.create({ doc: '10 Cossack Squ', extensions: whiteboardScript(options) });
    const effortRes = await whiteboardScriptCompletionSource(options)(new CompletionContext(effortState, effortState.doc.length, true));
    const createEffort = effortRes?.options.find(o => o.type === 'create');
    expect(createEffort?.displayLabel).toBe('+ Create "Cossack Squ"');
    expect(createdEffort).toBe('');

    const tagState = EditorState.create({ doc: '10 Back Squat #tempo', extensions: whiteboardScript(options) });
    const tagRes = await whiteboardScriptCompletionSource(options)(new CompletionContext(tagState, tagState.doc.length, true));
    const createTag = tagRes?.options.find(o => o.type === 'create');
    expect(createTag?.displayLabel).toBe('+ Create "#tempo"');
    expect(createdTag).toBe('');

    const exactState = EditorState.create({ doc: '10 Back Squat', extensions: whiteboardScript(options) });
    const exactRes = await whiteboardScriptCompletionSource(options)(new CompletionContext(exactState, exactState.doc.length, true));
    expect(exactRes?.options.some(o => o.type === 'create')).toBe(false);
  });

  it('offers action cues on [: prefix', async () => {
    const offered = await labels(':30 Plank [:re');
    expect(offered).toContain('[:rest]');
    expect(offered).toContain('[:done]');
  });

  it('matches catalog efforts by word substring and explicit aliases', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [
        { value: 'Kettlebell Swing', label: 'Kettlebell Swing', aliases: ['swing', 'kbs'] },
        { value: 'Back Squat', label: 'Back Squat', aliases: ['bs'] },
      ],
    };
    expect(await labels('10:00 swing', options)).toContain('Kettlebell Swing');
    expect(await labels('10 kbs', options)).toContain('Kettlebell Swing');
    expect(await labels('kbs', options)).toContain('Kettlebell Swing');
  });

  it('offers syntax-aware reps and rounds on glued numbers, decimals, wildcard, parens, and rep ladders', async () => {
    const withCatalog: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
      equipment: () => [{ value: 'kettlebell', label: 'Kettlebell' }],
    };

    // Glued whole integers offer both `reps` and `rounds` alongside units.
    for (const doc of ['10', '3', '10r']) {
      const offered = await labels(doc, withCatalog);
      expect(offered).toContain('reps');
      expect(offered).toContain('rounds');
    }
    expect(await labels('3ro', withCatalog)).toContain('rounds');

    // Decimals do not offer integer count qualifiers `reps`/`rounds`.
    const decimalOffered = await labels('42.5', withCatalog);
    expect(decimalOffered).toContain('kg');
    expect(decimalOffered).not.toContain('reps');
    expect(decimalOffered).not.toContain('rounds');

    // Wildcard `?` offers `reps` and units, not `rounds`.
    const wildcardOffered = await labels('?', withCatalog);
    expect(wildcardOffered).toContain('reps');
    expect(wildcardOffered).toContain('kg');
    expect(wildcardOffered).not.toContain('rounds');

    // Already has rounds on the line -> suppresses redundant `rounds`.
    for (const doc of ['3 rounds 10', '(3) 10']) {
      const offered = await labels(doc, withCatalog);
      expect(offered).toContain('reps');
      expect(offered).toContain('kg');
      expect(offered).not.toContain('rounds');
    }

    // Parenthesized single-number rounds offer `rounds` & `reps`; ladders stay empty.
    for (const doc of ['(3', '(3 ', '(3 r']) {
      const offered = await labels(doc, withCatalog);
      expect(offered).toContain('rounds');
      if (!doc.endsWith('r')) {
        expect(offered).toContain('reps');
      }
    }
    expect(await labels('(21-15', withCatalog)).toEqual([]);

    // Rep ladders (`9-7`, `9-7-5`) offer `reps` with rep-scheme detail, never `rounds` or physical units.
    for (const ladderDoc of ['9-7', '9-7-5', '9-7-5r']) {
      const state = EditorState.create({ doc: ladderDoc, extensions: whiteboardScript(withCatalog) });
      const res = await whiteboardScriptCompletionSource(withCatalog)(
        new CompletionContext(state, ladderDoc.length, true),
      );
      const opts = res?.options ?? [];
      const repsOpt = opts.find(o => o.label === 'reps');
      expect(repsOpt).toBeDefined();
      expect(repsOpt?.detail).toContain('rep scheme');
      const offered = opts.map(o => o.label);
      expect(offered).not.toContain('rounds');
      expect(offered).not.toContain('kg');
      expect(offered).not.toContain('lb');
      expect(offered).not.toContain('m');
    }

    // Trailing space after rep ladder transitions to missing efforts/equipment + FOR TIME without units.
    const afterLadder = await labels('9-7-5 ', withCatalog);
    expect(afterLadder).toContain('Back Squat');
    expect(afterLadder).toContain('Kettlebell');
    expect(afterLadder).toContain('FOR TIME');
    expect(afterLadder).not.toContain('reps');
    expect(afterLadder).not.toContain('rounds');
    expect(afterLadder).not.toContain('kg');
  });

  it('transitions from units to missing elements after space while still matching explicit partial units', async () => {
    const withCatalog: WhiteboardScriptCompletionOptions = {
      efforts: () => [
        { value: 'snatch', label: 'Snatch' },
        { value: 'back-squat', label: 'Back Squat' },
      ],
      equipment: () => [
        { value: 'kettlebell', label: 'Kettlebell' },
        { value: 'weight-vest', label: 'Weight Vest' },
      ],
    };

    for (const spacedDoc of ['10 ', '20 ', '10 reps ', '3 rounds ']) {
      const offered = await labels(spacedDoc, withCatalog);
      expect(offered).toContain('Snatch');
      expect(offered).toContain('Back Squat');
      expect(offered).toContain('Kettlebell');
      expect(offered).not.toContain('kg');
      expect(offered).not.toContain('lb');
      expect(offered).not.toContain('reps');
      expect(offered).not.toContain('rounds');
    }

    // Effort already on line (`Snatch 10 `) -> offers missing equipment, not duplicate efforts.
    const afterEffortQty = await labels('Snatch 10 ', withCatalog);
    expect(afterEffortQty).toContain('Kettlebell');
    expect(afterEffortQty).toContain('Weight Vest');
    expect(afterEffortQty).not.toContain('Back Squat');
    expect(afterEffortQty).not.toContain('kg');

    // Explicit partial unit/qualifier word after space still matches that unit/qualifier.
    expect(await labels('100 k', withCatalog)).toContain('kg');
    expect(await labels('10 rep', withCatalog)).toContain('reps');
    expect(await labels('3 rou', withCatalog)).toContain('rounds');
  });

  it('supports fuzzy typo matching and compositional effort/equipment upgrading', async () => {
    const richCatalog: WhiteboardScriptCompletionOptions = {
      efforts: () => [
        { value: 'snatch', label: 'Snatch', detail: 'weightlifting', equipment: ['dumbbell'] },
        { value: 'kettlebell-snatch', label: 'Kettlebell Snatch', detail: 'weightlifting', aliases: ['kb snatch'], equipment: ['kettlebell'] },
        { value: 'walking-3-mph', label: 'Walking', detail: 'cardio', aliases: ['walk'] },
        { value: 'back-squat', label: 'Back Squat', detail: 'strength', aliases: ['bs'] },
        { value: 'kettlebell-swing', label: 'Kettlebell Swing', detail: 'kettlebell', aliases: ['swing', 'kbs'], equipment: ['kettlebell'] },
      ],
      equipment: () => [
        { value: 'kettlebell', label: 'Kettlebell', aliases: ['kb'] },
        { value: 'weight-vest', label: 'Weight Vest', aliases: ['vest'] },
      ],
    };

    // Fuzzy typos in both standalone and post-quantity slots.
    expect(await labels('10 snacth', richCatalog)).toContain('Snatch');
    expect(await labels('snacth', richCatalog)).toContain('Snatch');
    expect(await labels('10 sqaut', richCatalog)).toContain('Back Squat');
    expect(await labels('10 wlak', richCatalog)).toContain('Walking');

    // Multi-element composition & trailing-space upgrades.
    expect(await labels('10 Walking weight v', richCatalog)).toContain('Weight Vest');
    expect(await labels('10 Weight Vest wal', richCatalog)).toContain('Walking');

    const afterSnatch = await labels('10 Snatch ', richCatalog);
    expect(afterSnatch).toContain('Kettlebell Snatch');
    expect(afterSnatch).toContain('Kettlebell');
    expect(afterSnatch).toContain('Weight Vest');
    expect(afterSnatch).not.toContain('Back Squat');

    // Live upgrading after effort selection: `10 Snatch KB` offers both equipment and dedicated effort.
    const kbState = EditorState.create({ doc: '10 Snatch KB', extensions: whiteboardScript(richCatalog) });
    const kbRes = await whiteboardScriptCompletionSource(richCatalog)(
      new CompletionContext(kbState, kbState.doc.length, true),
    );
    const kbOpts = kbRes?.options ?? [];
    expect(kbOpts.map(o => o.label)).toContain('Kettlebell');
    const kbSnatchOpt = kbOpts.find(o => o.label === 'Kettlebell Snatch');
    expect(kbSnatchOpt).toBeDefined();
    expect(kbSnatchOpt?.detail).toContain('Kettlebell');

    // No self-prefixed equipment duplicates (`Kettlebell Kettlebell Swing`).
    const kbSw = await labels('10 Kettlebell Sw', richCatalog);
    expect(kbSw.filter(l => l === 'Kettlebell Swing')).toHaveLength(1);

    // Completed effort + explicit equipment pairs close trailing-space prompts.
    expect(await labels('10 Snatch Kettlebell ', richCatalog)).toEqual([]);
    expect(await labels('10 Walking Weight Vest ', richCatalog)).toEqual([]);
    expect(await labels('10 Frog Jumps Weight Vest ', richCatalog)).toEqual([]);
  });

  it('anchors mid-token completions from token/effort start and covers trailing characters', async () => {
    const catalog: WhiteboardScriptCompletionOptions = {
      efforts: () => [
        { value: 'back-squat', label: 'Back Squat' },
        { value: 'snatch', label: 'Snatch' },
      ],
      tags: () => [{ value: 'heavy' }, { value: 'hero' }],
    };

    const queryAtCaret = async (docWithCaret: string) => {
      const pos = docWithCaret.indexOf('|');
      const doc = docWithCaret.slice(0, pos) + docWithCaret.slice(pos + 1);
      const state = EditorState.create({ doc, extensions: whiteboardScript(catalog) });
      return whiteboardScriptCompletionSource(catalog)(new CompletionContext(state, pos, true));
    };

    const midEffort = await queryAtCaret('10 Back Sq|at');
    expect(midEffort?.from).toBe('10 '.length);
    expect(midEffort?.to).toBe('10 Back Sqat'.length);
    expect(midEffort?.options.map(o => o.label)).toContain('Back Squat');

    const midStart = await queryAtCaret('Sn|tch');
    expect(midStart?.from).toBe(0);
    expect(midStart?.to).toBe('Sntch'.length);
    expect(midStart?.options.map(o => o.label)).toContain('Snatch');

    const midTag = await queryAtCaret('10 Back Squat #he|vy');
    expect(midTag?.from).toBe('10 Back Squat #'.length);
    expect(midTag?.to).toBe('10 Back Squat #hevy'.length);
    expect(midTag?.options.map(o => o.label)).toEqual(expect.arrayContaining(['heavy', 'hero']));

    const midUnit = await queryAtCaret('10k|g');
    expect(midUnit?.from).toBe('10'.length);
    expect(midUnit?.to).toBe('10kg'.length);
    expect(midUnit?.options.map(o => o.label)).toContain('kg');

    const preEffortNum = await queryAtCaret('100| Run');
    expect(preEffortNum?.from).toBe('100'.length);
    expect(preEffortNum?.options.map(o => o.label)).toEqual(expect.arrayContaining(['m', 'reps', 'rounds']));
  });
});

describe('whiteboardScriptCompletionSource — dialect options by sport', () => {
  it('adds cardio vocabulary only for the cardio sport', async () => {
    expect(await labels('10 ', { sport: 'cardio' })).toContain('Run');
    expect(await labels('10 ')).not.toContain('Run');
  });

  it('maps the climbing sport alias to climb vocabulary', async () => {
    const offered = await labels('', { sport: 'climbing' });
    expect(offered).toContain('redpoint');
    expect(offered).toContain('bouldering');
  });

  it('adds yoga pose/flow keywords', async () => {
    const offered = await labels('5:00 ', { sport: 'yoga' });
    expect(offered).toContain('Warrior');
    expect(offered).toContain('Sun Salutation');
  });

  it('adds habits keywords', async () => {
    const offered = await labels('10 ', { sport: 'habits' });
    expect(offered).toContain('Daily');
    expect(offered).toContain('Streak');
  });
});

describe('standalone whiteboardScript()', () => {
  it('returns LanguageSupport and its completion source resolves from that state', async () => {
    const support = whiteboardScript();
    expect(support).toBeInstanceOf(LanguageSupport);

    const state = EditorState.create({ doc: '100', extensions: [support] });
    const context = new CompletionContext(state, state.doc.length, true);
    const result = await whiteboardScriptCompletionSource()(context);
    expect(result?.options.map(option => option.label)).toContain('kg');
  });

  it('exposes a standalone autocompletion extension factory', () => {
    expect(typeof whiteboardScriptCompletion).toBe('function');
    expect(whiteboardScriptCompletion()).toBeTruthy();
  });
});

describe('snippet templates parse with no error nodes', () => {
  for (const snippet of whiteboardScriptSnippets) {
    it(`snippet "${snippet.name}" defaults are accepted by the Lezer grammar`, () => {
      const text = `${applyTemplateDefaults(snippet.template)}\n`;
      const tree = whiteboardParser.parse(text);
      const errors: string[] = [];
      tree.iterate({
        enter: node => {
          if (node.type.isError || node.type.isInvalid) errors.push(`${node.name} @${node.from}`);
        },
      });
      expect(errors).toEqual([]);
    });
  }
});
