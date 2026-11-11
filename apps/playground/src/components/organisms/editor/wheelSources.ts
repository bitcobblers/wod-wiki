/**
 * wheelSources — Context-aware horizontal slot model and vertical scroll-wheel
 * drum definitions for MobileWheelComposer.
 *
 * Strictly uses Notebooks and Tags (active frontmatter tags, notebook landing
 * note tags/frontmatter, and ReferenceResolutionDefaults) to scope domain
 * suggestions. Never inspects or emits `:sport` qualifiers.
 */

import type { EditorState } from "@codemirror/state";
import { activeCursorSection, sectionField } from "@bitcobblers/wod-wiki-ui/extensions";
import {
  ChoiceGroupMetric,
  MetricType,
  TAG_MARKER_PREFIX,
  type IMetric,
} from "@bitcobblers/wod-wiki-engine";
import { getReferenceMetadata, getTagReference } from "@bitcobblers/wod-wiki-core";
import type { IEffort, IEquipment } from "@bitcobblers/wod-wiki-lang";
import { parseFrontmatter } from "@bitcobblers/wod-wiki-wql";
import { getCursorFocusState } from "@/app/editor/cursorFocusExtension";
import { resolveNotePropertyStack } from "@/app/editor/runtimeTimerModel";
import { readNoteReferenceDefaults } from "@/app/editor/noteEditorServices";
import {
  getAppEffortRegistry,
  getAppEquipmentRegistry,
  getTagIndex,
  storageService,
} from "@/hooks/useBrowserServices";

export type WheelContextKind = "workout" | "markdown" | "query";

export type WheelSlotKind =
  | "metric"
  | "add-metric"
  | "markdown-group"
  | "query-stage";

export interface WheelDrumOption {
  id: string;
  label: string;
  sublabel?: string;
  value: string;
}

export interface WheelDrumSpec {
  id: string;
  label: string;
  options: WheelDrumOption[];
  selectedValue: string;
}

export interface WheelSlot {
  id: string;
  kind: WheelSlotKind;
  label: string;
  metricType?: string;
  from: number;
  to: number;
  rawText: string;
}

export interface WheelComposerModel {
  context: WheelContextKind;
  lineNumber: number;
  lineFrom: number;
  lineTo: number;
  slots: WheelSlot[];
  activeSlotIndex: number;
  drums: WheelDrumSpec[];
}

export interface NotebookScopeSnapshot {
  notebookId?: string;
  notebookSlug?: string;
  tags: string[];
  defaultEffort?: string;
  defaultEquipment: string[];
  preferredMassUnit?: string;
  preferredDistanceUnit?: string;
  customMetricTypes: Array<{ type: string; starterValue: string }>;
}

const MINUTE_OPTIONS: WheelDrumOption[] = Array.from({ length: 61 }, (_, m) => ({
  id: `min-${m}`,
  label: `${m}m`,
  value: String(m),
}));

const SECOND_VALUES = ["00", "05", "10", "15", "20", "30", "45"];
const SECOND_OPTIONS: WheelDrumOption[] = SECOND_VALUES.map((s) => ({
  id: `sec-${s}`,
  label: `${s}s`,
  value: s,
}));

const REP_OPTIONS: WheelDrumOption[] = [
  ...["21-15-9", "15-12-9", "12-9-6", "10-8-6-4-2", "5-5-5-5-5"].map((scheme) => ({
    id: `scheme-${scheme}`,
    label: scheme,
    sublabel: "Scheme",
    value: scheme,
  })),
  ...Array.from({ length: 50 }, (_, idx) => {
    const count = String(idx + 1);
    return {
      id: `rep-${count}`,
      label: count,
      value: count,
    };
  }),
  ...["60", "75", "100"].map((count) => ({
    id: `rep-${count}`,
    label: count,
    value: count,
  })),
];

const ROUNDS_OPTIONS: WheelDrumOption[] = Array.from({ length: 12 }, (_, idx) => {
  const n = idx + 1;
  const token = `(${n})`;
  return {
    id: `rounds-${n}`,
    label: `${n} ${n === 1 ? "round" : "rounds"}`,
    sublabel: token,
    value: token,
  };
});

