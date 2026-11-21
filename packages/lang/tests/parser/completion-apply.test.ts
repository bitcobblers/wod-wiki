// @vitest-environment happy-dom
// Real completion-apply regressions: accepted completions must insert
// parse-valid text. Run in happy-dom because `EditorView` needs a DOM.
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  CompletionContext,
  acceptCompletion,
  autocompletion,
  completionStatus,
  currentCompletions,
  setSelectedCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import {
  whiteboardParser,
  whiteboardScriptCompletionSource,
  whiteboardScriptSnippets,
  UnitRegistry,
  whiteboardScriptLanguage,
} from '../../src/index';
import type { WhiteboardScriptCompletionOptions } from '../../src/index';

const host = document.createElement('div');
document.body.appendChild(host);

function errorNodes(text: string): string[] {
  const errors: string[] = [];
  whiteboardParser.parse(text).iterate({
    enter: node => {
      if (node.type.isError || node.type.isInvalid) errors.push(`${node.name} @${node.from}`);
    },
  });
  return errors;
}

/** Open the real completion menu at the end of `doc`, accept the option with
 *  `label`, and return the resulting document text. */
async function acceptOption(doc: string, label: string, options: WhiteboardScriptCompletionOptions = {}): Promise<string> {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      // interactionDelay 0: `acceptCompletion` ignores picks made sooner.
      extensions: [whiteboardScriptLanguage, autocompletion({ override: [whiteboardScriptCompletionSource(options)], interactionDelay: 0 })],
    }),
    parent: host,
  });
  try {
    view.dispatch({ selection: { anchor: doc.length } });
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
    const index = currentCompletions(view.state).findIndex(option => option.label === label);
    expect(index).toBeGreaterThanOrEqual(0);
    view.dispatch({ effects: setSelectedCompletion(index) });
    expect(acceptCompletion(view)).toBe(true);
    return view.state.doc.toString();
  } finally {
    view.destroy();
  }
}

