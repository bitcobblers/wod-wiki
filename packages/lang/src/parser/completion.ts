import { autocompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
import { UnitRegistry } from '../metrics/units';
import type { Dimension, UnitSet } from '../metrics/units';
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
  /** Unit set for this section, including dialect extensions. Defaults to the standard registry. */
  units?: UnitSet;
}

/** Property keys offered at `Identifier` positions: reference keys + typed metric properties. */
export const COMPLETION_PROPERTY_KEYS: readonly string[] = ['effort', 'equipment', ...Object.keys(PROPERTY_KEY_TO_METRIC_TYPE)];

/** Display text for structural keywords (labels differ from the stored lowercase form). */
const STRUCTURE_KEYWORD_LABELS: readonly string[] = ['amrap', 'emom', 'tabata', 'for time', 'rest'];
const STRUCTURE_KEYWORD_DISPLAY: Record<string, string> = {
  'for time': 'FOR TIME',
  rest: 'Rest',
};

function unitCompletions(units: UnitSet, dimension?: Dimension): Completion[] {
  return units.toArray()
    .filter(def => !dimension || def.dimension === dimension)
    .flatMap(def => [
      { label: def.canonical, detail: def.dimension, type: 'unit', boost: 1 },
      ...def.aliases.map(alias => ({ label: alias, detail: def.dimension, type: 'unit' })),
    ]);
}

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

function ancestor(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) return current;
  }
  return null;
}

function currentStatement(context: CompletionContext): SyntaxNode | null {
  const tree = syntaxTree(context.state);
  const line = context.state.doc.lineAt(context.pos);
  if (context.pos === line.from) return null;
  const resolved = tree.resolveInner(context.pos, -1);
  const statement = ancestor(resolved, 'Block') ?? ancestor(resolved, 'Property');
  if (statement) return statement;
  const beforeCursor = tree.resolveInner(context.pos - 1, -1);
  return ancestor(beforeCursor, 'Block') ?? ancestor(beforeCursor, 'Property');
}

function suppliedPropertyKeys(context: CompletionContext): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const property of syntaxTree(context.state).topNode.getChildren('Property')) {
    const identifier = property.firstChild;
    if (identifier?.name === 'Identifier') {
      keys.add(context.state.doc.sliceString(identifier.from, identifier.to).toLowerCase());
    }
  }
  return keys;
}

function isUnitFragment(context: CompletionContext, fragment: SyntaxNode, units: UnitSet): boolean {
  return fragment.firstChild?.name === 'Effort'
    && units.has(context.state.doc.sliceString(fragment.from, fragment.to));
}

function trailingEffortRun(
  context: CompletionContext,
  statement: SyntaxNode | null,
  units: UnitSet,
): SyntaxNode[] {
  const nodes = statement?.name === 'Block' ? statement.getChildren('Fragment') : [];
  let end = nodes.length;
  while (end > 0 && nodes[end - 1].from >= context.pos) end--;
  let start = end;
  while (start > 0 && nodes[start - 1].firstChild?.name === 'Effort') start--;
  const run = nodes.slice(start, end);
  let firstEffort = 0;
  while (firstEffort < run.length - 1 && isUnitFragment(context, run[firstEffort], units)) firstEffort++;
  return run.slice(firstEffort);
}

function inNode(context: CompletionContext, names: ReadonlySet<string>): boolean {
  for (let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent) {
    if (names.has(node.name)) return true;
  }
  return false;
}

const SUPPRESSED_NODES: ReadonlySet<string> = new Set(['Text', 'textComment', 'Heading', 'heading', 'MetricObject']);