const WEIGHT_AMOUNTS = [
  "5", "7.5", "10", "12", "15", "16", "20", "22.5", "24", "25", "30", "32",
  "35", "40", "42.5", "45", "50", "52.5", "60", "65", "70", "75", "80", "85",
  "90", "95", "100", "105", "115", "120", "135", "140", "155", "160", "185",
  "205", "225", "245", "275", "315",
];

const DISTANCE_AMOUNTS = [
  "10", "15", "20", "25", "30", "40", "50", "75", "100", "150", "200", "250",
  "300", "400", "500", "600", "800", "1000", "1200", "1600", "2000", "5000",
  "1", "1.5", "2", "3", "5", "10",
];

const DEFAULT_MASS_UNITS = ["kg", "lb", "pood", "%"];
const DEFAULT_DISTANCE_UNITS = ["m", "km", "cal", "ft", "mi", "yd"];

const ACTION_OPTIONS: WheelDrumOption[] = [
  { id: "act-rest", label: "Rest", sublabel: ":rest", value: ":rest" },
  { id: "act-emom", label: "EMOM", sublabel: "1:00", value: "1:00" },
  { id: "act-buyin", label: "Buy-in", sublabel: "Header", value: "Buy-in:" },
  { id: "act-cashout", label: "Cash-out", sublabel: "Header", value: "Cash-out:" },
];

const FALLBACK_EFFORTS = [
  "Air Squat",
  "Back Squat",
  "Front Squat",
  "Deadlift",
  "Kettlebell Swing",
  "Pull-up",
  "Push-up",
  "Burpee",
  "Thruster",
  "Wall Ball",
  "Box Jump",
  "Row",
  "Run",
  "Double Under",
];

const MARKDOWN_GROUPS: Array<{
  id: string;
  label: string;
  options: WheelDrumOption[];
}> = [
  {
    id: "md-blocks",
    label: "Blocks",
    options: [
      { id: "blk-time", label: "Timer Block", sublabel: "```time", value: "block:time" },
      { id: "blk-log", label: "Log Block", sublabel: "```log", value: "block:log" },
      { id: "blk-query", label: "Query Block", sublabel: "```query", value: "block:query" },
      { id: "blk-table", label: "Table (3x2)", sublabel: "| Col |", value: "block:table" },
      { id: "blk-divider", label: "Divider", sublabel: "---", value: "block:divider" },
    ],
  },
  {
    id: "md-format",
    label: "Format",
    options: [
      { id: "fmt-h1", label: "Heading 1", sublabel: "# Title", value: "prefix:# " },
      { id: "fmt-h2", label: "Heading 2", sublabel: "## Section", value: "prefix:## " },
      { id: "fmt-h3", label: "Heading 3", sublabel: "### Detail", value: "prefix:### " },
      { id: "fmt-quote", label: "Blockquote", sublabel: "> Quote", value: "prefix:> " },
      { id: "fmt-bold", label: "Bold", sublabel: "**text**", value: "wrap:**" },
      { id: "fmt-code", label: "Inline Code", sublabel: "`code`", value: "wrap:`" },
    ],
  },
  {
    id: "md-lists",
    label: "Lists & Links",
    options: [
      { id: "lst-task", label: "Task Checkbox", sublabel: "- [ ]", value: "prefix:- [ ] " },
      { id: "lst-bullet", label: "Bullet Item", sublabel: "- ", value: "prefix:- " },
      { id: "lst-number", label: "Numbered Item", sublabel: "1. ", value: "prefix:1. " },
      { id: "lst-link", label: "External Link", sublabel: "[Label](url)", value: "insert:[Link](https://)" },
      { id: "lst-wiki", label: "Note Link", sublabel: "[[Note]]", value: "insert:[[Note]]" },
    ],
  },
];

