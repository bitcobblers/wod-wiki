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
    name: 'circuit',
    label: 'Circuit',
    detail: 'Rounds over indented movements',
    template: '(${1:3})\n  ${2:10 Air Squats}\n  ${3:10 Push Ups}\n  ${4:10 Ring Rows}\n${0}',
  },
  {
    name: '5x5',
    label: '5x5',
    detail: 'Inline strength sets',
    template: '${1:5}x${2:5} ${3:Back Squat} @${4:100kg}\n${0}',
  },
  {
    name: 'emom',
    label: 'EMOM',
    detail: 'Every minute on the minute',
    template: '(${1:10}) ${2::60 EMOM}\n  + ${3:5 Burpees}\n  + ${4:10 Kettlebell Swings 24kg}\n${0}',
  },
  {
    name: 'amrap',
    label: 'AMRAP',
    detail: 'As many rounds as possible',
    template: '${1:10:00 AMRAP}\n  ${2:5 Pull Ups}\n  ${3:10 Push Ups}\n  ${4:15 Air Squats}\n${0}',
  },
  {
    name: 'tabata',
    label: 'Tabata',
    detail: 'Work/rest intervals',
    template: '(${1:8}) ${2::20 Work}\n  * ${3::10 Rest}\n  ${4:KB Snatch 16kg}\n${0}',
  },
  {
    name: 'ladder',
    label: 'Ladder',
    detail: 'Rep ladder (21-15-9)',
    template: '(${1:21-15-9})\n  ${2:Thrusters 95lb}\n  ${3:Pull-ups}\n${0}',
  },
  {
    name: 'choice',
    label: 'Choice',
    detail: 'Athlete choice between alternatives',
    template: '${1:10 Power Cleans 135/95 lb}\n${0}',
  },
  {
    name: 'superset',
    label: 'Superset',
    detail: 'Compound set via + lap markers',
    template: '+ ${1:5 Pull Ups}\n+ ${2:10 Push Ups}\n${0}',
  },
  {
    name: 'collectible',
    label: 'Collectible',
    detail: 'Measure time instead of prescribing it (:?)',
    template: '${1::? 400m Run}\n${0}',
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
      type: 'text',
      boost: 10,
    })
  );
}
