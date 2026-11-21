import { autocompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult, CompletionSection, CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
import { normalizeForFuzzy } from '../effort-registry/fuzzyMatch';
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
  /** Equipment slugs associated with this effort definition (for matching & annotations). */
  equipment?: readonly string[];
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
  /** Equipment catalog — offered for `equipment:` property values and compositional lines. */
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

const COUNT_QUALIFIER_WORDS = /^(reps?|rounds?|rds?|sets?|laps?|cycles?|intervals?)$/i;
const ROUNDS_QUALIFIER_WORDS = /^(rounds?|rds?|sets?|laps?|cycles?|intervals?)$/i;

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

function clampBoost(value: number): number {
  return Math.max(-99, Math.min(99, Math.round(value)));
}

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
      const canonicalOption: Completion = {
        label: def.canonical,
        detail: def.dimension,
        type: 'unit',
        section: COMPLETION_SECTIONS.units,
        boost: canonicalBoost,
      };
      if (def.aliases.length > 0) {
        completionAliases.set(canonicalOption, def.aliases.map(a => a.toLowerCase()));
      }
      return [
        canonicalOption,
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

function makeCountQualifiers(
  includeRounds: boolean,
  needsLeadingSpace: boolean,
  ladderDetail?: string,
): Completion[] {
  const space = needsLeadingSpace ? ' ' : '';
  const items: Completion[] = [
    {
      label: 'reps',
      detail: ladderDetail ?? 'count',
      type: 'unit',
      section: COMPLETION_SECTIONS.units,
      apply: `${space}reps`,
      boost: ladderDetail ? 45 : 38,
    },
  ];
  completionAliases.set(items[0], ['rep']);
  if (includeRounds) {
    const roundsOpt: Completion = {
      label: 'rounds',
      detail: 'rounds',
      type: 'unit',
      section: COMPLETION_SECTIONS.units,
      apply: `${space}rounds`,
      boost: 37,
    };
    completionAliases.set(roundsOpt, ['round', 'rd', 'rds', 'set', 'sets']);
    items.push(roundsOpt);
  }
  return items;
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
      ...(value.boost !== undefined ? { boost: clampBoost(value.boost) } : {}),
      ...(resolvedSection ? { section: resolvedSection } : {}),
    };
    if (value.aliases?.length) {
      completionAliases.set(item, value.aliases.map(a => a.toLowerCase()));
    }
    return item;
  });
}

// ── Fuzzy, order-independent, and equipment-aware matching ───────────

/** Optimal String Alignment (Damerau-Levenshtein) distance; transpositions cost 1. */
function damerauDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
    }
  }
  return dp[m][n];
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  if (needle.length < 3 || haystack.length > 28) return false;
  if (needle[0] !== haystack[0]) return false;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) i++;
  }
  return i === needle.length;
}

interface CatalogEntry {
  readonly kind: 'effort' | 'equipment';
  readonly option: CompletionValueOption;
  readonly label: string;
  readonly labelLower: string;
  readonly terms: readonly string[];
  readonly words: readonly string[];
  readonly equipmentSlugs: readonly string[];
  readonly equipmentTerms: readonly string[];
  readonly completion: Completion;
}

interface CatalogIndex {
  readonly efforts: readonly CatalogEntry[];
  readonly equipment: readonly CatalogEntry[];
  readonly equipmentLabelBySlug: ReadonlyMap<string, string>;
}

function dedupeStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildCatalogIndex(
  rawEfforts: readonly CompletionValueOption[],
  rawEquipment: readonly CompletionValueOption[],
): CatalogIndex {
  const eqCompletions = toCompletions(rawEquipment, 'equipment');
  const eqTermsBySlug = new Map<string, string[]>();
  const equipmentLabelBySlug = new Map<string, string>();
  const equipment: CatalogEntry[] = rawEquipment.map((opt, idx) => {
    const label = opt.label ?? opt.value;
    const rawTerms = [label, opt.value, ...(opt.aliases ?? [])];
    const terms = dedupeStrings(rawTerms.map(t => normalizeForFuzzy(t)));
    const words = dedupeStrings(terms.flatMap(t => t.split(' ')));
    const slugLower = opt.value.toLowerCase();
    eqTermsBySlug.set(slugLower, dedupeStrings([...terms, ...words]));
    equipmentLabelBySlug.set(slugLower, label);
    const base = eqCompletions[idx];
    return {
      kind: 'equipment',
      option: opt,
      label,
      labelLower: label.toLowerCase(),
      terms,
      words,
      equipmentSlugs: [slugLower],
      equipmentTerms: [],
      completion: {
        ...base,
        section: resolveSection(opt.section) ?? COMPLETION_SECTIONS.equipment,
      },
    };
  });

  const effortCompletions = toCompletions(rawEfforts, 'effort');
  const efforts: CatalogEntry[] = rawEfforts.map((opt, idx) => {
    const label = opt.label ?? opt.value;
    const rawTerms = [label, opt.value, ...(opt.aliases ?? [])];
    const terms = dedupeStrings(rawTerms.map(t => normalizeForFuzzy(t)));
    const words = dedupeStrings(terms.flatMap(t => t.split(' ')));
    const equipmentSlugs = (opt.equipment ?? []).map(s => s.toLowerCase());
    const equipmentTerms = dedupeStrings(
      equipmentSlugs.flatMap(slug => eqTermsBySlug.get(slug) ?? [normalizeForFuzzy(slug)]),
    );
    return {
      kind: 'effort',
      option: opt,
      label,
      labelLower: label.toLowerCase(),
      terms,
      words,
      equipmentSlugs,
      equipmentTerms,
      completion: effortCompletions[idx],
    };
  });

  return { efforts, equipment, equipmentLabelBySlug };
}