const QUERY_STAGES: Array<{
  id: string;
  label: string;
  options: WheelDrumOption[];
}> = [
  {
    id: "wql-metric",
    label: "Query",
    options: [
      { id: "q-reps", label: "Total Reps", sublabel: "sum:reps{}", value: "replace:sum:reps{}" },
      { id: "q-vol", label: "Total Volume", sublabel: "sum:totalVolume{}", value: "replace:sum:totalVolume{}" },
      { id: "q-dur", label: "Total Duration", sublabel: "sum:duration{}", value: "replace:sum:duration{}" },
      { id: "q-sessions", label: "Find Sessions", sublabel: "find session{}", value: "replace:find session{}" },
      { id: "q-notes", label: "Find Notes", sublabel: "find note{}", value: "replace:find note{}" },
    ],
  },
  {
    id: "wql-scope",
    label: "Scope",
    options: [
      { id: "s-note", label: "This Note", sublabel: ":note", value: "append: :note" },
      { id: "s-all", label: "All History", sublabel: "Global", value: "noop:" },
    ],
  },
  {
    id: "wql-window",
    label: "Window",
    options: [
      { id: "w-week", label: "Every Week", sublabel: "every week", value: "append: every week" },
      { id: "w-month", label: "Every Month", sublabel: "every month", value: "append: every month" },
      { id: "w-4w", label: "Last 4 Weeks", sublabel: "last 4w", value: "append: last 4w" },
      { id: "w-12w", label: "Last 12 Weeks", sublabel: "last 12w", value: "append: last 12w" },
    ],
  },
  {
    id: "wql-chart",
    label: "Chart",
    options: [
      { id: "c-bar", label: "Bar Chart", sublabel: "| :bar{}", value: "append: | :bar{}" },
      { id: "c-line", label: "Timeseries", sublabel: "| :timeseries{}", value: "append: | :timeseries{}" },
      { id: "c-table", label: "Table", sublabel: "| :table{}", value: "append: | :table{}" },
    ],
  },
];

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function extractScopeKeywords(scope: NotebookScopeSnapshot, docText: string): Set<string> {
  const keywords = new Set<string>();
  const addWord = (raw?: string) => {
    if (!raw) return;
    const cleaned = normalizeKeyword(raw);
    if (!cleaned) return;
    keywords.add(cleaned);
    for (const part of cleaned.split(/[\s/_-]+/)) {
      if (part.length >= 3) keywords.add(part);
    }
  };

  addWord(scope.notebookSlug);
  for (const tag of scope.tags) addWord(tag);
  addWord(scope.defaultEffort);
  for (const eq of scope.defaultEquipment) addWord(eq);

  const stack = resolveNotePropertyStack(docText);
  for (const tag of stack.activeTags) addWord(tag);

  if (docText.trimStart().startsWith("---")) {
    const { meta } = parseFrontmatter(docText);
    for (const key of ["tags", "domain", "discipline", "category", "equipment", "format", "intent"]) {
      const val = meta[key];
      if (typeof val === "string") addWord(val);
      else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string") addWord(item);
        }
      }
    }
  }

  return keywords;
}

