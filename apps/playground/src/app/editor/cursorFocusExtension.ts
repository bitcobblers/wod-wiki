/**
 * cursorFocusExtension — Token-level metric highlighting and cursor focus state
 * for WhiteboardScript timer and log blocks in CodeMirror 6.
 *
 * Provides:
 *  1. Mark decorations — individual tokens are underlined and colored based on
 *     the semantic IMetric the parser assigns to that character range (duration
 *     in blue, reps in orange, effort/movement in green, distance in teal,
 *     resistance in red, action in yellow).
 *     Tokens on the active cursor line receive full opacity; non-active lines
 *     receive dim (20% opacity border) underlines.
 *  2. Metric navigation keymap — Ctrl+ArrowRight / Ctrl+ArrowLeft jumps between
 *     metric tokens within workout blocks.
 *  3. Exported state — the focused ICodeStatement + EditorSection, exposed via
 *     getCursorFocusState(view.state) to drive MetricInlinePanel.
 */

import { getTagIndex } from '@/services/tags/tagCatalogue';
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import {
  EditorState,
  Extension,
  Prec,
  Range,
  StateField,
} from "@codemirror/state";
import { sectionField, referenceIndexReload, type EditorSection } from "@bitcobblers/wod-wiki-ui/extensions";
import {
  ChoiceGroupMetric,
  createParser,
  MetricType,
  TAG_MARKER_PREFIX,
  type ICodeStatement,
  type IMetric,
} from "@bitcobblers/wod-wiki-engine";
import { getReferenceMetadata, getTagReference, type TagReferenceMetadata } from "@bitcobblers/wod-wiki-core";
import { getSharedReferenceIndex, readNoteReferenceDefaults } from "@/app/editor/noteEditorServices";
import { catalogueReload, catalogueReloadPlugin } from "@/app/editor/catalogueReload";

// ── Types ────────────────────────────────────────────────────────────

/** Data exposed to external consumers via getCursorFocusState(). */
export interface CursorFocusState {
  sectionId?: string;
  section: EditorSection;
  statement: ICodeStatement | null;
  statementIndex?: number;
  cursorLine: number;
  docLine?: number;
  lineFrom: number;
  lineTo: number;
  focusedMetric: IMetric | null;
  focusedMetricIndex?: number;
  allStatements?: ICodeStatement[];
}

// ── Mark decoration class map ─────────────────────────────────────────

const METRIC_MARK_CLASS: Partial<Record<string, string>> = {
  [MetricType.Duration]:   "cm-metric-underline-duration",
  [MetricType.Rep]:        "cm-metric-underline-rep",
  [MetricType.Effort]:     "cm-metric-underline-effort",
  [MetricType.Rounds]:     "cm-metric-underline-rounds",
  [MetricType.Distance]:   "cm-metric-underline-distance",
  [MetricType.Resistance]: "cm-metric-underline-resistance",
  [MetricType.Action]:     "cm-metric-underline-action",
  [MetricType.Equipment]:  "cm-metric-underline-equipment",
};

/**
 * The class a tag reference is marked with.
 *
 * A tag reference is a hashtag, not a metric — it gets its own mark. A
 * `#sound-` reference names a sound profile, so it is marked as one.
 */
function tagMarkClass(reference: TagReferenceMetadata | undefined): string {
  return reference?.soundProfileId ? "cm-tag-reference-sound" : "cm-tag-reference";
}

// ── Parser helper ─────────────────────────────────────────────────────

function parseStatements(
  section: EditorSection,
  state: EditorState
): ICodeStatement[] | null {
  if (section.contentFrom === undefined || section.contentTo === undefined) return null;
  const raw = state.doc.sliceString(section.contentFrom, section.contentTo);
  if (!raw.trim()) return null;
  try {
    // Same shared resolver the frontmatter preview uses, plus the note's
    // flat metrics.* defaults, so focused-line chips match the runtime.
    const references = getSharedReferenceIndex();
    const tags = getTagIndex();
    if (!references) return createParser({ tags }).read(raw, section.sport).statements as ICodeStatement[];
    const parser = createParser({
      references,
      defaults: readNoteReferenceDefaults(state.doc.toString()),
      tags,
    });
    return parser.read(raw, section.sport).statements as ICodeStatement[];
  } catch {
    return null;
  }
}

// ── Mark decoration builder ──────────────────────────────────────────