function bestTokenScore(qTok: string, entry: CatalogEntry): number {
  let best = 0;

  for (const term of entry.terms) {
    if (term === qTok) return 100;
    if (term.startsWith(qTok)) best = Math.max(best, 86);
    else if (qTok.length >= 2 && term.includes(qTok)) best = Math.max(best, 58);
    else if (isOrderedSubsequence(qTok, term)) best = Math.max(best, 32);
  }

  for (const word of entry.words) {
    if (word === qTok) best = Math.max(best, 95);
    else if (word.startsWith(qTok)) best = Math.max(best, 82);
    else if (qTok.length >= 2 && word.includes(qTok)) best = Math.max(best, 55);
    else if (qTok.length >= 3) {
      const maxDist = qTok.length <= 4 ? 1 : 2;
      if (Math.abs(word.length - qTok.length) <= maxDist) {
        const dist = damerauDistance(qTok, word);
        if (dist <= maxDist) best = Math.max(best, 46 - dist * 10);
      } else if (qTok.length >= 4 && word.length > qTok.length) {
        const prefix = word.slice(0, qTok.length);
        const dist = damerauDistance(qTok, prefix);
        if (dist <= 1) best = Math.max(best, 38);
      }
      if (isOrderedSubsequence(qTok, word)) best = Math.max(best, 30);
    }
  }

  for (const eqTerm of entry.equipmentTerms) {
    if (eqTerm === qTok) best = Math.max(best, 76);
    else if (qTok.length >= 2 && eqTerm.startsWith(qTok)) best = Math.max(best, 66);
    else if (qTok.length >= 4 && Math.abs(eqTerm.length - qTok.length) <= 1) {
      if (damerauDistance(qTok, eqTerm) <= 1) best = Math.max(best, 34);
    }
  }

  return best;
}

function scoreCatalogEntry(query: string, entry: CatalogEntry): number | null {
  const normQuery = normalizeForFuzzy(query);
  if (!normQuery) return 1;
  const qTokens = normQuery.split(' ').filter(Boolean);
  if (qTokens.length === 0) return 1;

  let wholeBonus = 0;
  for (const term of entry.terms) {
    if (term === normQuery) {
      wholeBonus = Math.max(wholeBonus, 140);
    } else if (term.startsWith(normQuery)) {
      wholeBonus = Math.max(wholeBonus, 115);
    } else if (normQuery.length >= 2 && term.includes(normQuery)) {
      wholeBonus = Math.max(wholeBonus, 80);
    }
  }

  let tokenSum = 0;
  for (const qTok of qTokens) {
    const tokenScore = bestTokenScore(qTok, entry);
    if (tokenScore === 0) return null;
    tokenSum += tokenScore;
  }

  const labelWordCount = normalizeForFuzzy(entry.label).split(' ').filter(Boolean).length;
  const extraWordPenalty = Math.max(0, labelWordCount - qTokens.length) * 3;
  return wholeBonus + Math.round(tokenSum / qTokens.length) - extraWordPenalty + (entry.option.boost ?? 0);
}

function scoreCompletionOption(query: string, option: Completion): number | null {
  const normQuery = normalizeForFuzzy(query);
  if (!normQuery) return 1;
  const qTokens = normQuery.split(' ').filter(Boolean);
  if (qTokens.length === 0) return 1;

  const aliases = completionAliases.get(option) ?? [];
  const rawTerms = [
    option.label,
    typeof option.apply === 'string' ? option.apply : '',
    ...aliases,
  ].filter(Boolean);
  const terms = dedupeStrings(rawTerms.map(t => normalizeForFuzzy(t)));
  const words = dedupeStrings(terms.flatMap(t => t.split(' ')));

  let wholeBonus = 0;
  for (const term of terms) {
    if (term === normQuery) wholeBonus = Math.max(wholeBonus, 130);
    else if (term.startsWith(normQuery)) wholeBonus = Math.max(wholeBonus, 105);
    else if (normQuery.length >= 2 && term.includes(normQuery)) wholeBonus = Math.max(wholeBonus, 70);
  }

  let tokenSum = 0;
  for (const qTok of qTokens) {
    let best = 0;
    for (const term of terms) {
      if (term === qTok) best = Math.max(best, 100);
      else if (term.startsWith(qTok)) best = Math.max(best, 85);
      else if (qTok.length >= 2 && term.includes(qTok)) best = Math.max(best, 55);
    }
    for (const word of words) {
      if (word === qTok) best = Math.max(best, 95);
      else if (word.startsWith(qTok)) best = Math.max(best, 80);
      else if (qTok.length >= 3) {
        const maxDist = qTok.length <= 4 ? 1 : 2;
        if (Math.abs(word.length - qTok.length) <= maxDist) {
          const dist = damerauDistance(qTok, word);
          if (dist <= maxDist) best = Math.max(best, 44 - dist * 10);
        }
      }
    }
    if (best === 0) return null;
    tokenSum += best;
  }

  return wholeBonus + Math.round(tokenSum / qTokens.length) + (option.boost ?? 0);
}

function findExactEntry(phrase: string, entries: readonly CatalogEntry[]): CatalogEntry | undefined {
  const norm = normalizeForFuzzy(phrase);
  if (!norm) return undefined;
  return entries.find(entry => entry.terms.includes(norm));
}