export async function loadNotebookScopeSnapshot(
  noteId: string | undefined,
  docText: string,
): Promise<NotebookScopeSnapshot> {
  const defaults = readNoteReferenceDefaults(docText);
  const stack = resolveNotePropertyStack(docText, { noteId });
  const tags = new Set<string>(stack.activeTags);
  let notebookId: string | undefined;
  let notebookSlug: string | undefined;
  let defaultEffort = defaults.effort;
  const defaultEquipment = [...(defaults.equipment ?? [])];
  let preferredMassUnit: string | undefined;
  let preferredDistanceUnit: string | undefined;
  const customMetricTypes: Array<{ type: string; starterValue: string }> = [];

  if (noteId) {
    try {
      const note = await storageService.getNote(noteId);
      if (note) {
        notebookId = note.notebookId;
        if (notebookId) {
          notebookSlug = notebookId.replace(/^notebook\//, "");
          const landingNote = await storageService.getNote(notebookId).catch(() => null);
          if (landingNote?.rawContent) {
            const nbDefaults = readNoteReferenceDefaults(landingNote.rawContent);
            if (!defaultEffort && nbDefaults.effort) defaultEffort = nbDefaults.effort;
            for (const eq of nbDefaults.equipment ?? []) {
              if (!defaultEquipment.includes(eq)) defaultEquipment.push(eq);
            }
            const nbStack = resolveNotePropertyStack(landingNote.rawContent);
            for (const t of nbStack.activeTags) tags.add(t);
          }
          if (landingNote?.tags) {
            for (const t of landingNote.tags) tags.add(t);
          }
        }
        if (note.tags) {
          for (const t of note.tags) tags.add(t);
        }
      }
    } catch {
      // Storage may be uninitialized in isolated component tests.
    }
  }

  const tagIndex = getTagIndex();
  const seenCustom = new Set<string>();
  const builtInTypes = new Set([
    "duration", "time", "rep", "reps", "effort", "rounds", "distance",
    "resistance", "weight", "action", "equipment", "sound", "system", "label",
  ]);

  const inspectContributions = (slug: string) => {
    const def = tagIndex.resolve(slug);
    if (!def) return;
    for (const contrib of def.contributions) {
      if (contrib.kind !== "metric") continue;
      const mType = contrib.type.toLowerCase();
      if (mType === "resistance" && contrib.unit && !preferredMassUnit) {
        preferredMassUnit = contrib.unit;
      } else if (mType === "distance" && contrib.unit && !preferredDistanceUnit) {
        preferredDistanceUnit = contrib.unit;
      } else if (!builtInTypes.has(mType) && !seenCustom.has(mType)) {
        seenCustom.add(mType);
        const starter = contrib.value !== undefined ? String(contrib.value) : "1";
        customMetricTypes.push({ type: contrib.type, starterValue: starter });
      }
    }
  };

  for (const slug of tags) {
    inspectContributions(slug);
  }
  for (const source of stack.propertySources) {
    for (const [mKey, rule] of Object.entries(source.metrics ?? {})) {
      const mType = mKey.toLowerCase();
      if (!builtInTypes.has(mType) && !seenCustom.has(mType)) {
        seenCustom.add(mType);
        const val = typeof rule === "object" && rule !== null && "value" in rule
          ? String((rule as { value?: unknown }).value ?? "1")
          : "1";
        customMetricTypes.push({ type: mKey, starterValue: val });
      }
    }
  }

  return {
    notebookId,
    notebookSlug,
    tags: [...tags],
    defaultEffort,
    defaultEquipment,
    preferredMassUnit,
    preferredDistanceUnit,
    customMetricTypes,
  };
}

function scoreEffortForScope(
  effort: IEffort,
  scope: NotebookScopeSnapshot,
  keywords: Set<string>,
): number {
  let score = 0;
  if (scope.defaultEffort && effort.slug === scope.defaultEffort) score += 100;
  if (effort.equipment?.some((eq) => scope.defaultEquipment.includes(eq))) score += 40;
  if (effort.baseAttributes?.discipline && keywords.has(effort.baseAttributes.discipline.toLowerCase())) {
    score += 30;
  }
  if (effort.sourcePath) {
    const lowerPath = effort.sourcePath.toLowerCase();
    for (const kw of keywords) {
      if (kw.length >= 3 && lowerPath.includes(kw)) {
        score += 20;
        break;
      }
    }
  }
  const lowerSlug = effort.slug.toLowerCase();
  for (const kw of keywords) {
    if (kw.length >= 4 && lowerSlug.includes(kw)) {
      score += 10;
      break;
    }
  }
  return score;
}

function buildEffortOptions(
  currentRaw: string,
  scope: NotebookScopeSnapshot,
  docText: string,
): WheelDrumOption[] {
  const registry = getAppEffortRegistry();
  const catalogEfforts = registry.isInitialized() ? [...registry.list()] : [];
  const keywords = extractScopeKeywords(scope, docText);

  if (catalogEfforts.length === 0) {
    const base = FALLBACK_EFFORTS.map((name) => ({
      id: `eff-${name.toLowerCase().replace(/\s+/g, "-")}`,
      label: name,
      value: name,
    }));
    if (currentRaw && !base.some((o) => o.value.toLowerCase() === currentRaw.toLowerCase())) {
      return [{ id: "eff-current", label: currentRaw, value: currentRaw }, ...base];
    }
    return base;
  }

  const scored = catalogEfforts
    .map((effort) => ({
      effort,
      score: scoreEffortForScope(effort, scope, keywords),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.effort.label.localeCompare(b.effort.label);
    });

  const options: WheelDrumOption[] = scored.slice(0, 80).map(({ effort, score }) => ({
    id: `eff-${effort.slug}`,
    label: effort.label,
    sublabel: score > 0 ? "Scoped" : effort.baseAttributes?.discipline,
    value: effort.label,
  }));

  const trimmed = currentRaw.trim();
  if (trimmed && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())) {
    options.unshift({
      id: "eff-current",
      label: trimmed,
      value: trimmed,
    });
  }
  return options;
}

function buildEquipmentOptions(
  currentRaw: string,
  scope: NotebookScopeSnapshot,
): WheelDrumOption[] {
  const registry = getAppEquipmentRegistry();
  const list: readonly IEquipment[] = registry.isInitialized() ? registry.list() : [];
  const prioritized = [...list].sort((a, b) => {
    const aPref = scope.defaultEquipment.includes(a.slug) ? 1 : 0;
    const bPref = scope.defaultEquipment.includes(b.slug) ? 1 : 0;
    if (bPref !== aPref) return bPref - aPref;
    return a.label.localeCompare(b.label);
  });

  const options: WheelDrumOption[] =
    prioritized.length > 0
      ? prioritized.map((item) => ({
          id: `eq-${item.slug}`,
          label: item.label,
          value: item.label,
        }))
      : [
          { id: "eq-kb", label: "Kettlebell", value: "KB" },
          { id: "eq-db", label: "Dumbbell", value: "DB" },
          { id: "eq-bb", label: "Barbell", value: "Barbell" },
          { id: "eq-rig", label: "Pull-up Bar", value: "Pull-up Bar" },
        ];

  const trimmed = currentRaw.trim();
  if (trimmed && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())) {
    options.unshift({ id: "eq-current", label: trimmed, value: trimmed });
  }
  return options;
}