function buildDecorations(
  allSections: EditorSection[],
  cursorSection: EditorSection | null,
  cursorDocLine: number,
  state: EditorState,
): DecorationSet {
  const decos: Range<Decoration>[] = [];

  for (const section of allSections) {
    if (section.contentFrom === undefined || section.contentTo === undefined) continue;
    const statements = parseStatements(section, state);
    if (!statements) continue;

    for (const s of statements) {
      const stmtDocLine = section.startLine + (s.meta?.line ?? 0);
      const isActiveLine =
        cursorSection === section && stmtDocLine === cursorDocLine;

      // Collect explicit equipment token ranges on this statement so split
      // phrases (`KB swings`) don't double-underline the equipment prefix.
      const equipmentRanges: Array<{ from: number; to: number }> = [];
      for (const m of s.metrics) {
        if (m.type !== MetricType.Equipment) continue;
        const eqMeta = getReferenceMetadata(m.metadata);
        if (eqMeta?.matched === 'whole' || eqMeta?.matched === 'default') continue;
        const meta = s.metricMeta?.get(m);
        if (meta) {
          equipmentRanges.push({
            from: section.contentFrom + meta.startOffset,
            to: section.contentFrom + meta.endOffset,
          });
        }
      }

      for (const metric of s.metrics) {
        const reference = getTagReference(metric.metadata);
        const isTagMarker = typeof metric.type === 'string' && metric.type.startsWith(TAG_MARKER_PREFIX);
        // A metric a tag brought is marked by the hashtag on the reference
        // itself — not by the kind of the value it carries.
        if (reference && !isTagMarker) continue;

        if (metric.type === MetricType.Equipment) {
          const eqMeta = getReferenceMetadata(metric.metadata);
          if (eqMeta?.matched === 'whole' || eqMeta?.matched === 'default') continue;
        }

        const isUnresolvedTag =
          metric.type === MetricType.Custom &&
          typeof metric.value === 'string' &&
          /^#[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(metric.value.trim());

        const effectiveType = metric.type === MetricType.Choice
          ? (metric as ChoiceGroupMetric).alternatives[0]?.type
          : metric.type;
        const baseClass = isTagMarker
          ? tagMarkClass(reference)
          : isUnresolvedTag
            ? "cm-tag-unresolved"
            : METRIC_MARK_CLASS[effectiveType as string];
        if (!baseClass) continue;

        const meta = s.metricMeta?.get(metric);
        if (!meta) continue;

        let from = section.contentFrom + meta.startOffset;
        const to = section.contentFrom + meta.endOffset;

        // When an effort metric shares its start with a split equipment prefix
        // (`KB swings`), advance the effort mark past the equipment token so
        // `KB` renders as equipment and `swings` renders as effort.
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

        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        if (from >= to || from < 0 || to > state.doc.length) continue;

        const refMeta = getReferenceMetadata(metric.metadata);
        const hasDiagnostics = (refMeta?.diagnostics?.length ?? 0) > 0;
        const stateClass = isActiveLine ? baseClass : `${baseClass}-dim`;
        const cssClass = hasDiagnostics ? `${stateClass} cm-metric-unresolved` : stateClass;
        decos.push(Decoration.mark({ class: cssClass }).range(from, to));
      }
    }
  }

  decos.sort((a, b) => a.from - b.from);
  return Decoration.set(decos);
}

// ── StateField ───────────────────────────────────────────────────────

function computeFocusState(
  state: EditorState
): { focus: CursorFocusState | null; decos: DecorationSet } {
  const { sections } = state.field(sectionField);
  const { head } = state.selection.main;
  const cursorLine = state.doc.lineAt(head).number;

  const workoutSections = sections.filter((s) => s.type === "time" || s.type === "log");

  const cursorSection = workoutSections.find(
    (s) =>
      cursorLine >= s.startLine + 1 &&
      cursorLine < s.endLine
  ) ?? null;

  let focus: CursorFocusState | null = null;
  let stmt: ICodeStatement | null = null;
  let statementIndex = -1;
  let statements: ICodeStatement[] | null = null;

  if (cursorSection) {
    const docLine = state.doc.line(cursorLine);
    statements = parseStatements(cursorSection, state);
    const lineInContent = cursorLine - cursorSection.startLine;
    statementIndex = statements?.findIndex(s => s.meta?.line === lineInContent && s.metrics.some(metric => {
      const meta = s.metricMeta.get(metric);
      const offset = head - (cursorSection.contentFrom ?? 0);
      return meta && offset >= meta.startOffset && offset <= meta.endOffset;
    })) ?? -1;
    if (statementIndex < 0) statementIndex = statements?.findIndex(s => s.meta?.line === lineInContent) ?? -1;
    stmt = statementIndex >= 0 && statements ? statements[statementIndex] : null;

    focus = {
      sectionId: cursorSection.id,
      section: cursorSection,
      statement: stmt,
      statementIndex,
      cursorLine,
      docLine: cursorLine,
      lineFrom: docLine.from,
      lineTo: docLine.to,
      focusedMetric: null,
      focusedMetricIndex: -1,
      allStatements: statements ?? [],
    };
  }

  let focusedMetric: IMetric | null = null;
  let focusedMetricIndex = -1;
  if (cursorSection && stmt && cursorSection.contentFrom !== undefined) {
    for (let idx = 0; idx < stmt.metrics.length; idx++) {
      const m = stmt.metrics[idx];
      if (m.type === MetricType.Sound || m.type === MetricType.System) continue;
      const meta = stmt.metricMeta?.get(m);
      if (!meta) continue;
      const from = cursorSection.contentFrom + meta.startOffset;
      const to = cursorSection.contentFrom + meta.endOffset;
      if (head >= from && head <= to) {
        focusedMetric = m;
        focusedMetricIndex = idx;
        break;
      }
    }
  }

  if (focus) {
    focus.focusedMetric = focusedMetric;
    focus.focusedMetricIndex = focusedMetricIndex;
  }

  const decos = buildDecorations(workoutSections, cursorSection, cursorLine, state);

  return { focus, decos };
}