function isExactAliasOrTermSplit(
  phrase: string,
  index: CatalogIndex,
): boolean {
  const norm = normalizeForFuzzy(phrase);
  if (!norm) return false;
  if (index.efforts.some(e => e.terms.includes(norm))) return true;
  const words = norm.split(' ').filter(Boolean);
  for (let k = 1; k < words.length; k++) {
    const left = words.slice(0, k).join(' ');
    const right = words.slice(k).join(' ');
    const effortLeft = index.efforts.some(e => e.terms.includes(left));
    const eqRight = index.equipment.some(e => e.terms.includes(right));
    if (effortLeft && eqRight) return true;
    const eqLeft = index.equipment.some(e => e.terms.includes(left));
    const effortRight = index.efforts.some(e => e.terms.includes(right));
    if (eqLeft && effortRight) return true;
  }
  return false;
}

function appendCreateEffortOption(
  pool: Completion[],
  typedPhrase: string,
  onCreateEffort?: (raw: string) => void | Promise<void>,
  suppressCreate = false,
): Completion[] {
  if (!onCreateEffort || suppressCreate) return pool;
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

function isUnitOrQualifierFragment(context: CompletionContext, fragment: SyntaxNode, units: UnitSet): boolean {
  if (fragment.firstChild?.name !== 'Effort') return false;
  const raw = context.state.doc.sliceString(fragment.from, fragment.to).trim();
  return units.has(raw) || COUNT_QUALIFIER_WORDS.test(raw);
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
  while (firstEffort < run.length && isUnitOrQualifierFragment(context, run[firstEffort], units)) firstEffort++;
  return run.slice(firstEffort);
}

/** Detect unparenthesized rep ladders ending at `nodes[qtyIdx]` (`9-7` or `9-7-5`). */
function detectRepLadder(
  context: CompletionContext,
  nodes: readonly SyntaxNode[],
  qtyIdx: number,
): { isLadder: boolean; rungCount: number } {
  if (qtyIdx < 2 || nodes[qtyIdx]?.firstChild?.name !== 'Quantity') {
    return { isLadder: false, rungCount: 1 };
  }
  const qtyText = context.state.doc.sliceString(nodes[qtyIdx].from, nodes[qtyIdx].to);
  if (!/^\d+$/.test(qtyText)) return { isLadder: false, rungCount: 1 };

  let rungCount = 1;
  let j = qtyIdx;
  while (
    j >= 2 &&
    nodes[j - 1].firstChild?.name === 'Effort' &&
    context.state.doc.sliceString(nodes[j - 1].from, nodes[j - 1].to) === '-' &&
    nodes[j].from === nodes[j - 1].to &&
    nodes[j - 2].firstChild?.name === 'Quantity' &&
    nodes[j - 1].from === nodes[j - 2].to &&
    /^\d+$/.test(context.state.doc.sliceString(nodes[j - 2].from, nodes[j - 2].to))
  ) {
    rungCount++;
    j -= 2;
  }
  return { isLadder: rungCount >= 2, rungCount };
}

interface LineElementSummary {
  readonly hasRounds: boolean;
  readonly hasEffort: boolean;
  readonly hasEquipment: boolean;
}

function analyzeStatementBefore(
  context: CompletionContext,
  nodes: readonly SyntaxNode[],
  uptoEnd: number,
  index: CatalogIndex,
  units: UnitSet,
): LineElementSummary {
  let hasRounds = false;
  let hasEffort = false;
  let hasEquipment = false;
  const wordChunks: string[] = [];

  for (let i = 0; i < uptoEnd; i++) {
    const frag = nodes[i];
    const kind = frag.firstChild?.name;
    if (kind === 'Rounds' || kind === 'RoundScheme') {
      hasRounds = true;
      continue;
    }
    if (kind === 'Quantity') {
      if (detectRepLadder(context, nodes, i).isLadder) hasRounds = true;
      continue;
    }
    if (kind === 'Effort') {
      const raw = context.state.doc.sliceString(frag.from, frag.to).trim();
      if (raw === '-' || raw === '/' || raw === '|') continue;
      if (ROUNDS_QUALIFIER_WORDS.test(raw)) {
        hasRounds = true;
        continue;
      }
      if (COUNT_QUALIFIER_WORDS.test(raw) || units.has(raw)) continue;
      wordChunks.push(raw);
    }
  }

  if (wordChunks.length > 0) {
    const phrase = wordChunks.join(' ');
    const norm = normalizeForFuzzy(phrase);
    const exactEq = findExactEntry(phrase, index.equipment);
    const exactEff = findExactEntry(phrase, index.efforts);
    if (exactEq && !exactEff) {
      hasEquipment = true;
    } else if (exactEff) {
      hasEffort = true;
      // Only treat the line as already naming explicit equipment when an
      // equipment word is literally present in the authored text (`Kettlebell Snatch`),
      // not merely because `Snatch` has default equipment in its definition.
      const eqWords = exactEff.equipmentSlugs.some(slug => {
        const label = index.equipmentLabelBySlug.get(slug);
        return label ? norm.includes(normalizeForFuzzy(label)) : false;
      });
      if (eqWords) hasEquipment = true;
    } else if (isExactAliasOrTermSplit(phrase, index)) {
      hasEffort = true;
      hasEquipment = true;
    } else {
      hasEffort = true;
    }
  }

  return { hasRounds, hasEffort, hasEquipment };
}

function phraseHasExplicitEquipment(phrase: string, index: CatalogIndex): boolean {
  const norm = normalizeForFuzzy(phrase);
  if (!norm) return false;
  const words = norm.split(' ').filter(Boolean);
  for (let k = 1; k < words.length; k++) {
    const left = words.slice(0, k).join(' ');
    const right = words.slice(k).join(' ');
    if (index.efforts.some(e => e.terms.includes(left)) && index.equipment.some(e => e.terms.includes(right))) {
      return true;
    }
    if (index.equipment.some(e => e.terms.includes(left)) && index.efforts.some(e => e.terms.includes(right))) {
      return true;
    }
  }
  const exactEq = findExactEntry(phrase, index.equipment);
  if (!exactEq) {
    for (let k = 1; k < words.length; k++) {
      const left = words.slice(0, k).join(' ');
      const right = words.slice(k).join(' ');
      if (index.equipment.some(e => e.terms.includes(right)) && !index.equipment.some(e => e.terms.includes(left))) {
        return true;
      }
    }
  }
  const exactEff = findExactEntry(phrase, index.efforts);
  if (!exactEff) return false;
  return exactEff.equipmentSlugs.some(slug => {
    const label = index.equipmentLabelBySlug.get(slug);
    if (label && norm.includes(normalizeForFuzzy(label))) return true;
    const eqEntry = index.equipment.find(eq => eq.equipmentSlugs[0] === slug);
    return eqEntry ? eqEntry.terms.some(t => t.length >= 2 && words.includes(t)) : false;
  });
}

function specializedEffortsForBase(phrase: string, index: CatalogIndex): Completion[] {
  const normBase = normalizeForFuzzy(phrase);
  const baseWords = normBase.split(' ').filter(Boolean);
  if (baseWords.length === 0) return [];
  const exactCurrent = findExactEntry(phrase, index.efforts);
  const results: Completion[] = [];
  for (const entry of index.efforts) {
    if (entry.labelLower === phrase.toLowerCase()) continue;
    if (exactCurrent && entry.labelLower === exactCurrent.labelLower) continue;
    const matchesAllWords = baseWords.every(w => entry.words.includes(w) || entry.terms.some(t => t.includes(w)));
    if (!matchesAllWords) continue;
    const eqNames = entry.equipmentSlugs
      .map(slug => index.equipmentLabelBySlug.get(slug))
      .filter((name): name is string => Boolean(name));
    const detail = eqNames.length > 0
      ? `${entry.completion.detail ?? 'effort'} · ${eqNames.join(', ')}`
      : entry.completion.detail;
    results.push({
      ...entry.completion,
      detail,
      boost: clampBoost((entry.option.boost ?? 0) + 18),
      apply: (view, _completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: entry.label },
          selection: { anchor: from + entry.label.length },
          userEvent: 'input.complete',
        });
      },
    });
  }
  return results;
}

