import { autocompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult, CompletionSection, CompletionSource } from '@codemirror/autocomplete';
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
  /** Optional aliases (e.g. "swing", "kbs") matched alongside label and value. */
  aliases?: readonly string[];
  /** Short annotation shown after the label; the provider supplies a default. */
  detail?: string;
  /** Longer description shown in the completion info panel. */
  info?: string;
  /** Optional ranking boost (-99..99) applied by hosts with scoped context. */
  boost?: number;
  /** Optional section header grouping for the completion menu. */
  section?: string | CompletionSection;
}

export const COMPLETION_SECTIONS: Readonly<Record<string, CompletionSection>> = {
  units: { name: 'Units', rank: 1 },
  inNotebook: { name: 'In this notebook', rank: 2 },
  templates: { name: 'Templates', rank: 3 },
  actionCues: { name: 'Action Cues', rank: 4 },
  structure: { name: 'Structure', rank: 5 },
  movements: { name: 'Movements', rank: 6 },
  tags: { name: 'Tags', rank: 7 },
  equipment: { name: 'Equipment', rank: 8 },
  sounds: { name: 'Sounds', rank: 9 },
  dialect: { name: 'Dialect', rank: 10 },
  blockProperties: { name: 'Block Properties', rank: 20 },
  unitAliases: { name: 'Unit Aliases', rank: 50 },
  create: { name: 'Create', rank: 90 },
};

const SECTION_BY_NAME: Readonly<Record<string, CompletionSection>> = Object.fromEntries(
  Object.values(COMPLETION_SECTIONS).map(section => [section.name.toLowerCase(), section]),
);

function resolveSection(section?: string | CompletionSection): CompletionSection | undefined {
  if (!section) return undefined;
  if (typeof section === 'object') return section;
  return SECTION_BY_NAME[section.toLowerCase()] ?? { name: section, rank: 15 };
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
  /** Preferred unit tokens (e.g. `['kg', 'm']` from notebook scope) boosted above generic units. */
  preferredUnits?: () => readonly string[];
  /** Inline effort creation hook surfaced as a `+ Create` option when no catalog effort matches. */
  onCreateEffort?: (raw: string) => void | Promise<void>;
  /** Inline tag creation hook surfaced as a `+ Create` option when no catalog tag matches. */
  onCreateTag?: (slug: string) => void | Promise<void>;
}

/** Property keys offered at `Identifier` positions: reference keys + typed metric properties. */
export const COMPLETION_PROPERTY_KEYS: readonly string[] = ['effort', 'equipment', ...Object.keys(PROPERTY_KEY_TO_METRIC_TYPE)];

/** Display text for structural keywords (labels differ from the stored lowercase form). */
const STRUCTURE_KEYWORD_LABELS: readonly string[] = ['amrap', 'emom', 'tabata', 'for time', 'rest'];
const STRUCTURE_KEYWORD_DISPLAY: Record<string, string> = {
  'for time': 'FOR TIME',
  rest: 'Rest',
};

const PRIMARY_UNIT_BOOST: Readonly<Record<string, number>> = {
  kg: 30,
  lb: 29,
  m: 28,
  km: 27,
  cal: 26,
  mi: 25,
  ft: 24,
  kcal: 23,
};