function buildTagOptions(currentRaw: string, scope: NotebookScopeSnapshot): WheelDrumOption[] {
  const defs = getTagIndex().list();
  const scopedSet = new Set(scope.tags.map((s) => s.toLowerCase()));
  const sorted = [...defs]
    .filter((d) => !d.isCategory)
    .sort((a, b) => {
      const aIn = scopedSet.has(a.slug.toLowerCase()) ? 1 : 0;
      const bIn = scopedSet.has(b.slug.toLowerCase()) ? 1 : 0;
      if (bIn !== aIn) return bIn - aIn;
      return a.slug.localeCompare(b.slug);
    });

  const options: WheelDrumOption[] = sorted.map((d) => ({
    id: `tag-${d.slug}`,
    label: `#${d.slug}`,
    value: `#${d.slug}`,
  }));

  if (options.length === 0) {
    options.push(
      { id: "tag-emom", label: "#emom", value: "#emom" },
      { id: "tag-amrap", label: "#amrap", value: "#amrap" },
      { id: "tag-for-time", label: "#for-time", value: "#for-time" },
    );
  }

  const trimmed = currentRaw.trim();
  if (trimmed && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())) {
    options.unshift({ id: "tag-current", label: trimmed, value: trimmed });
  }
  return options;
}

function parseDurationParts(raw: string): { minutes: string; seconds: string } {
  const colonMatch = raw.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      const totalMins = parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
      return { minutes: String(Math.min(60, totalMins)), seconds: colonMatch[3] };
    }
    return {
      minutes: String(Math.min(60, parseInt(colonMatch[1], 10))),
      seconds: SECOND_VALUES.includes(colonMatch[2]) ? colonMatch[2] : "00",
    };
  }
  return { minutes: "1", seconds: "00" };
}

function parseAmountAndUnit(
  raw: string,
  defaultAmount: string,
  defaultUnit: string,
): { amount: string; unit: string } {
  const match = raw.trim().match(/^(@?\d+(?:\.\d+)?)\s*([a-zA-Z%]+)?$/);
  if (!match) return { amount: defaultAmount, unit: defaultUnit };
  return {
    amount: match[1].replace(/^@/, ""),
    unit: match[2] || defaultUnit,
  };
}