function specializedEffortsForEquipment(eqEntry: CatalogEntry, index: CatalogIndex): Completion[] {
  const eqSlug = eqEntry.equipmentSlugs[0];
  const results: Completion[] = [];
  for (const entry of index.efforts) {
    const usesEq = entry.equipmentSlugs.includes(eqSlug)
      || eqEntry.terms.some(t => t.length >= 2 && entry.words.includes(t));
    if (!usesEq) continue;
    results.push({
      ...entry.completion,
      boost: clampBoost((entry.option.boost ?? 0) + 20),
      apply: (view, _completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: entry.label },
          selection: { anchor: from + entry.label.length },
          userEvent: 'input.complete',
        });
      },
    });
  }
  return results;
}

function inNode(context: CompletionContext, names: ReadonlySet<string>): boolean {
  for (let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent) {
    if (names.has(node.name)) return true;
  }
  return false;
}

const ALWAYS_SUPPRESSED_NODES: ReadonlySet<string> = new Set(['Text', 'textComment', 'MetricObject']);
const HEADING_NODES: ReadonlySet<string> = new Set(['Heading', 'heading']);

function completeParenthesizedRounds(before: string, pos: number): CompletionResult | null | undefined {
  if (!/\([^)\n]*$/.test(before)) return undefined;
  const openIdx = before.lastIndexOf('(');
  const inner = before.slice(openIdx + 1);
  if (inner.includes('-')) return null;
  const m = /^(\s*)(\d+)([ \t]*)([A-Za-z]*)$/.exec(inner);
  if (!m) return null;

  const hasSpace = m[3].length > 0;
  const typedWord = m[4];
  const lead = hasSpace ? '' : ' ';
  const wordFrom = pos - typedWord.length;

  const makeParenApply = (word: string) => (view: Parameters<Exclude<Completion['apply'], string | undefined>>[0], _c: Completion, from: number, to: number) => {
    const hasClose = view.state.doc.sliceString(to, to + 1) === ')';
    const insert = `${lead}${word}${hasClose ? '' : ')'}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length + (hasClose ? 1 : 0) },
      userEvent: 'input.complete',
    });
  };

  const options: Completion[] = [
    {
      label: 'rounds',
      detail: 'rounds',
      type: 'unit',
      section: COMPLETION_SECTIONS.units,
      boost: 45,
      apply: makeParenApply('rounds'),
    },
    {
      label: 'reps',
      detail: 'count',
      type: 'unit',
      section: COMPLETION_SECTIONS.units,
      boost: 40,
      apply: makeParenApply('reps'),
    },
  ];
  completionAliases.set(options[0], ['round', 'rd', 'rds', 'set', 'sets']);
  completionAliases.set(options[1], ['rep']);

  if (typedWord.length > 0) {
    const scored = options
      .map(opt => ({ opt, score: scoreCompletionOption(typedWord, opt) }))
      .filter((x): x is { opt: Completion; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(x => x.opt);
    return scored.length > 0 ? { from: wordFrom, options: scored, filter: false } : null;
  }

  return {
    from: wordFrom,
    options,
    validFor: /^[A-Za-z]*$/,
  };
}

/**
 * Syntax-aware Whiteboard Script completion source.
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

    // Tag reference: `#` or `#partial` — checked BEFORE `HEADING_NODES`.
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
      const restTag = /^[A-Za-z0-9-]*/.exec(line.text.slice(pos - line.from))![0];
      if (restTag.length > 0) {
        const lower = word.toLowerCase();
        const filteredTags = tagOptions.filter(opt => {
          if (opt.type === 'create') return true;
          const applyLower = typeof opt.apply === 'string' ? opt.apply.toLowerCase() : '';
          return opt.label.toLowerCase().includes(lower) || applyLower.includes(lower);
        });
        return filteredTags.length > 0
          ? {
              from: pos - word.length,
              to: pos + restTag.length,
              options: filteredTags,
              filter: false,
            }
          : null;
      }
      return {
        from: pos - word.length,
        options: tagOptions,
        validFor: /^[A-Za-z0-9-]*$/,
      };
    }

    if (inNode(context, HEADING_NODES)) return null;

    const parenResult = completeParenthesizedRounds(before, pos);
    if (parenResult !== undefined) return parenResult;

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

    const rawEfforts = options.efforts ? await options.efforts() : [];
    const rawEquipment = options.equipment ? await options.equipment() : [];
    const catalog = buildCatalogIndex(rawEfforts, rawEquipment);

    const efforts = catalog.efforts.map(e => e.completion);
    const equipmentOpts = catalog.equipment.map(e => e.completion);
    const missingLineElements = [...efforts, ...equipmentOpts, ...sportWords];

    // Property key / statement-start single word: snippets, keywords, efforts, equipment, dialect, properties.
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
        ...equipmentOpts,
        ...sportWords,
        ...propertyOptions,
      ];
      const typedRaw = before.trimStart();
      const typedStart = typedRaw.toLowerCase();

      const hasSubstringOrPrefix = allStartOptions.some(opt => {
        const m = completionMatchesWord(opt, typedStart);
        return m === 'prefix' || m === 'word';
      });
      const fuzzyEfforts = catalog.efforts
        .map(e => ({ opt: e.completion, score: scoreCatalogEntry(typedRaw, e) }))
        .filter((x): x is { opt: Completion; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score);
      const fuzzyEquipment = catalog.equipment
        .map(e => ({ opt: e.completion, score: scoreCatalogEntry(typedRaw, e) }))
        .filter((x): x is { opt: Completion; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score);
      const restWord = /^[A-Za-z0-9-]*/.exec(line.text.slice(pos - line.from))![0];
      const hasAliasOrFuzzyOnly =
        (fuzzyEfforts.length > 0 || fuzzyEquipment.length > 0) &&
        (!hasSubstringOrPrefix || (typedStart.length >= 2 && fuzzyEfforts.some(e => completionMatchesWord(e.opt, typedStart) === 'alias')));

      if (hasAliasOrFuzzyOnly || restWord.length > 0) {
        const otherMatched = [...snippets, ...startKeywords, ...sportWords, ...propertyOptions]
          .filter(opt => scoreCompletionOption(typedRaw, opt) !== null);
        const matched = [
          ...otherMatched,
          ...fuzzyEfforts.map(x => x.opt),
          ...fuzzyEquipment.map(x => x.opt),
        ];
        const suppressCreate = isExactAliasOrTermSplit(typedRaw, catalog);
        return {
          from: pos - typedRaw.length,
          ...(restWord.length > 0 ? { to: pos + restWord.length } : {}),
          options: appendCreateEffortOption(matched, typedRaw, options.onCreateEffort, suppressCreate),
          filter: false,
        };
      }
      return {
        from: pos - typedRaw.length,
        options: appendCreateEffortOption(allStartOptions, typedRaw, options.onCreateEffort, isExactAliasOrTermSplit(typedRaw, catalog)),
        validFor: /^[A-Za-z]*$/,
      };
    }

    // Quantity slot & syntax-aware number completions.
    const nodes = statement?.name === 'Block' ? statement.getChildren('Fragment') : [];
    let end = nodes.length;
    while (end > 0 && nodes[end - 1].from >= pos) end--;
    const last = nodes[end - 1];
    const completingWord = last?.firstChild?.name === 'Effort' && last.from < pos && pos <= last.to;
    const qtyIdx = completingWord ? end - 2 : end - 1;
    const quantityFragment = qtyIdx >= 0 ? nodes[qtyIdx] : undefined;
    const quantity = quantityFragment?.firstChild?.name === 'Quantity' ? quantityFragment.firstChild : null;
    const incompleteAction = statement?.name === 'Block' && statement.getChildren('Fragment').some(fragment =>
      fragment.firstChild?.name === 'Action'
      && fragment.from < (quantity?.from ?? pos)
      && !context.state.doc.sliceString(fragment.from, fragment.to).includes(':')
    );

    if (quantity && !incompleteAction) {
      const hasAtSign = Boolean(quantity.getChild('AtSign'));
      const rawQty = context.state.doc.sliceString(quantity.from, quantity.to);
      const isWholeInteger = !hasAtSign && /^\d+$/.test(rawQty);
      const isWildcard = !hasAtSign && rawQty === '?';
      const isGlued = completingWord ? last.from === quantityFragment!.to : pos === quantityFragment!.to;
      const hasTrailingSpace = !completingWord && pos > quantityFragment!.to && /[ \t]$/.test(before);
      const ladder = !hasAtSign ? detectRepLadder(context, nodes, qtyIdx) : { isLadder: false, rungCount: 1 };
      const prefixLine = analyzeStatementBefore(context, nodes, qtyIdx, catalog, units);

      const preferredSet = new Set(
        (options.preferredUnits?.() ?? []).map(u => u.toLowerCase()),
      );

      // 1) @Quantity — always mass units ONLY (glued or spaced).
      if (hasAtSign) {
        const massPool = unitCompletions(units, 'mass', preferredSet.size > 0 ? preferredSet : undefined);
        const wordText = completingWord ? context.state.doc.sliceString(last.from, pos) : '';
        if (completingWord && (last.to > pos || wordText.length >= 2)) {
          const hasAlias = massPool.some(opt => completionMatchesWord(opt, wordText.toLowerCase()) === 'alias');
          if (hasAlias || last.to > pos) {
            return {
              from: last.from,
              ...(last.to > pos ? { to: last.to } : {}),
              options: massPool.filter(opt => scoreCompletionOption(wordText, opt) !== null),
              filter: false,
            };
          }
        }
        return {
          from: completingWord ? last.from : pos,
          options: massPool,
          validFor: /^[A-Za-z]*$/,
        };
      }

      // 2) Rep ladder (`9-7` / `9-7-5`): syntax-aware `reps` (no `rounds`, no kg/lb/m).
      if (ladder.isLadder) {
        const ladderDetail = ladder.rungCount >= 3 ? `rep scheme (${ladder.rungCount} rounds)` : 'rep scheme';
        const ladderReps = makeCountQualifiers(false, isGlued, ladderDetail);
        if (hasTrailingSpace) {
          return {
            from: pos,
            options: [
              ...missingLineElements,
              ...keywords.filter(k => k.label === 'FOR TIME'),
            ],
          };
        }
        if (completingWord) {
          const wordText = context.state.doc.sliceString(last.from, pos);
          const pool = isGlued
            ? ladderReps
            : [...(isGlued ? [] : makeCountQualifiers(false, false, ladderDetail)), ...missingLineElements, ...keywords.filter(k => k.label === 'FOR TIME')];
          const matched = scorePhrasePool(wordText, pool, catalog, options.onCreateEffort, !isGlued);
          return matched.length > 0
            ? {
                from: last.from,
                ...(last.to > pos ? { to: last.to } : {}),
                options: matched,
                filter: false,
              }
            : null;
        }
        return {
          from: pos,
          options: ladderReps,
          validFor: /^[A-Za-z]*$/,
        };
      }

      // 3) Glued bare number (`10`, `3`, `10r`, `3ro`, `42.5`, `?`) -> reps / rounds + units.
      if (isGlued) {
        const countOpts = (isWholeInteger || isWildcard)
          ? makeCountQualifiers(isWholeInteger && !prefixLine.hasRounds, true)
          : [];
        const unitPool = [
          ...countOpts,
          ...unitCompletions(units, undefined, preferredSet.size > 0 ? preferredSet : undefined),
        ];
        if (completingWord) {
          const wordText = context.state.doc.sliceString(last.from, pos);
          const hasAliasHit = unitPool.some(opt => completionMatchesWord(opt, wordText.toLowerCase()) === 'alias');
          if (hasAliasHit || last.to > pos) {
            return {
              from: last.from,
              ...(last.to > pos ? { to: last.to } : {}),
              options: unitPool.filter(opt => scoreCompletionOption(wordText, opt) !== null),
              filter: false,
            };
          }
        }
        return {
          from: completingWord ? last.from : pos,
          options: unitPool,
          validFor: /^[A-Za-z]*$/,
        };
      }

      // 4) Space clicked after number without selecting a unit (`10 `) -> offer remaining missing line elements.
      if (hasTrailingSpace) {
        if (!prefixLine.hasEffort) {
          return missingLineElements.length > 0 ? { from: pos, options: missingLineElements } : null;
        }
        if (!prefixLine.hasEquipment) {
          return equipmentOpts.length > 0 ? { from: pos, options: equipmentOpts } : null;
        }
        return null;
      }

      // 5) Space + typing a word after a number (`10 Push`, `100 kilo`, `10 snacth`, `10 KB`, `10 rep`).
      if (completingWord) {
        const wordText = context.state.doc.sliceString(last.from, pos);
        const unitCandidates = [
          ...((isWholeInteger || isWildcard) ? makeCountQualifiers(isWholeInteger && !prefixLine.hasRounds, false) : []),
          ...unitCompletions(units, undefined, preferredSet.size > 0 ? preferredSet : undefined),
        ];
        const matchingUnits = unitCandidates.filter(opt => {
          const norm = normalizeForFuzzy(wordText);
          const labelLower = opt.label.toLowerCase();
          const aliases = completionAliases.get(opt) ?? [];
          return labelLower.startsWith(norm) || aliases.some(a => a.startsWith(norm));
        });
        const elementPool = prefixLine.hasEffort && !prefixLine.hasEquipment
          ? equipmentOpts
          : prefixLine.hasEffort
            ? []
            : missingLineElements;
        const effortMatches = scoreCatalogList(wordText, prefixLine.hasEffort ? [] : catalog.efforts);
        const equipmentMatches = scoreCatalogList(wordText, prefixLine.hasEquipment ? [] : catalog.equipment);
        const sportMatches = (!prefixLine.hasEffort ? sportWords : [])
          .map(opt => ({ opt, score: scoreCompletionOption(wordText, opt) }))
          .filter((x): x is { opt: Completion; score: number } => x.score !== null)
          .sort((a, b) => b.score - a.score)
          .map(x => x.opt);

        const combined = [
          ...matchingUnits,
          ...effortMatches.map(x => x.opt),
          ...equipmentMatches.map(x => x.opt),
          ...sportMatches,
        ];
        const hasAliasHit = elementPool.some(opt => completionMatchesWord(opt, wordText.toLowerCase()) === 'alias')
          || matchingUnits.length > 0
          || (effortMatches.length + equipmentMatches.length > 0);
        const suppressCreate = isExactAliasOrTermSplit(wordText, catalog);
        return hasAliasHit || combined.length > 0 || (options.onCreateEffort && !prefixLine.hasEffort)
          ? {
              from: last.from,
              ...(last.to > pos ? { to: last.to } : {}),
              options: !prefixLine.hasEffort
                ? appendCreateEffortOption(combined, wordText, options.onCreateEffort, suppressCreate)
                : combined,
              filter: false,
            }
          : null;
      }
    }

    // Empty statement: structures, keywords, catalog efforts, equipment, dialect words.
    if (before.trim() === '') {
      return { from: pos, options: [...snippets, ...startKeywords, ...efforts, ...equipmentOpts, ...sportWords] };
    }

    const effortRun = trailingEffortRun(context, statement, units);

    // Whitespace after fragments (`10:00 `, `10 kg `, `10 reps `, `10 Snatch `, `10 Kettlebell `, `5x5 `).
    if (word.length === 0 && /[ \t]$/.test(before)) {
      if (effortRun.length === 0) {
        return { from: pos, options: [...keywords, ...missingLineElements] };
      }
      const runFirst = effortRun[0];
      const runLast = effortRun[effortRun.length - 1];
      const phraseFrom = runFirst.from;
      const phraseText = context.state.doc.sliceString(phraseFrom, runLast.to).trim();

      // Already resolved as both effort + explicit equipment (`Snatch Kettlebell `, `Walking Weight Vest `).
      if (phraseHasExplicitEquipment(phraseText, catalog)) return null;

      // Trailing phrase is an exact equipment (`Kettlebell `, `Weight Vest `).
      const exactEq = findExactEntry(phraseText, catalog.equipment);
      if (exactEq) {
        const dedicated = specializedEffortsForEquipment(exactEq, catalog);
        const dedicatedLabels = new Set(dedicated.map(d => d.label.toLowerCase()));
        const appendedEfforts = catalog.efforts
          .filter(e => !dedicatedLabels.has(e.labelLower))
          .map(e => ({
            ...e.completion,
            apply: (view: Parameters<Exclude<Completion['apply'], string | undefined>>[0], _c: Completion, from: number, to: number) => {
              const existing = view.state.doc.sliceString(from, to);
              const insert = `${existing}${e.label}`;
              view.dispatch({
                changes: { from, to, insert },
                selection: { anchor: from + insert.length },
                userEvent: 'input.complete',
              });
            },
          }));
        const allEqOptions = [...dedicated, ...appendedEfforts];
        return allEqOptions.length > 0 ? { from: phraseFrom, options: allEqOptions, filter: false } : null;
      }

      // Trailing phrase is an effort (`Snatch `, `Walking `) without explicit equipment -> offer equipment & specialized efforts.
      const specialized = specializedEffortsForBase(phraseText, catalog);
      const suffixEquipment: Completion[] = catalog.equipment.map(eq => ({
        ...eq.completion,
        apply: (view, _completion, from, to) => {
          const existing = view.state.doc.sliceString(from, to);
          const insert = `${existing}${eq.label}`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
            userEvent: 'input.complete',
          });
        },
      }));
      const combined = [...specialized, ...suffixEquipment];
      return combined.length > 0 ? { from: phraseFrom, options: combined, filter: false } : null;
    }

    // Actively typing word(s) inside an effort / equipment phrase (`10 Snatch KB`, `10 Walking weight v`, `10 Weight Vest wal`).
    if (word.length > 0 && /^[A-Za-z][A-Za-z0-9'-]*$/.test(word)) {
      if (effortRun.length === 0) return null;
      const phraseFrom = effortRun[0].from;
      const runLast = effortRun[effortRun.length - 1];
      if (runLast.to < pos) return null;

      const rawPhrase = context.state.doc.sliceString(phraseFrom, pos);
      const isSingleWord = effortRun.length === 1;

      const scoredOptions: Array<{ option: Completion; score: number }> = [];
      const seenOutcome = new Set<string>();

      const pushScored = (option: Completion, score: number, outcomeKey: string) => {
        if (seenOutcome.has(outcomeKey)) return;
        seenOutcome.add(outcomeKey);
        scoredOptions.push({ option, score });
      };

      // Strategy 1: whole-phrase fuzzy / order-independent / equipment-aware match (replaces phraseFrom..pos).
      const strategy1Efforts = scoreCatalogList(rawPhrase, catalog.efforts);
      for (const { entry, opt, score } of strategy1Efforts) {
        const eqLabels = entry.equipmentSlugs
          .map(slug => catalog.equipmentLabelBySlug.get(slug))
          .filter((lbl): lbl is string => Boolean(lbl));
        const multiTokenUpgrade = !isSingleWord && eqLabels.length > 0;
        const upgradedDetail = multiTokenUpgrade && !(opt.detail ?? '').toLowerCase().includes(eqLabels[0].toLowerCase())
          ? `${opt.detail ?? 'effort'} · includes ${eqLabels.join(', ')}`
          : opt.detail;
        pushScored(
          {
            ...opt,
            detail: upgradedDetail,
            boost: clampBoost(Math.min(75, Math.round(score / 4)) + (multiTokenUpgrade ? 10 : 0)),
            apply: (view, _completion, from, to) => {
              view.dispatch({
                changes: { from, to, insert: entry.label },
                selection: { anchor: from + entry.label.length },
                userEvent: 'input.complete',
              });
            },
          },
          score + (multiTokenUpgrade ? 25 : 0),
          `whole:${entry.labelLower}`,
        );
      }

      if (isSingleWord) {
        for (const { entry, opt, score } of scoreCatalogList(rawPhrase, catalog.equipment)) {
          pushScored(
            {
              ...opt,
              boost: clampBoost(Math.min(70, Math.round(score / 4))),
              apply: (view, _completion, from, to) => {
                view.dispatch({
                  changes: { from, to, insert: entry.label },
                  selection: { anchor: from + entry.label.length },
                  userEvent: 'input.complete',
                });
              },
            },
            score,
            `eq-whole:${entry.labelLower}`,
          );
        }
        for (const kw of [...keywords, ...sportWords]) {
          const s = scoreCompletionOption(rawPhrase, kw);
          if (s !== null) pushScored(kw, s, `kw:${kw.label.toLowerCase()}`);
        }
      } else {
        // Strategy 2 (Effort prefix + Equipment suffix) & Strategy 3 (Equipment prefix + Effort suffix).
        for (let k = 1; k < effortRun.length; k++) {
          const prefixText = context.state.doc.sliceString(phraseFrom, effortRun[k - 1].to).trim();
          const suffixFrom = effortRun[k].from;
          const suffixText = context.state.doc.sliceString(suffixFrom, pos).trim();
          if (!prefixText || !suffixText) continue;

          const suffixDelta = suffixFrom - phraseFrom;
          const prefixIsEq = findExactEntry(prefixText, catalog.equipment);
          const prefixIsEff = findExactEntry(prefixText, catalog.efforts);

          // Strategy 3: Equipment prefix + trailing Effort (e.g. `Weight Vest wal`, `Kettlebell sna`).
          if (prefixIsEq) {
            for (const { entry, opt, score } of scoreCatalogList(suffixText, catalog.efforts)) {
              if (seenOutcome.has(`whole:${entry.labelLower}`)) continue;
              if (normalizeForFuzzy(entry.label).includes(normalizeForFuzzy(prefixIsEq.label))) continue;
              const resultingText = `${prefixText} ${entry.label}`.toLowerCase();
              if (seenOutcome.has(`whole:${resultingText}`)) continue;
              // Skip base effort `Snatch` after `Kettlebell` if dedicated `Kettlebell Snatch` already matched with same output.
              const dedicatedEqText = `${prefixIsEq.label} ${entry.label}`.toLowerCase();
              if (seenOutcome.has(`whole:${dedicatedEqText}`)) continue;
              pushScored(
                {
                  ...opt,
                  boost: clampBoost(Math.min(72, Math.round(score / 4))),
                  apply: (view, _completion, from, to) => {
                    view.dispatch({
                      changes: { from: from + suffixDelta, to, insert: entry.label },
                      selection: { anchor: from + suffixDelta + entry.label.length },
                      userEvent: 'input.complete',
                    });
                  },
                },
                score,
                `eq-prefix-eff:${entry.labelLower}:${suffixDelta}`,
              );
            }
          }

          // Strategy 2: Effort prefix + trailing Equipment (e.g. `Snatch KB`, `Walking weight v`).
          const allowEquipmentSuffix =
            Boolean(prefixIsEff) ||
            (!prefixIsEq && suffixText.length >= 2 && (strategy1Efforts.length === 0 || scoreCatalogList(suffixText, catalog.equipment).some(m => m.score >= 70)));
          if (allowEquipmentSuffix && !prefixIsEq) {
            for (const { entry, opt, score } of scoreCatalogList(suffixText, catalog.equipment)) {
              pushScored(
                {
                  ...opt,
                  detail: opt.detail ?? 'Equipment',
                  boost: clampBoost(Math.min(70, Math.round(score / 4))),
                  apply: (view, _completion, from, to) => {
                    view.dispatch({
                      changes: { from: from + suffixDelta, to, insert: entry.label },
                      selection: { anchor: from + suffixDelta + entry.label.length },
                      userEvent: 'input.complete',
                    });
                  },
                },
                score,
                `eff-prefix-eq:${entry.labelLower}:${suffixDelta}`,
              );
            }
          }
        }
      }

      scoredOptions.sort((a, b) => b.score - a.score);
      const finalOptions = scoredOptions.map(x => x.option);
      const suppressCreate = isExactAliasOrTermSplit(rawPhrase, catalog);
      const withCreate = appendCreateEffortOption(finalOptions, rawPhrase, options.onCreateEffort, suppressCreate);
      if (withCreate.length === 0) return null;
      return {
        from: phraseFrom,
        ...(runLast.to > pos ? { to: runLast.to } : {}),
        options: withCreate,
        filter: false,
      };
    }

    return null;
  };
}