function unitCompletions(
  units: UnitSet,
  dimension?: Dimension,
  preferredSet?: ReadonlySet<string>,
): Completion[] {
  return units.toArray()
    .filter(def => !dimension || def.dimension === dimension)
    .flatMap(def => {
      const canonicalLower = def.canonical.toLowerCase();
      const canonicalBoost = preferredSet?.has(canonicalLower)
        ? 40
        : (PRIMARY_UNIT_BOOST[canonicalLower] ?? 20);
      return [
        {
          label: def.canonical,
          detail: def.dimension,
          type: 'unit',
          section: COMPLETION_SECTIONS.units,
          boost: canonicalBoost,
        },
        ...def.aliases.map(alias => ({
          label: alias,
          detail: def.dimension,
          type: 'unit',
          section: COMPLETION_SECTIONS.unitAliases,
          boost: preferredSet?.has(alias.toLowerCase()) ? 35 : 5,
        })),
      ];
    });
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
    label: titleCase(word), detail: 'cardio', type: 'text', section: COMPLETION_SECTIONS.dialect,
  })),
  yoga: () => unique([
    ...YogaDialect.POSE_KEYWORDS, ...YogaDialect.FLOW_KEYWORDS,
    ...YogaDialect.BREATHING_KEYWORDS, ...YogaDialect.MEDITATION_KEYWORDS,
  ])
    // Skip keywords with characters the grammar cannot lex (e.g. `CHILD'S POSE`).
    .filter(word => /^[A-Z ]+$/.test(word))
    .map(word => ({ label: titleCase(word), detail: 'yoga', type: 'text', section: COMPLETION_SECTIONS.dialect })),
  habits: () => unique([...HabitsDialect.HABIT_KEYWORDS, ...HabitsDialect.STREAK_KEYWORDS]).map(word => ({
    label: titleCase(word), detail: 'habits', type: 'text', section: COMPLETION_SECTIONS.dialect,
  })),
  climb: () => [
    ...unique(Object.values(SEND_ALIASES)).map(send => ({ label: send, detail: 'send', type: 'text', section: COMPLETION_SECTIONS.dialect })),
    ...unique(Object.values(DISCIPLINE_KEYWORDS)).map(discipline => ({ label: discipline, detail: 'discipline', type: 'text', section: COMPLETION_SECTIONS.dialect })),
  ],
};

function structureKeywords(): Completion[] {
  return STRUCTURE_KEYWORD_LABELS
    .filter(word => STRUCTURAL_EFFORT_WORDS.has(word))
    .map(word => ({
      label: STRUCTURE_KEYWORD_DISPLAY[word] ?? word.toUpperCase(),
      detail: 'structure',
      type: 'keyword',
      section: COMPLETION_SECTIONS.structure,
      boost: 5,
      apply: STRUCTURE_KEYWORD_DISPLAY[word] ?? word.toUpperCase(),
    }));
}

const ACTION_CUE_COMPLETIONS: Completion[] = [
  { label: '[:rest]', detail: 'Rest cue', type: 'keyword', section: COMPLETION_SECTIONS.actionCues, apply: '[:rest] ', boost: 20 },
  { label: '[:next]', detail: 'Advance segment', type: 'keyword', section: COMPLETION_SECTIONS.actionCues, apply: '[:next] ', boost: 15 },
  { label: '[:done]', detail: 'Complete block', type: 'keyword', section: COMPLETION_SECTIONS.actionCues, apply: '[:done] ', boost: 12 },
  { label: '[:mark]', detail: 'Split / lap marker', type: 'keyword', section: COMPLETION_SECTIONS.actionCues, apply: '[:mark] ', boost: 10 },
];

const DEFAULT_SECTION_BY_KIND: Record<string, CompletionSection> = {
  effort: COMPLETION_SECTIONS.movements,
  equipment: COMPLETION_SECTIONS.equipment,
  sound: COMPLETION_SECTIONS.sounds,
  tag: COMPLETION_SECTIONS.tags,
};

const COMPLETION_TYPE_BY_KIND: Record<string, string> = {
  effort: 'variable',
  equipment: 'text',
  sound: 'constant',
  tag: 'constant',
};

const completionAliases = new WeakMap<Completion, readonly string[]>();

function toCompletions(values: readonly CompletionValueOption[], detail: string, quoteValues = false): Completion[] {
  const defaultSection = DEFAULT_SECTION_BY_KIND[detail];
  const completionType = COMPLETION_TYPE_BY_KIND[detail] ?? 'text';
  return values.map(value => {
    const insertText = quoteValues
      ? (!/^[A-Za-z][A-Za-z0-9]*$/.test(value.value) ? JSON.stringify(value.value) : value.value)
      : (value.label ?? value.value);
    const resolvedSection = resolveSection(value.section) ?? defaultSection;
    const item: Completion = {
      label: value.label ?? value.value,
      apply: insertText,
      detail: value.detail ?? (value.label && value.label !== value.value ? value.value : detail),
      type: completionType,
      info: value.info,
      ...(value.boost !== undefined ? { boost: value.boost } : {}),
      ...(resolvedSection ? { section: resolvedSection } : {}),
    };
    if (value.aliases?.length) {
      completionAliases.set(item, value.aliases.map(a => a.toLowerCase()));
    }
    return item;
  });
}

