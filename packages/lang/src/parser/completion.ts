import { autocompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
import { UnitRegistry } from '../metrics/units';
import { PROPERTY_KEY_TO_METRIC_TYPE, STRUCTURAL_EFFORT_WORDS } from './semantic-classifier';
import { CARDIO_ACTIVITY_KEYWORDS } from '../dialects/CardioDialect';
import { HabitsDialect } from '../dialects/HabitsDialect';
import { YogaDialect } from '../dialects/YogaDialect';
import { DISCIPLINE_KEYWORDS, SEND_ALIASES } from '../dialects/ClimbDialect';
import { SPORT_ALIASES } from '../dialects/DialectStack';
import { snippetCompletions } from './completion-snippets';

/**
 * One host-supplied catalog value (effort, equipment, tag, sound profile).
 * Hosts map their hydrated catalogs onto this shape; the provider only
 * decides *where* each value is offered.
 */
export interface CompletionValueOption {
  /** Text inserted when accepted (slug, authored label, or token). */
  value: string;
  /** Display label; defaults to `value`. */
  label?: string;
  /** Short annotation shown after the label; the provider supplies a default. */
  detail?: string;
  /** Longer description shown in the completion info panel. */
  info?: string;
}

/** Sync-or-async catalog callback; called per completion query, never cached globally. */
export type CompletionValueSource = () => readonly CompletionValueOption[] | Promise<readonly CompletionValueOption[]>;

/** Options for the Whiteboard Script completion provider. Pure — captured per extension. */
export interface WhiteboardScriptCompletionOptions {
  /** `:sport` dialect id (`cardio`, `yoga`, `habits`, `climb`/`climbing`) adding dialect vocabulary to effort slots. */
  sport?: string;
  /** Effort catalog — offered for bare efforts and `effort:` property values. */
  efforts?: CompletionValueSource;
  /** Equipment catalog — offered for `equipment:` property values. */
  equipment?: CompletionValueSource;
  /** Sound profile catalog — offered for `sound:` property values. */
  sounds?: CompletionValueSource;
  /** Tag index — offered after `#` tag references. */
  tags?: CompletionValueSource;
}

/** Property keys offered at `Identifier` positions: reference keys + typed metric properties. */
export const COMPLETION_PROPERTY_KEYS: readonly string[] = ['effort', 'equipment', ...Object.keys(PROPERTY_KEY_TO_METRIC_TYPE)];

/** Display text for structural keywords (labels differ from the stored lowercase form). */
const STRUCTURE_KEYWORD_LABELS: readonly string[] = ['amrap', 'emom', 'tabata', 'for time', 'rest'];
const STRUCTURE_KEYWORD_DISPLAY: Record<string, string> = {
  'for time': 'FOR TIME',
  rest: 'Rest',
};

const UNIT_COMPLETIONS: Completion[] = UnitRegistry.standard().toArray().flatMap(def => [
  { label: def.canonical, detail: def.dimension, type: 'unit', boost: 1 },
  ...def.aliases.map(alias => ({ label: alias, detail: def.dimension, type: 'unit' })),
]);

function titleCase(word: string): string {
  return word.toLowerCase().replace(/(^|[\s])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

function unique(words: readonly string[]): string[] {
  return [...new Set(words)];
}

/** Dialect vocabulary per sport id, derived from the dialects' own keyword tables. */
const SPORT_VOCABULARY: Record<string, () => Completion[]> = {
  cardio: () => unique(CARDIO_ACTIVITY_KEYWORDS.flatMap(activity => activity.keywords)).map(word => ({
    label: titleCase(word), detail: 'cardio', type: 'text',
  })),
  yoga: () => unique([
    ...YogaDialect.POSE_KEYWORDS, ...YogaDialect.FLOW_KEYWORDS,
    ...YogaDialect.BREATHING_KEYWORDS, ...YogaDialect.MEDITATION_KEYWORDS,
  ])
    // Skip keywords with characters the grammar cannot lex (e.g. `CHILD'S POSE`).
    .filter(word => /^[A-Z ]+$/.test(word))
    .map(word => ({ label: titleCase(word), detail: 'yoga', type: 'text' })),
  habits: () => unique([...HabitsDialect.HABIT_KEYWORDS, ...HabitsDialect.STREAK_KEYWORDS]).map(word => ({
    label: titleCase(word), detail: 'habits', type: 'text',
  })),
  climb: () => [
    ...unique(Object.values(SEND_ALIASES)).map(send => ({ label: send, detail: 'send', type: 'text' })),
    ...unique(Object.values(DISCIPLINE_KEYWORDS)).map(discipline => ({ label: discipline, detail: 'discipline', type: 'text' })),
  ],
};

function structureKeywords(): Completion[] {
  return STRUCTURE_KEYWORD_LABELS
    .filter(word => STRUCTURAL_EFFORT_WORDS.has(word))
    .map(word => ({
      label: STRUCTURE_KEYWORD_DISPLAY[word] ?? word.toUpperCase(),
      detail: 'structure',
      type: 'keyword',
      boost: 5,
      apply: STRUCTURE_KEYWORD_DISPLAY[word] ?? word.toUpperCase(),
    }));
}

function toCompletions(values: readonly CompletionValueOption[], detail: string, quoteValues = false): Completion[] {
  return values.map(value => ({
    label: value.label ?? value.value,
    // `Property` values only lex as String | Number | Identifier, and
    // Identifier is `[a-zA-Z][a-zA-Z0-9]*` — quote slugs it cannot represent
    // (hyphens, spaces, leading digits) so they insert parse-valid text;
    // `parsePropertyValue` unwraps the quotes when the property is consumed.
    apply: quoteValues && !/^[A-Za-z][A-Za-z0-9]*$/.test(value.value) ? JSON.stringify(value.value) : value.value,
    detail: value.detail ?? detail,
    type: 'text',
    info: value.info,
  }));
}

function dialectWords(sport?: string): Completion[] {
  if (!sport) return [];
  const vocabulary = SPORT_VOCABULARY[SPORT_ALIASES[sport] ?? sport];
  return vocabulary ? vocabulary() : [];
}

function inNode(context: CompletionContext, names: ReadonlySet<string>): boolean {
  for (let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent) {
    if (names.has(node.name)) return true;
  }
  return false;
}

const SUPPRESSED_NODES: ReadonlySet<string> = new Set(['Text', 'textComment', 'Heading', 'heading', 'MetricObject']);
// Actual Lezer node names (grammar): `Timer`, `RoundScheme` (5x5, 3 x 8), and
// `CollectibleTimer` (`:?`). The lowercase `schemeNumber`/`collectibleTimer`
// grammar identifiers are inlined tokens and never appear as tree nodes.
const TIMER_NODES: ReadonlySet<string> = new Set(['Timer', 'RoundScheme', 'CollectibleTimer']);

/**
 * Syntax-aware Whiteboard Script completion source.
 *
 * Slots (driven by the Lezer tree and line shape, never a global word list):
 * - empty statement → structure snippets, structure keywords, effort catalog, dialect words
 * - effort word → structure keywords, effort catalog, dialect words
 * - after a number → units from `STANDARD_UNITS` (canonical + aliases)
 * - `Identifier` line start → property keys (effort, equipment, rpe, rir, intensity, load, volume, work, sound)
 * - `key: value` → catalog values for effort/equipment/sound
 * - after `#` → tag slugs
 *
 * Pure: all host data arrives via {@link WhiteboardScriptCompletionOptions} closures — no module state.
 */
export function whiteboardScriptCompletionSource(options: WhiteboardScriptCompletionOptions = {}): CompletionSource {
  const sportWords = dialectWords(options.sport);
  const keywords = structureKeywords();
  const snippets = snippetCompletions();

  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (inNode(context, SUPPRESSED_NODES)) return null;

    const pos = context.pos;
    const line = context.state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);

    const word = /([A-Za-z0-9-]*)$/.exec(before)![1];
    const beforeWord = before.slice(0, before.length - word.length);

    // Tag reference: `#partial` — inline or as a property value.
    if (beforeWord.endsWith('#') && options.tags) {
      return { from: pos - word.length, options: toCompletions(await options.tags(), 'tag') };
    }

    // Property value: `key: partial` — effort/equipment/sound resolve against host catalogs.
    const value = /^[ \t]*([A-Za-z][A-Za-z0-9]*)[ \t]*:[ \t]*([A-Za-z0-9-]*)$/.exec(before);
    if (value) {
      const key = value[1].toLowerCase();
      const partial = value[2];
      const source = key === 'effort' ? options.efforts
        : key === 'equipment' ? options.equipment
        : key === 'sound' ? options.sounds
        : undefined;
      if (source) return { from: pos - partial.length, options: toCompletions(await source(), key, true) };
      return null;
    }

    const efforts = options.efforts ? toCompletions(await options.efforts(), 'effort') : [];

    // Property key: a bare `Identifier` starting the line (grammar's `Identifier
    // colon value`). A fresh word may also begin an effort or snippet, so all
    // statement-start choices stay available while CodeMirror filters the prefix.
    if (/^[ \t]*[A-Za-z][A-Za-z0-9]*$/.test(before)) {
      return {
        from: pos - before.trimStart().length,
        options: [...COMPLETION_PROPERTY_KEYS.map(key => ({ label: key, detail: 'property', type: 'property', boost: 5 })), ...snippets, ...keywords, ...efforts, ...sportWords],
        validFor: /^[A-Za-z]*$/,
      };
    }

    // Units after a number, alongside effort vocabulary (the word may be a
    // movement or a unit — CodeMirror filters by prefix). Not inside timers
    // (`10:00`), round schemes (`5x5`, `3 x 5` — in-tree, or past the trailing
    // space where the tree has already closed the node), or in-progress
    // ladders (`21-15`).
    const unit = /(\d+)([ \t]*)([A-Za-z]*)$/.exec(before);
    if (unit && !inNode(context, TIMER_NODES)) {
      const digitStart = before.length - unit[3].length - unit[2].length - unit[1].length;
      // Character before the number, skipping the space run between the
      // number and the unit word: a timer `:`, ladder `-`, or group `(` keeps
      // its slot closed, and `x`/`X` closes it for round schemes (`5x5 kg`,
      // `3 x 5 kg` lex the trailing number as rounds × reps).
      const tail = before.slice(0, digitStart).trimEnd().slice(-1);
      if (tail === '' || !':-(+xX'.includes(tail)) {
        return {
          from: pos - unit[3].length,
          options: [...UNIT_COMPLETIONS, ...keywords, ...efforts, ...sportWords],
          validFor: /^[A-Za-z]*$/,
        };
      }
    }

    // Empty statement: structures, keywords, catalog efforts, dialect words.
    if (before.trim() === '') {
      return { from: pos, options: [...snippets, ...keywords, ...efforts, ...sportWords] };
    }

    // Whitespace after fragments (`10:00 `, `5x5 Back Squat `) — effort slot, no snippet/units.
    if (word.length === 0 && /[ \t]$/.test(before)) {
      return { from: pos, options: [...keywords, ...efforts, ...sportWords] };
    }

    // Effort word on a line that already carries fragments.
    if (word.length > 0 && /^[A-Za-z][A-Za-z0-9'-]*$/.test(word)) {
      return { from: pos - word.length, options: [...keywords, ...efforts, ...sportWords] };
    }

    return null;
  };
}

/**
 * Standalone autocomplete extension for Whiteboard Script — `autocompletion`
 * overridden to the syntax-aware source. Use {@link whiteboardScriptCompletionSource}
 * instead when composing with other completion sources.
 */
export function whiteboardScriptCompletion(options: WhiteboardScriptCompletionOptions = {}): Extension {
  return autocompletion({ override: [whiteboardScriptCompletionSource(options)] });
}