describe('real completion apply inserts parse-valid text', () => {
  it('accepted snippets insert no literal tab-stop marker and parse clean', async () => {
    for (const snippet of whiteboardScriptSnippets) {
      const text = await acceptOption('', snippet.label);
      // A bare `$0`/`$1` in the template would reach the document verbatim.
      expect(text, snippet.name).not.toMatch(/\$\d/);
      expect(errorNodes(text), snippet.name).toEqual([]);
    }
  });

  it('every offered number continuation applies to a parser-accepted statement', async () => {
    const options: WhiteboardScriptCompletionOptions = {
      efforts: () => [{ value: 'Back Squat' }],
      units: UnitRegistry.standard().extend({ canonical: 'pood', dimension: 'mass', aliases: ['poods'] }),
    };
    for (const doc of ['10', '10 ', '@100 ']) {
      const state = EditorState.create({ doc, extensions: [whiteboardScriptLanguage] });
      const result = await whiteboardScriptCompletionSource(options)(new CompletionContext(state, doc.length, true));
      expect(result).not.toBeNull();
      for (const option of result!.options) {
        const text = await acceptOption(doc, option.label, options);
        expect(errorNodes(`${text}\n`), `${doc}${option.label}`).toEqual([]);
      }
    }
  });

  it('multiword efforts replace the whole current phrase in choice and compose slots', async () => {
    const options: WhiteboardScriptCompletionOptions = { efforts: () => [{ value: 'Back Squat' }] };
    for (const [doc, expected] of [
      ['10 Back Sq', '10 Back Squat'],
      ['10 Push Ups | ', '10 Push Ups | Back Squat'],
      ['+ ', '+ Back Squat'],
    ] as const) {
      const text = await acceptOption(doc, 'Back Squat', options);
      expect(text).toBe(expected);
      expect(errorNodes(`${text}\n`)).toEqual([]);
    }
  });

  it('hyphenated catalog values apply quoted and parse clean', async () => {
    const text = await acceptOption('effort: back', 'back-squat', {
      efforts: () => [{ value: 'back-squat' }],
    });
    expect(text).toBe('effort: "back-squat"');
    expect(errorNodes(text)).toEqual([]);
  });

  it('hyphenated equipment values apply quoted and parse clean', async () => {
    const text = await acceptOption('equipment: pull', 'pull-up-bar', {
      equipment: () => [{ value: 'pull-up-bar' }],
    });
    expect(text).toBe('equipment: "pull-up-bar"');
    expect(errorNodes(text)).toEqual([]);
  });

  it('ordinary identifier values apply bare and parse clean', async () => {
    const text = await acceptOption('effort: fr', 'fran', {
      efforts: () => [{ value: 'fran' }],
    });
    expect(text).toBe('effort: fran');
    expect(errorNodes(text)).toEqual([]);
  });

  it('property keys insert a trailing colon and space', async () => {
    const text = await acceptOption('soun', 'sound');
    expect(text).toBe('sound: ');
  });

  it('inserts reps, rounds, rep-ladder reps, and paren rounds cleanly with zero syntax errors', async () => {
    for (const [doc, label, expected] of [
      ['10', 'reps', '10 reps'],
      ['3', 'rounds', '3 rounds'],
      ['3ro', 'rounds', '3 rounds'],
      ['10r', 'reps', '10 reps'],
      ['10', 'kg', '10kg'],
      ['9-7-5', 'reps', '9-7-5 reps'],
      ['(3', 'rounds', '(3 rounds)'],
      ['(3 ', 'rounds', '(3 rounds)'],
    ] as const) {
      const text = await acceptOption(doc, label);
      expect(text).toBe(expected);
      expect(errorNodes(`${text}\n`), `${doc} -> ${label}`).toEqual([]);
    }

    // In real EditorView, CM6 prefix-filters `'3ro'` down to `rounds` and drops `reps`.
    const view3ro = new EditorView({
      state: EditorState.create({
        doc: '3ro',
        extensions: [whiteboardScriptLanguage, autocompletion({ override: [whiteboardScriptCompletionSource()], interactionDelay: 0 })],
      }),
      parent: host,
    });
    try {
      view3ro.dispatch({ selection: { anchor: 3 } });
      startCompletion(view3ro);
      await vi.waitFor(() => expect(completionStatus(view3ro.state)).toBe('active'));
      const filteredLabels = currentCompletions(view3ro.state).map(o => o.label);
      expect(filteredLabels).toContain('rounds');
      expect(filteredLabels).not.toContain('reps');
    } finally {
      view3ro.destroy();
    }
  });

  it('applies compositional equipment suffix and full-phrase effort upgrades cleanly', async () => {
    const catalogOptions: WhiteboardScriptCompletionOptions = {
      efforts: () => [
        { value: 'snatch', label: 'Snatch', equipment: ['dumbbell'] },
        { value: 'kettlebell-snatch', label: 'Kettlebell Snatch', aliases: ['kb snatch'], equipment: ['kettlebell'] },
        { value: 'walking-3-mph', label: 'Walking', aliases: ['walk'] },
        { value: 'kettlebell-swing', label: 'Kettlebell Swing', aliases: ['swing', 'kbs'], equipment: ['kettlebell'] },
      ],
      equipment: () => [
        { value: 'kettlebell', label: 'Kettlebell', aliases: ['kb'] },
        { value: 'weight-vest', label: 'Weight Vest' },
      ],
    };

    for (const [doc, label, expected] of [
      ['10 Snatch KB', 'Kettlebell', '10 Snatch Kettlebell'],
      ['10 Snatch KB', 'Kettlebell Snatch', '10 Kettlebell Snatch'],
      ['10 Snatch ', 'Kettlebell', '10 Snatch Kettlebell'],
      ['10 Snatch ', 'Kettlebell Snatch', '10 Kettlebell Snatch'],
      ['10 Walking weight v', 'Weight Vest', '10 Walking Weight Vest'],
      ['10 Weight Vest wal', 'Walking', '10 Weight Vest Walking'],
      ['10 Kettlebell Sw', 'Kettlebell Swing', '10 Kettlebell Swing'],
    ] as const) {
      const text = await acceptOption(doc, label, catalogOptions);
      expect(text).toBe(expected);
      expect(errorNodes(`${text}\n`), `${doc} -> ${label}`).toEqual([]);
    }
  });
});