function appendCreateEffortOption(
  pool: Completion[],
  typedPhrase: string,
  onCreateEffort?: (raw: string) => void | Promise<void>,
): Completion[] {
  if (!onCreateEffort) return pool;
  const trimmed = typedPhrase.trim();
  if (trimmed.length < 3 || !/^[A-Za-z][A-Za-z0-9 -]*$/.test(trimmed)) return pool;
  const lower = trimmed.toLowerCase();
  const hasMatch = pool.some(opt => {
    const labelLower = opt.label.toLowerCase();
    const applyLower = typeof opt.apply === 'string' ? opt.apply.toLowerCase().trim() : '';
    const aliases = completionAliases.get(opt);
    return labelLower === lower || applyLower === lower || Boolean(aliases?.includes(lower));
  });
  if (hasMatch) return pool;
  const createOption: Completion = {
    label: trimmed,
    displayLabel: `+ Create "${trimmed}"`,
    detail: 'Add to Effort Library',
    type: 'create',
    section: COMPLETION_SECTIONS.create,
    boost: -25,
    apply: (view, _completion, from, to) => {
      view.dispatch({
        changes: { from, to, insert: trimmed },
        selection: { anchor: from + trimmed.length },
        userEvent: 'input.complete',
      });
      void onCreateEffort(trimmed);
    },
  };
  return [...pool, createOption];
}

function completionMatchesAliasOnly(option: Completion, typedLower: string): boolean {
  const aliases = completionAliases.get(option);
  return aliases ? aliases.some(alias => alias.includes(typedLower)) : false;
}