interface InternalState {
  focus: CursorFocusState | null;
  decos: DecorationSet;
}

const cursorFocusInternal = StateField.define<InternalState>({
  create(state) {
    return computeFocusState(state);
  },
  update(prev, tr) {
    // A catalogue that changed (tags, efforts, equipment) changes what the
    // marks should say — redraw them even though the document did not move.
    if (tr.effects.some((e) => e.is(referenceIndexReload) || e.is(catalogueReload))) {
      return computeFocusState(tr.state);
    }
    if (!tr.docChanged && tr.startState.selection.eq(tr.state.selection)) return prev;
    return computeFocusState(tr.state);
  },
  provide: (f) =>
    EditorView.decorations.from(f, (state) => state.decos),
});

// ── Public accessor ──────────────────────────────────────────────────

export function getCursorFocusState(
  state: EditorState
): CursorFocusState | null {
  try {
    return state.field(cursorFocusInternal).focus;
  } catch {
    return null;
  }
}

// ── Metric navigation keymap ─────────────────────────────────────────

function jumpMetric(view: EditorView, direction: 1 | -1): boolean {
  const focus = getCursorFocusState(view.state);
  if (!focus) return false;
  if (!focus.statement) return true;

  const { section } = focus;
  const contentFrom = section.contentFrom ?? 0;
  const { head } = view.state.selection.main;

  const allStatements = parseStatements(section, view.state) ?? [];
  const allRanges: { from: number; to: number }[] = [];
  for (const s of allStatements) {
    for (const m of s.metrics) {
      if (m.type === MetricType.Sound || m.type === MetricType.System) continue;
      const meta = s.metricMeta?.get(m);
      if (!meta) continue;
      allRanges.push({
        from: contentFrom + meta.startOffset,
        to:   contentFrom + meta.endOffset,
      });
    }
  }
  allRanges.sort((a, b) => a.from - b.from);

  if (allRanges.length === 0) return true;

  let target: { from: number; to: number } | undefined;
  if (direction === 1) {
    target = allRanges.find((r) => r.from > head);
  } else {
    target = [...allRanges].reverse().find((r) => r.from < head);
  }

  if (!target) return true;
  view.dispatch({ selection: { anchor: target.from } });
  return true;
}

const metricNavKeymap = Prec.high(keymap.of([
  { key: "Ctrl-ArrowRight", run: (v) => jumpMetric(v, 1) },
  { key: "Ctrl-ArrowLeft",  run: (v) => jumpMetric(v, -1) },
]));

// ── CSS theme ────────────────────────────────────────────────────────

