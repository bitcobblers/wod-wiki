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
    for (const doc of ['10 ', '@100 ']) {
      const state = EditorState.create({ doc });
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
});
