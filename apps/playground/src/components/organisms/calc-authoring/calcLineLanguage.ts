/**
 * CodeMirror language support for calc lines (#880) — StreamLanguage-based
 * syntax highlighting (the calc line grammar is small and line-oriented, so
 * a full Lezer grammar is unnecessary). Token names map onto standard
 * CodeMirror tags so any highlight style colors them.
 */

import { HighlightStyle, StreamLanguage, StreamParser, syntaxHighlighting, LanguageSupport } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import {
  CLAUSE_WORDS,
  FUNCTION_NAMES,
  SEGMENT_ATOMS,
  WORKOUT_CONTEXT_ATOMS,
  STREAM_METRICS,
  SCOPE_WORDS,
  LOOKUP_TABLES,
} from './calcVocabulary';

const KEYWORDS = new Set<string>([
  ...CLAUSE_WORDS,
  ...SCOPE_WORDS,
  'lookup',
]);
const FUNCTIONS = new Set<string>(FUNCTION_NAMES);
const ATOMS = new Set<string>([
  ...SEGMENT_ATOMS.map((a) => a.name),
  ...WORKOUT_CONTEXT_ATOMS.map((a) => a.name),
  ...STREAM_METRICS,
  ...LOOKUP_TABLES.map((t) => t.name),
]);

const NUMBER_RE = /^\d*\.?\d+d?/;
const IDENT_RE = /^[A-Za-z_][\w.]*/;

const parser: StreamParser<unknown> = {
  name: 'calcLine',
  token(stream) {
    if (stream.eatSpace()) return null;
    // Full-line comment.
    if (stream.match('#', false)) {
      // '#' anywhere starts a comment to end of line.
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"([^"]*)"/) || stream.match(/^'([^']*)'/)) return 'string';
    // Unit arrow + comparison operators.
    if (stream.match(/^(->|==|!=|<=|>=)/)) return 'operator';
    if (stream.match(/^[+\-*/=<>(),:{}[\]]/)) return 'operator';
    const num = stream.match(NUMBER_RE);
    if (num) return 'number';
    if (stream.match(IDENT_RE)) {
      const word = stream.current();
      if (KEYWORDS.has(word)) return 'keyword';
      if (FUNCTIONS.has(word)) return 'function';
      if (ATOMS.has(word)) return 'variableName';
      return 'variableName';
    }
    stream.next();
    return null;
  },
};

export const calcLineLanguage = StreamLanguage.define(parser);

/**
 * Theme-aware colors for calc tokens, mirroring the app's editor palette.
 * `standard` tags fall back to the host theme via a minimal highlight style.
 */
export const calcLineHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c084fc' },
  { tag: tags.function(tags.variableName), color: '#60a5fa' },
  { tag: tags.variableName, color: '#e4e4e7' },
  { tag: tags.number, color: '#fbbf24' },
  { tag: tags.string, color: '#34d399' },
  { tag: tags.operator, color: '#a1a1aa' },
  { tag: tags.comment, color: '#71717a', fontStyle: 'italic' },
]);

/** Full extension: language + highlight style. */
export function calcLineSupport(): LanguageSupport {
  return new LanguageSupport(calcLineLanguage, [syntaxHighlighting(calcLineHighlight)]);
}