const metricUnderlineTheme = EditorView.baseTheme({
  ".cm-metric-underline-duration, .cm-metric-underline-duration *":     { borderBottom: "2px solid hsl(var(--metric-time))",       color: "hsl(var(--metric-time)) !important" },
  ".cm-metric-underline-rep, .cm-metric-underline-rep *":               { borderBottom: "2px solid hsl(var(--metric-rep))",        color: "hsl(var(--metric-rep)) !important" },
  ".cm-metric-underline-effort, .cm-metric-underline-effort *":         { borderBottom: "2px solid hsl(var(--metric-effort))",     color: "hsl(var(--metric-effort)) !important" },
  ".cm-metric-underline-rounds, .cm-metric-underline-rounds *":         { borderBottom: "2px solid hsl(var(--metric-rounds))",     color: "hsl(var(--metric-rounds)) !important" },
  ".cm-metric-underline-distance, .cm-metric-underline-distance *":     { borderBottom: "2px solid hsl(var(--metric-distance))",   color: "hsl(var(--metric-distance)) !important" },
  ".cm-metric-underline-resistance, .cm-metric-underline-resistance *": { borderBottom: "2px solid hsl(var(--metric-resistance))", color: "hsl(var(--metric-resistance)) !important" },
  ".cm-metric-underline-action, .cm-metric-underline-action *":         { borderBottom: "2px solid hsl(var(--metric-action))",     color: "hsl(var(--metric-action)) !important" },
  ".cm-metric-underline-equipment, .cm-metric-underline-equipment *":   { borderBottom: "2px solid hsl(var(--metric-equipment))",  color: "hsl(var(--metric-equipment)) !important" },

  ".cm-metric-underline-duration-dim, .cm-metric-underline-duration-dim *":     { borderBottom: "1.5px solid hsl(var(--metric-time) / 0.35)",       color: "hsl(var(--metric-time)) !important" },
  ".cm-metric-underline-rep-dim, .cm-metric-underline-rep-dim *":               { borderBottom: "1.5px solid hsl(var(--metric-rep) / 0.35)",        color: "hsl(var(--metric-rep)) !important" },
  ".cm-metric-underline-effort-dim, .cm-metric-underline-effort-dim *":         { borderBottom: "1.5px solid hsl(var(--metric-effort) / 0.35)",     color: "hsl(var(--metric-effort)) !important" },
  ".cm-metric-underline-rounds-dim, .cm-metric-underline-rounds-dim *":         { borderBottom: "1.5px solid hsl(var(--metric-rounds) / 0.35)",     color: "hsl(var(--metric-rounds)) !important" },
  ".cm-metric-underline-distance-dim, .cm-metric-underline-distance-dim *":     { borderBottom: "1.5px solid hsl(var(--metric-distance) / 0.35)",   color: "hsl(var(--metric-distance)) !important" },
  ".cm-metric-underline-resistance-dim, .cm-metric-underline-resistance-dim *": { borderBottom: "1.5px solid hsl(var(--metric-resistance) / 0.35)", color: "hsl(var(--metric-resistance)) !important" },
  ".cm-metric-underline-action-dim, .cm-metric-underline-action-dim *":         { borderBottom: "1.5px solid hsl(var(--metric-action) / 0.35)",     color: "hsl(var(--metric-action)) !important" },
  ".cm-metric-underline-equipment-dim, .cm-metric-underline-equipment-dim *":   { borderBottom: "1.5px solid hsl(var(--metric-equipment) / 0.35)",  color: "hsl(var(--metric-equipment)) !important" },

  ".cm-metric-unresolved, .cm-metric-unresolved *": {
    borderBottomStyle: "dashed !important",
    borderBottomColor: "hsl(var(--warning)) !important",
  },

  // A tag reference is a hashtag: a chip, not an underline.
  ".cm-tag-reference, .cm-tag-reference *": {
    color: "hsl(var(--primary)) !important",
    backgroundColor: "hsl(var(--primary) / 0.10)",
    borderRadius: "3px",
    padding: "0 2px",
  },
  ".cm-tag-reference-dim, .cm-tag-reference-dim *": {
    color: "hsl(var(--primary) / 0.72) !important",
    backgroundColor: "hsl(var(--primary) / 0.05)",
    borderRadius: "3px",
    padding: "0 2px",
  },
  ".cm-tag-unresolved, .cm-tag-unresolved *, .cm-tag-unresolved-dim, .cm-tag-unresolved-dim *": {
    color: "hsl(var(--warning)) !important",
    borderBottom: "1.5px dashed hsl(var(--warning))",
    borderRadius: "2px",
    padding: "0 1px",
  },
  // A `#sound-` reference names a sound profile.
  ".cm-tag-reference-sound, .cm-tag-reference-sound *": {
    color: "hsl(var(--metric-action)) !important",
    backgroundColor: "hsl(var(--metric-action) / 0.12)",
    borderRadius: "3px",
    padding: "0 2px",
  },
  ".cm-tag-reference-sound-dim, .cm-tag-reference-sound-dim *": {
    color: "hsl(var(--metric-action) / 0.72) !important",
    backgroundColor: "hsl(var(--metric-action) / 0.06)",
    borderRadius: "3px",
    padding: "0 2px",
  },
});

// ── Exported extension ───────────────────────────────────────────────

export const cursorFocusExtension: Extension = [
  cursorFocusInternal,
  metricUnderlineTheme,
  metricNavKeymap,
  catalogueReloadPlugin,
];