function scoreCatalogList(
  query: string,
  entries: readonly CatalogEntry[],
): Array<{ entry: CatalogEntry; opt: Completion; score: number }> {
  const scored: Array<{ entry: CatalogEntry; opt: Completion; score: number }> = [];
  for (const entry of entries) {
    const score = scoreCatalogEntry(query, entry);
    if (score !== null) scored.push({ entry, opt: entry.completion, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function scorePhrasePool(
  query: string,
  pool: readonly Completion[],
  catalog: CatalogIndex,
  onCreateEffort?: (raw: string) => void | Promise<void>,
  allowCreate = true,
): Completion[] {
  const scored: Array<{ opt: Completion; score: number }> = [];
  const effortMap = new Map(catalog.efforts.map(e => [e.completion, e]));
  const eqMap = new Map(catalog.equipment.map(e => [e.completion, e]));
  for (const opt of pool) {
    const eff = effortMap.get(opt);
    const eq = eqMap.get(opt);
    const score = eff
      ? scoreCatalogEntry(query, eff)
      : eq
        ? scoreCatalogEntry(query, eq)
        : scoreCompletionOption(query, opt);
    if (score !== null) scored.push({ opt, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const res = scored.map(x => x.opt);
  return allowCreate
    ? appendCreateEffortOption(res, query, onCreateEffort, isExactAliasOrTermSplit(query, catalog))
    : res;
}

/**
 * Standalone autocomplete extension for Whiteboard Script — `autocompletion`
 * overridden to the syntax-aware source. Use {@link whiteboardScriptCompletionSource}
 * instead when composing with other completion sources.
 */
export function whiteboardScriptCompletion(options: WhiteboardScriptCompletionOptions = {}): Extension {
  return autocompletion({ override: [whiteboardScriptCompletionSource(options)] });
}
