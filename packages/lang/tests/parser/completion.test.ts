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

  it('offers catalog efforts on an empty statement and in effort slots', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
    };
    expect(await labels('', options)).toContain('Back Squat');
    expect(await labels('10 Push', options)).toContain('Back Squat');
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

  it('uses dialect-extended units and limits resistance quantities to mass', async () => {
    const units = UnitRegistry.standard().extend({ canonical: 'pood', dimension: 'mass', aliases: ['poods'] });
    const offered = await labels('10 ', { units });
    expect(offered).toContain('pood');
    expect(offered).toContain('poods');

    const resistance = await labels('@100 ', { units });
    expect(resistance).toContain('kg');
    expect(resistance).toContain('pood');
    expect(resistance).not.toContain('km');
    expect(resistance).not.toContain('cal');
  });

  it('offers no second unit after a number already has one', async () => {
    const offered = await labels('10 kg ', {
      efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
    });
    expect(offered).not.toContain('lb');
    expect(offered).not.toContain('kg');
    expect(offered).toContain('Back Squat');
  });

  it('offers STANDARD_UNITS canonical spellings and aliases after a number', async () => {
    const offered = await labels('100 ');
    expect(offered).toContain('kg');
    expect(offered).toContain('lbs');
    expect(offered).toContain('mile');
    const kg = offered.indexOf('kg');
    expect(kg).toBeGreaterThanOrEqual(0);
  });

  it('allows units after compose quantities but not inside action syntax', async () => {
    expect(await labels('+ 5 ')).toContain('kg');
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

    const state = EditorState.create({ doc: '100 ', extensions: [support] });
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