function buildDrumsForMetricSlot(
  slot: WheelSlot,
  scope: NotebookScopeSnapshot,
  docText: string,
): WheelDrumSpec[] {
  const type = slot.metricType ?? "";

  if (type === MetricType.Duration) {
    const { minutes, seconds } = parseDurationParts(slot.rawText);
    return [
      {
        id: "duration-min",
        label: "Minutes",
        options: MINUTE_OPTIONS,
        selectedValue: minutes,
      },
      {
        id: "duration-sec",
        label: "Seconds",
        options: SECOND_OPTIONS,
        selectedValue: seconds,
      },
    ];
  }

  if (type === MetricType.Rep) {
    const clean = slot.rawText.trim();
    const options = REP_OPTIONS.some((o) => o.value === clean)
      ? REP_OPTIONS
      : [{ id: "rep-cur", label: clean, value: clean }, ...REP_OPTIONS];
    return [
      {
        id: "rep-value",
        label: "Reps / Scheme",
        options,
        selectedValue: clean || "10",
      },
    ];
  }

  if (type === MetricType.Rounds) {
    const clean = slot.rawText.trim();
    const options = ROUNDS_OPTIONS.some((o) => o.value === clean)
      ? ROUNDS_OPTIONS
      : [{ id: "rounds-cur", label: clean, value: clean }, ...ROUNDS_OPTIONS];
    return [
      {
        id: "rounds-value",
        label: "Rounds",
        options,
        selectedValue: clean || "(3)",
      },
    ];
  }

  if (type === MetricType.Resistance) {
    const defaultUnit = scope.preferredMassUnit ?? "kg";
    const { amount, unit } = parseAmountAndUnit(slot.rawText, "20", defaultUnit);
    const units = scope.preferredMassUnit && !DEFAULT_MASS_UNITS.includes(scope.preferredMassUnit)
      ? [scope.preferredMassUnit, ...DEFAULT_MASS_UNITS]
      : [
          defaultUnit,
          ...DEFAULT_MASS_UNITS.filter((u) => u !== defaultUnit),
        ];
    const amountOptions: WheelDrumOption[] = (
      WEIGHT_AMOUNTS.includes(amount) ? WEIGHT_AMOUNTS : [amount, ...WEIGHT_AMOUNTS]
    ).map((a) => ({ id: `wt-${a}`, label: a, value: a }));
    const unitOptions: WheelDrumOption[] = (
      units.includes(unit) ? units : [unit, ...units]
    ).map((u) => ({ id: `wt-u-${u}`, label: u, value: u }));
    return [
      { id: "unit-amount", label: "Load", options: amountOptions, selectedValue: amount },
      { id: "unit-suffix", label: "Unit", options: unitOptions, selectedValue: unit },
    ];
  }

  if (type === MetricType.Distance) {
    const defaultUnit = scope.preferredDistanceUnit ?? "m";
    const { amount, unit } = parseAmountAndUnit(slot.rawText, "400", defaultUnit);
    const units = scope.preferredDistanceUnit && !DEFAULT_DISTANCE_UNITS.includes(scope.preferredDistanceUnit)
      ? [scope.preferredDistanceUnit, ...DEFAULT_DISTANCE_UNITS]
      : [
          defaultUnit,
          ...DEFAULT_DISTANCE_UNITS.filter((u) => u !== defaultUnit),
        ];
    const amountOptions: WheelDrumOption[] = (
      DISTANCE_AMOUNTS.includes(amount) ? DISTANCE_AMOUNTS : [amount, ...DISTANCE_AMOUNTS]
    ).map((a) => ({ id: `dist-${a}`, label: a, value: a }));
    const unitOptions: WheelDrumOption[] = (
      units.includes(unit) ? units : [unit, ...units]
    ).map((u) => ({ id: `dist-u-${u}`, label: u, value: u }));
    return [
      { id: "unit-amount", label: "Distance", options: amountOptions, selectedValue: amount },
      { id: "unit-suffix", label: "Unit", options: unitOptions, selectedValue: unit },
    ];
  }

  if (type === MetricType.Equipment) {
    const options = buildEquipmentOptions(slot.rawText, scope);
    return [
      {
        id: "equipment-value",
        label: "Equipment",
        options,
        selectedValue: options[0]?.value ?? slot.rawText,
      },
    ];
  }

  if (type === "tag") {
    const options = buildTagOptions(slot.rawText, scope);
    const matched = options.find((o) => o.value.toLowerCase() === slot.rawText.trim().toLowerCase());
    return [
      {
        id: "tag-value",
        label: "Tag",
        options,
        selectedValue: matched?.value ?? options[0]?.value ?? slot.rawText,
      },
    ];
  }

  if (type === MetricType.Action) {
    const clean = slot.rawText.trim();
    const options = ACTION_OPTIONS.some((o) => o.value === clean)
      ? ACTION_OPTIONS
      : [{ id: "act-cur", label: clean, value: clean }, ...ACTION_OPTIONS];
    return [
      {
        id: "action-value",
        label: "Action",
        options,
        selectedValue: clean,
      },
    ];
  }

  const effortOptions = buildEffortOptions(slot.rawText, scope, docText);
  const matchedEffort = effortOptions.find(
    (o) => o.value.toLowerCase() === slot.rawText.trim().toLowerCase(),
  );
  return [
    {
      id: "effort-value",
      label: "Movement / Effort",
      options: effortOptions,
      selectedValue: matchedEffort?.value ?? slot.rawText.trim(),
    },
  ];
}