function completionMatchesWord(option: Completion, typedLower: string): 'prefix' | 'word' | 'alias' | null {
  const inserted = (typeof option.apply === 'string' ? option.apply : option.label).toLowerCase();
  const label = option.label.toLowerCase();
  if (inserted.startsWith(typedLower) || label.startsWith(typedLower)) return 'prefix';
  if (inserted.includes(typedLower) || label.includes(typedLower)) return 'word';
  if (completionMatchesAliasOnly(option, typedLower)) return 'alias';
  return null;
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

const ALWAYS_SUPPRESSED_NODES: ReadonlySet<string> = new Set(['Text', 'textComment', 'MetricObject']);
const HEADING_NODES: ReadonlySet<string> = new Set(['Heading', 'heading']);

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
  const snippetLabels = new Set(snippets.map(s => s.label));
  const startKeywords = keywords.filter(k => !snippetLabels.has(k.label));
  const units = options.units ?? UnitRegistry.standard();

  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (inNode(context, ALWAYS_SUPPRESSED_NODES)) return null;

    const pos = context.pos;
    const line = context.state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);

    const word = /([A-Za-z0-9-]*)$/.exec(before)![1];
    const beforeWord = before.slice(0, before.length - word.length);

    // Action cue shorthand: `[:` or `[:rest`
    const actionMatch = /(\[:[a-zA-Z0-9-]*)$/.exec(before);
    if (actionMatch) {
      return {
        from: pos - actionMatch[1].length,
        options: ACTION_CUE_COMPLETIONS,
        validFor: /^\[:[a-zA-Z0-9-]*\]?$/,
      };
    }

    // Tag reference: `#` or `#partial` — checked BEFORE `HEADING_NODES` because
    // the grammar lexes a bare `#` as `heading` until `[a-zA-Z0-9]` follows.
    // A `# Heading` with whitespace (`beforeWord === '# '`) does NOT end with `#`
    // and remains suppressed by `HEADING_NODES` below.
    if (/(?:^|[\s:])#$/.test(beforeWord) && (options.tags || options.onCreateTag)) {
      const rawTags = options.tags ? await options.tags() : [];
      const tagOptions = toCompletions(rawTags, 'tag');
      if (options.onCreateTag && word.length >= 2) {
        const slug = word.toLowerCase();
        const exists = rawTags.some(
          tag => tag.value.toLowerCase() === slug || (tag.label ?? '').toLowerCase() === slug,
        );
        if (!exists) {
          tagOptions.push({
            label: slug,
            displayLabel: `+ Create "#${slug}"`,
            detail: 'New tag',
            type: 'create',
            section: COMPLETION_SECTIONS.create,
            boost: -20,
            apply: (view, _completion, from, to) => {
              view.dispatch({
                changes: { from, to, insert: slug },
                selection: { anchor: from + slug.length },
                userEvent: 'input.complete',
              });
              void options.onCreateTag?.(slug);
            },
          });
        }
      }
      return {
        from: pos - word.length,
        options: tagOptions,
        validFor: /^[A-Za-z0-9-]*$/,
      };
    }

    if (inNode(context, HEADING_NODES)) return null;

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
    const equipmentPrefixes = options.equipment
      ? (await options.equipment()).map(eq => ({
          label: eq.label ?? eq.value,
          apply: `${eq.label ?? eq.value} `,
          detail: eq.detail ?? 'equipment',
          type: 'text' as const,
          section: resolveSection(eq.section) ?? COMPLETION_SECTIONS.equipment,
          ...(eq.boost !== undefined ? { boost: eq.boost } : {}),
        }))
      : [];
    const postQuantityEffortOptions = [...efforts, ...equipmentPrefixes, ...sportWords];
    const effortOptions = [...keywords, ...efforts, ...equipmentPrefixes, ...sportWords];

    // Property key: a bare `Identifier` starting the line (grammar's `Identifier
    // colon value`). A fresh word may also begin an effort or snippet, so all
    // statement-start choices stay available while CodeMirror filters the prefix.
    if (/^[ \t]*[A-Za-z][A-Za-z0-9]*$/.test(before)) {
      const supplied = suppliedPropertyKeys(context);
      const propertyOptions: Completion[] = COMPLETION_PROPERTY_KEYS
        .filter(key => !supplied.has(key))
        .map(key => ({
          label: key,
          apply: `${key}: `,
          detail: 'block property',
          type: 'property',
          section: COMPLETION_SECTIONS.blockProperties,
          boost: -10,
        }));
      const allStartOptions = [
        ...snippets,
        ...startKeywords,
        ...efforts,
        ...sportWords,
        ...propertyOptions,
      ];
      const typedRaw = before.trimStart();
      const typedStart = typedRaw.toLowerCase();
      const hasAliasHit = typedStart.length >= 2 && effortOptions.some(opt => completionMatchesWord(opt, typedStart) === 'alias');
      if (hasAliasHit) {
        const matched = allStartOptions.filter(opt => completionMatchesWord(opt, typedStart) !== null);
        return {
          from: pos - typedRaw.length,
          options: appendCreateEffortOption(matched, typedRaw, options.onCreateEffort),
          filter: false,
          validFor: /^[A-Za-z]*$/,
        };
      }
      return {
        from: pos - typedRaw.length,
        options: appendCreateEffortOption(allStartOptions, typedRaw, options.onCreateEffort),
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
      const preferredSet = new Set(
        (options.preferredUnits?.() ?? []).map(u => u.toLowerCase()),
      );
      const unitPool = unitCompletions(
        units,
        quantity.getChild('AtSign') ? 'mass' : undefined,
        preferredSet.size > 0 ? preferredSet : undefined,
      );
      const wordText = completingWord ? context.state.doc.sliceString(last.from, pos).toLowerCase() : '';
      const hasAliasHit = wordText.length >= 2 && postQuantityEffortOptions.some(opt => completionMatchesWord(opt, wordText) === 'alias');
      const pool = [...unitPool, ...postQuantityEffortOptions];
      if (hasAliasHit && completingWord) {
        const rawPhrase = context.state.doc.sliceString(last.from, pos);
        return {
          from: last.from,
          options: appendCreateEffortOption(
            pool.filter(opt => completionMatchesWord(opt, wordText) !== null),
            rawPhrase,
            options.onCreateEffort,
          ),
          filter: false,
          validFor: /^[A-Za-z]*$/,
        };
      }
      return {
        from: completingWord ? last.from : pos,
        options: completingWord
          ? appendCreateEffortOption(pool, context.state.doc.sliceString(last.from, pos), options.onCreateEffort)
          : pool,
        validFor: /^[A-Za-z]*$/,
      };
    }

    // Empty statement: structures, keywords, catalog efforts, dialect words.
    if (before.trim() === '') {
      return { from: pos, options: [...snippets, ...startKeywords, ...efforts, ...sportWords] };
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
      const rawPhrase = context.state.doc.sliceString(first.from, pos);
      const typed = rawPhrase.toLowerCase();
      const compatible = effortOptions.filter(option => completionMatchesWord(option, typed) !== null);
      const usesAlias = compatible.some(option => completionMatchesWord(option, typed) === 'alias');
      return {
        from: first.from,
        options: appendCreateEffortOption(compatible, rawPhrase, options.onCreateEffort),
        ...(usesAlias ? { filter: false } : {}),
        validFor: /^[A-Za-z ]*$/,
      };
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