/**
 * Syntax-aware Whiteboard Script completion source.
 *
 * Slots (driven by the Lezer tree and line shape, never a global word list):
 * - empty statement → structure snippets, structure keywords, effort catalog, dialect words
 * - effort word → structure keywords, effort catalog, dialect words
 * - after a quantity number → configured standard/dialect units (canonical + aliases), mass-only after `@`
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
  const units = options.units ?? UnitRegistry.standard();
  const allUnitOptions = unitCompletions(units);
  const massUnitOptions = unitCompletions(units, 'mass');

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

    const statement = currentStatement(context);
    if (statement?.name === 'Property') {
      const keyNode = statement.firstChild;
      if (keyNode?.name !== 'Identifier') return null;
      const key = context.state.doc.sliceString(keyNode.from, keyNode.to).toLowerCase();
      const value = keyNode.nextSibling;
      if (value && !value.type.isError && pos > value.to) return null;
      const source = key === 'effort' ? options.efforts
        : key === 'equipment' ? options.equipment
        : key === 'sound' ? options.sounds
        : undefined;
      if (source) return { from: value && !value.type.isError ? value.from : pos, options: toCompletions(await source(), key, true) };
      return null;
    }

    const efforts = options.efforts ? toCompletions(await options.efforts(), 'effort') : [];
    const effortOptions = [...keywords, ...efforts, ...sportWords];

    // Property key: a bare `Identifier` starting the line (grammar's `Identifier
    // colon value`). A fresh word may also begin an effort or snippet, so all
    // statement-start choices stay available while CodeMirror filters the prefix.
    if (/^[ \t]*[A-Za-z][A-Za-z0-9]*$/.test(before)) {
      const supplied = suppliedPropertyKeys(context);
      return {
        from: pos - before.trimStart().length,
        options: [...COMPLETION_PROPERTY_KEYS.filter(key => !supplied.has(key)).map(key => ({ label: key, detail: 'property', type: 'property', boost: 5 })), ...snippets, ...keywords, ...efforts, ...sportWords],
        validFor: /^[A-Za-z]*$/,
      };
    }

    // A quantity is the unit slot only when it is the last complete fragment,
    // or immediately precedes the effort word being completed. This excludes
    // timers, round schemes, ladders, actions, and completed unit tokens.
    const nodes = statement?.name === 'Block' ? statement.getChildren('Fragment') : [];
    let end = nodes.length;
    while (end > 0 && nodes[end - 1].from >= pos) end--;
    const last = nodes[end - 1];
    const completingWord = last?.firstChild?.name === 'Effort' && last.to === pos;
    const quantityFragment = completingWord ? nodes[end - 2] : last;
    const quantity = quantityFragment?.firstChild?.name === 'Quantity' ? quantityFragment.firstChild : null;
    const incompleteAction = statement?.name === 'Block' && statement.getChildren('Fragment').some(fragment =>
      fragment.firstChild?.name === 'Action'
      && fragment.from < (quantity?.from ?? pos)
      && !context.state.doc.sliceString(fragment.from, fragment.to).includes(':')
    );
    if (quantity && !incompleteAction) {
      return {
        from: completingWord ? last.from : pos,
        options: [...(quantity.getChild('AtSign') ? massUnitOptions : allUnitOptions), ...effortOptions],
        validFor: /^[A-Za-z]*$/,
      };
    }

    // Empty statement: structures, keywords, catalog efforts, dialect words.
    if (before.trim() === '') {
      return { from: pos, options: [...snippets, ...keywords, ...efforts, ...sportWords] };
    }

    // Whitespace after fragments (`10:00 `, `5x5 Back Squat `) — effort slot, no snippet/units.
    if (word.length === 0 && /[ \t]$/.test(before)) {
      const effortRun = trailingEffortRun(context, statement, units);
      const last = effortRun[effortRun.length - 1];
      if (last && !isUnitFragment(context, last, units)) return null;
      return { from: pos, options: effortOptions };
    }

    // Complete the whole current effort phrase. Earlier Effort nodes can be
    // words in that phrase, not permission to append another effort.
    if (word.length > 0 && /^[A-Za-z][A-Za-z0-9'-]*$/.test(word)) {
      const effortRun = trailingEffortRun(context, statement, units);
      const first = effortRun[0];
      const last = effortRun[effortRun.length - 1];
      if (!first || !last || last.to < pos) return null;
      const typed = context.state.doc.sliceString(first.from, pos).toLowerCase();
      const compatible = effortOptions.filter(option => {
        const inserted = typeof option.apply === 'string' ? option.apply : option.label;
        return inserted.toLowerCase().startsWith(typed);
      });
      return { from: first.from, options: compatible, validFor: /^[A-Za-z ]*$/ };
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