function buildAddMetricDrum(
  scope: NotebookScopeSnapshot,
  docText: string,
): WheelDrumSpec {
  const starterEffort = buildEffortOptions("", scope, docText)[0]?.value ?? "Air Squat";
  const massUnit = scope.preferredMassUnit ?? "kg";
  const distUnit = scope.preferredDistanceUnit ?? "m";
  const starterTag = buildTagOptions("", scope)[0]?.value ?? "#emom";

  const options: WheelDrumOption[] = [
    { id: "add-duration", label: "Duration / Timer", sublabel: "1:00", value: "1:00" },
    { id: "add-rep", label: "Reps / Scheme", sublabel: "10", value: "10" },
    { id: "add-effort", label: "Movement / Effort", sublabel: starterEffort, value: starterEffort },
    { id: "add-weight", label: "Weight / Load", sublabel: `20${massUnit}`, value: `20${massUnit}` },
    { id: "add-distance", label: "Distance", sublabel: `400${distUnit}`, value: `400${distUnit}` },
    { id: "add-rounds", label: "Rounds", sublabel: "(3)", value: "(3)" },
    { id: "add-rest", label: "Rest / Action", sublabel: ":rest", value: ":rest" },
    { id: "add-tag", label: "Tag (#)", sublabel: starterTag, value: starterTag },
    ...scope.customMetricTypes.map((custom) => ({
      id: `add-custom-${custom.type}`,
      label: custom.type,
      sublabel: custom.starterValue,
      value: custom.starterValue,
    })),
  ];

  return {
    id: "add-metric-type",
    label: "Select Metric Type to Insert",
    options,
    selectedValue: options[0].value,
  };
}

function extractWorkoutLineSlots(state: EditorState): WheelSlot[] {
  const focus = getCursorFocusState(state);
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const slots: WheelSlot[] = [];

  if (focus?.statement && focus.section.contentFrom !== undefined) {
    const contentFrom = focus.section.contentFrom;
    const stmt = focus.statement;

    const equipmentRanges: Array<{ from: number; to: number }> = [];
    for (const m of stmt.metrics) {
      if (m.type !== MetricType.Equipment) continue;
      const eqMeta = getReferenceMetadata(m.metadata);
      if (eqMeta?.matched === "whole" || eqMeta?.matched === "default") continue;
      const meta = stmt.metricMeta?.get(m);
      if (meta) {
        equipmentRanges.push({
          from: contentFrom + meta.startOffset,
          to: contentFrom + meta.endOffset,
        });
      }
    }

    const seenRanges = new Set<string>();
    Array.from(stmt.metrics).forEach((metric: IMetric, idx: number) => {
      if (metric.type === MetricType.Sound || metric.type === MetricType.System) return;
      const reference = getTagReference(metric.metadata);
      const isTagMarker = typeof metric.type === "string" && metric.type.startsWith(TAG_MARKER_PREFIX);
      if (reference && !isTagMarker) return;

      if (metric.type === MetricType.Equipment) {
        const eqMeta = getReferenceMetadata(metric.metadata);
        if (eqMeta?.matched === "whole" || eqMeta?.matched === "default") return;
      }

      const meta = stmt.metricMeta?.get(metric);
      if (!meta) return;

      let from = contentFrom + meta.startOffset;
      const to = contentFrom + meta.endOffset;
      if (metric.type === MetricType.Effort) {
        for (const eq of equipmentRanges) {
          if (eq.from === from && eq.to < to) {
            from = eq.to;
            while (from < to && /\s/.test(state.doc.sliceString(from, from + 1))) {
              from++;
            }
          }
        }
      }

      if (from < line.from || to > line.to || from >= to) return;
      const rangeKey = `${from}:${to}`;
      if (seenRanges.has(rangeKey)) return;
      seenRanges.add(rangeKey);

      const rawText = state.doc.sliceString(from, to);
      const isHashTag = isTagMarker || /^#[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(rawText.trim());
      const effectiveType = isHashTag
        ? "tag"
        : metric.type === MetricType.Choice
          ? String((metric as ChoiceGroupMetric).alternatives[0]?.type ?? MetricType.Effort)
          : String(metric.type);

      slots.push({
        id: `metric-${idx}-${from}`,
        kind: "metric",
        label: rawText.trim(),
        metricType: effectiveType,
        from,
        to,
        rawText,
      });
    });

    slots.sort((a, b) => a.from - b.from);
  }

  slots.push({
    id: "add-metric",
    kind: "add-metric",
    label: "+ Add",
    from: line.to,
    to: line.to,
    rawText: "",
  });

  return slots;
}

