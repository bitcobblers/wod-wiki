import type { Completion } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';

/**
 * Machine-readable Whiteboard Script structure snippets.
 *
 * Every `template` is a CodeMirror snippet template (`${n:default}` fields,
 * `${0}` final cursor) whose **defaults expand to text the real Lezer grammar
 * accepts with no error nodes** — verified against `whiteboardParser` in
 * `tests/parser/completion.test.ts`. Text follows `docs/language/syntax-reference.md`.
 * The final cursor must use the braced `${0}` form: CodeMirror's snippet parser
 * only recognizes `$…` inside braces and would insert a bare `$0` literally.
 */
export interface WhiteboardScriptSnippet {
  /** Stable machine identifier. */
  name: string;
  /** Menu label. */
  label: string;
  /** Short description shown in the completion menu. */
  detail: string;
  /** CodeMirror snippet template; defaults parse cleanly on their own. */
  template: string;
}

export const whiteboardScriptSnippets: readonly WhiteboardScriptSnippet[] = [
  {
    name: 'emom',
    label: 'EMOM',
    detail: 'Every minute on the minute',
    template: '(${1:10}) ${2::60 EMOM}\n  + ${3:10 Kettlebell Swing} @${4:24kg} #emom\n${0}',
  },
  {
    name: 'amrap',
    label: 'AMRAP',
    detail: 'As many rounds as possible in time cap',
    template: '${1:12:00 AMRAP}\n  ${2:10 Pull-up}\n  ${3:15 Push-up}\n  ${4:200m Run} #amrap\n${0}',
  },
  {
    name: 'tabata',
    label: 'Tabata',
    detail: '8 intervals of 20s work / 10s rest',
    template: '(${1:8}) ${2::20 Work}\n  * ${3::10} [:rest]\n  ${4:10 Air Squat} #tabata\n${0}',
  },
  {
    name: '5x5',
    label: '5x5',
    detail: 'Sets × reps barbell progression',
    template: '${1:5}x${2:5} ${3:Back Squat} @${4:100kg} *${5:2:00} #strength\n${0}',
  },
  {
    name: 'circuit',
    label: 'Circuit',
    detail: 'Multi-station timed rounds',
    template: '(${1:3})\n  ${2:400m Run}\n  ${3:15 Wall Ball} @${4:9kg}\n  *${5:1:00} [:rest]\n${0}',
  },
  {
    name: 'ladder',
    label: 'Ladder',
    detail: 'Descending rep scheme (21-15-9)',
    template: '(${1:21-15-9})\n  ${2:Thruster} @${3:43kg}\n  ${4:Pull-up} #for-time\n${0}',
  },
  {
    name: 'choice',
    label: 'Choice',
    detail: 'Scaled or equipment alternative (A | B)',
    template: '(${1:5})\n  ${2:15 Kettlebell Swing} ${3:24 | 16 kg}\n${0}',
  },
  {
    name: 'superset',
    label: 'Superset',
    detail: 'Compound set via + lap markers',
    template: '+ ${1:5 Pull-up}\n+ ${2:10 Push-up}\n${0}',
  },
  {
    name: 'collectible',
    label: 'Collectible',
    detail: 'Open clock measure-until-done (:?)',
    template: '${1::? 2000m Row} #for-time\n${0}',
  },
];

/**
 * Expand a snippet template to its plain text by substituting each field's
 * default (and dropping bare `$n` stops). Used to verify snippet defaults
 * parse and by hosts that want a static preview.
 */
export function applyTemplateDefaults(template: string): string {
  return template
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$\d+/g, '');
}

/** Snippet completions using CodeMirror's snippet apply. */
export function snippetCompletions(): Completion[] {
  return whiteboardScriptSnippets.map(snippet =>
    snippetCompletion(snippet.template, {
      label: snippet.label,
      detail: snippet.detail,
      info: applyTemplateDefaults(snippet.template).trim(),
      section: { name: 'Templates', rank: 3 },
      type: 'text',
      boost: 10,
    })
  );
}