export function buildWheelComposerModel(
  state: EditorState,
  scope: NotebookScopeSnapshot,
  preferredSlotIndex?: number | null,
): WheelComposerModel {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const docText = state.doc.toString();

  let section = state.field(sectionField, false)?.sections.find(
    (s) =>
      (s.type === "time" || s.type === "log" || s.type === "query") &&
      line.number >= s.startLine &&
      line.number <= s.endLine,
  ) ?? null;
  if (!section) {
    try {
      section = activeCursorSection(state);
    } catch {
      section = state.field(sectionField, false)?.sections.find(
        (s) => line.number >= s.startLine && line.number <= s.endLine,
      ) ?? null;
    }
  }

  const isWorkoutBody =
    (section?.type === "time" || section?.type === "log") &&
    line.number > section.startLine &&
    line.number < section.endLine;

  if (isWorkoutBody) {
    const slots = extractWorkoutLineSlots(state);
    let activeSlotIndex = slots.findIndex(
      (s) => s.kind === "metric" && head >= s.from && head <= s.to,
    );
    if (
      preferredSlotIndex !== undefined &&
      preferredSlotIndex !== null &&
      preferredSlotIndex >= 0 &&
      preferredSlotIndex < slots.length
    ) {
      activeSlotIndex = preferredSlotIndex;
    } else if (activeSlotIndex < 0) {
      activeSlotIndex = slots.length - 1; // Default to "+ Add" when on empty line or trailing space
    }

    const activeSlot = slots[activeSlotIndex] ?? slots[slots.length - 1];
    const drums =
      activeSlot.kind === "add-metric"
        ? [buildAddMetricDrum(scope, docText)]
        : buildDrumsForMetricSlot(activeSlot, scope, docText);

    return {
      context: "workout",
      lineNumber: line.number,
      lineFrom: line.from,
      lineTo: line.to,
      slots,
      activeSlotIndex,
      drums,
    };
  }

  const isQueryBody =
    section?.type === "query" &&
    line.number > section.startLine &&
    line.number < section.endLine;

  if (isQueryBody) {
    const slots: WheelSlot[] = QUERY_STAGES.map((stage) => ({
      id: stage.id,
      kind: "query-stage",
      label: stage.label,
      from: line.from,
      to: line.to,
      rawText: line.text,
    }));
    const clampedIdx =
      preferredSlotIndex !== undefined &&
      preferredSlotIndex !== null &&
      preferredSlotIndex >= 0 &&
      preferredSlotIndex < slots.length
        ? preferredSlotIndex
        : 0;
    const stage = QUERY_STAGES[clampedIdx];
    return {
      context: "query",
      lineNumber: line.number,
      lineFrom: line.from,
      lineTo: line.to,
      slots,
      activeSlotIndex: clampedIdx,
      drums: [
        {
          id: stage.id,
          label: stage.label,
          options: stage.options,
          selectedValue: stage.options[0].value,
        },
      ],
    };
  }

  const slots: WheelSlot[] = MARKDOWN_GROUPS.map((group) => ({
    id: group.id,
    kind: "markdown-group",
    label: group.label,
    from: line.from,
    to: line.to,
    rawText: line.text,
  }));
  const clampedIdx =
    preferredSlotIndex !== undefined &&
    preferredSlotIndex !== null &&
    preferredSlotIndex >= 0 &&
    preferredSlotIndex < slots.length
      ? preferredSlotIndex
      : 0;
  const group = MARKDOWN_GROUPS[clampedIdx];

  return {
    context: "markdown",
    lineNumber: line.number,
    lineFrom: line.from,
    lineTo: line.to,
    slots,
    activeSlotIndex: clampedIdx,
    drums: [
      {
        id: group.id,
        label: group.label,
        options: group.options,
        selectedValue: group.options[0].value,
      },
    ],
  };
}
