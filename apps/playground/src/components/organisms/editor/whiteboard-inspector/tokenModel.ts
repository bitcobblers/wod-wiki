import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  ChoiceGroupMetric,
  createParser,
  MetricType,
  TAG_MARKER_PREFIX,
  type ICodeStatement,
  type IMetric,
} from '@bitcobblers/wod-wiki-engine';
import { getReferenceMetadata, getTagReference, type TagReferenceMetadata } from '@bitcobblers/wod-wiki-core';
import type { IEffort, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { activeCursorSection, sectionField, type EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { getCursorFocusState, type CursorFocusState } from '@/app/editor/cursorFocusExtension';
import { getSharedReferenceIndex, readNoteReferenceDefaults } from '@/app/editor/noteEditorServices';
import { getAppEffortRegistry, getAppEquipmentRegistry, getTagIndex, storageService } from '@/hooks/useBrowserServices';
import type { NotebookScopeSnapshot } from '@/components/organisms/editor/wheelSources';

export type InspectorTokenKind =
  | 'duration'
  | 'rounds'
  | 'rep'
  | 'effort'
  | 'equipment'
  | 'resistance'
  | 'distance'
  | 'action'
  | 'tag'
  | 'unresolved'
  | 'lintError'
  | 'custom';

export type TimerMode = 'countdown' | 'rest' | 'countup' | 'collectible';

export type InspectorMode =
  | 'token'
  | 'add'
  | 'block'
  | 'wiki'
  | 'prose-tag'
  | 'query'
  | 'markdown';

export interface DurationMeta {
  mode: TimerMode;
  mins: number;
  secs: number;
}

export interface ResistanceMeta {
  hasAt: boolean;
  amount: string;
  altAmount: string | null;
  unit: string;
}

export interface DistanceMeta {
  amount: string;
  unit: string;
}

export interface DiagnosticSummary {
  reason: string;
  message: string;
  token?: string;
  candidates?: readonly string[];
}

export interface InspectorToken {
  id: string;
  kind: InspectorTokenKind;
  raw: string;
  displayLabel: string;
  from: number;
  to: number;
  lineNum: number;
  metric?: IMetric;
  refKind?: 'effort' | 'equipment';
  refSlug?: string;
  tagRef?: TagReferenceMetadata;
  diagnostic?: DiagnosticSummary;
  lintMessage?: string;
  lintFixes?: string[];
  isTag?: boolean;
  isRest?: boolean;
  durationMeta?: DurationMeta;
  resistanceMeta?: ResistanceMeta;
  distanceMeta?: DistanceMeta;
}

export interface LineQuickFix {
  id: string;
  from: number;
  to: number;
  raw: string;
  message: string;
  fixes: string[];
}

export interface LineInspection {
  contextKind: 'workout' | 'query' | 'markdown';
  section: EditorSection | null;
  focus: CursorFocusState | null;
  lineNum: number;
  lineFrom: number;
  lineTo: number;
  lineText: string;
  tokens: InspectorToken[];
  lintFixes: LineQuickFix[];
}

export interface BlockTimelineItem {
  lineNum: number;
  text: string;
  label: string;
  durationLabel: string;
  isRest: boolean;
  hasError: boolean;
}

export interface WorkoutTemplatePreset {
  id: string;
  name: string;
  desc: string;
  lines: string[];
}

export interface EditDiffSummary {
  from: string;
  to: string;
}

export const WORKOUT_TEMPLATES: readonly WorkoutTemplatePreset[] = [
  {
    id: 'emom',
    name: 'EMOM',
    desc: 'Every minute on the minute',
    lines: ['(10) :60 EMOM', '  + 10 Kettlebell Swing @24kg #emom'],
  },
  {
    id: 'amrap',
    name: 'AMRAP',
    desc: 'As many rounds as possible in time cap',
    lines: ['12:00 AMRAP', '  10 Pull-up', '  15 Push-up', '  200m Run #amrap'],
  },
  {
    id: 'tabata',
    name: 'Tabata',
    desc: '8 intervals of 20s work / 10s rest',
    lines: ['(8) :20 Work', '  * :10 [:rest]', '  10 Air Squat #tabata'],
  },
  {
    id: '5x5',
    name: '5x5 Strength',
    desc: 'Sets × reps barbell progression',
    lines: ['5x5 Back Squat @100kg *2:00 #strength'],
  },
  {
    id: 'circuit',
    name: 'Circuit',
    desc: 'Multi-station timed rounds',
    lines: ['(3)', '  400m Run', '  15 Wall Ball 9kg', '  *1:00 [:rest]'],
  },
  {
    id: 'ladder',
    name: 'Ladder (21-15-9)',
    desc: 'Descending rep scheme',
    lines: ['(21-15-9)', '  Thruster @43kg', '  Pull-up #for-time'],
  },
  {
    id: 'choice',
    name: 'Choice (A | B)',
    desc: 'Scaled or equipment alternative',
    lines: ['(5)', '  15 Kettlebell Swing 24 | 16 kg'],
  },
  {
    id: 'collectible',
    name: 'Collectible (:?)',
    desc: 'Open clock measure-until-done',
    lines: [':? 2000m Row #for-time'],
  },
];

export const ACTION_CUES: readonly { code: string; label: string; desc: string }[] = [
  { code: '[:rest]', label: 'Rest Cue', desc: 'Mark an active rest transition' },
  { code: '[:next]', label: 'Advance Segment', desc: 'Skip forward on completion' },
  { code: '[:done]', label: 'Complete Block', desc: 'Finish timer when reached' },
  { code: '[:mark]', label: 'Split / Lap', desc: 'Record a split timestamp' },
];

export const TIMER_MODES: readonly {
  mode: TimerMode;
  label: string;
  sample: string;
  desc: string;
}[] = [
  { mode: 'countdown', label: 'Countdown', sample: '1:00', desc: 'Fixed work countdown' },
  { mode: 'rest', label: 'Rest', sample: '*1:00', desc: 'Rest interval (*m:ss)' },
  { mode: 'countup', label: 'Count-up', sample: '^5:00', desc: 'AMRAP / cap clock' },
  { mode: 'collectible', label: 'Measure', sample: ':?', desc: 'Count until athlete finishes' },
];

export const SECOND_CHOICES = [0, 5, 10, 15, 20, 30, 45];
export const MINUTE_CHOICES = Array.from({ length: 61 }, (_, i) => i);
export const RESISTANCE_AMOUNT_CHOICES = [
  '5', '7.5', '10', '12', '15', '16', '20', '22.5', '24', '25', '30', '32',
  '35', '40', '42.5', '45', '50', '52.5', '60', '65', '70', '75', '80', '85',
  '90', '95', '100', '105', '115', '120', '135', '140', '155', '160', '185',
  '205', '225', '245', '275', '315',
];
export const MASS_UNITS = ['kg', 'lb', 'pood', '%'];
export const DISTANCE_UNITS = ['m', 'km', 'cal', 'ft', 'mi', 'yd'];

export function parseDurationToken(raw: string): DurationMeta {
  const t = raw.trim();
  if (t === ':?') return { mode: 'collectible', mins: 0, secs: 0 };
  const mode: TimerMode = t.startsWith('*') ? 'rest' : t.startsWith('^') ? 'countup' : 'countdown';
  const body = t.replace(/^[*^]/, '');
  const parts = body.split(':').map((p) => parseInt(p || '0', 10) || 0);
  if (parts.length === 3) {
    return { mode, mins: parts[0] * 60 + parts[1], secs: parts[2] };
  }
  if (parts.length === 2) {
    return { mode, mins: parts[0], secs: parts[1] };
  }
  return { mode, mins: 1, secs: 0 };
}

export function formatDurationToken(meta: DurationMeta): string {
  if (meta.mode === 'collectible') return ':?';
  const totalSec = Math.max(0, meta.mins * 60 + meta.secs);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const body = `${m}:${String(s).padStart(2, '0')}`;
  return meta.mode === 'rest' ? `*${body}` : meta.mode === 'countup' ? `^${body}` : body;
}

export function parseResistanceToken(raw: string): ResistanceMeta {
  const t = raw.trim();
  const hasAt = t.startsWith('@');
  const altM = /^@?(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*(kg|lbs?|pood|%)\b/i.exec(t);
  if (altM) {
    return {
      hasAt,
      amount: altM[1],
      altAmount: altM[2],
      unit: altM[3].toLowerCase() === 'lbs' ? 'lb' : altM[3].toLowerCase(),
    };
  }
  const simpleM = /^@?(1\/2|1\/4|\d+(?:\.\d+)?)\s*(kg|lbs?|pood|%)?\b/i.exec(t);
  if (simpleM) {
    const unitRaw = (simpleM[2] || 'kg').toLowerCase();
    return {
      hasAt,
      amount: simpleM[1],
      altAmount: null,
      unit: unitRaw === 'lbs' ? 'lb' : unitRaw,
    };
  }
  return { hasAt, amount: '20', altAmount: null, unit: 'kg' };
}

export function formatResistanceToken(meta: ResistanceMeta): string {
  const prefix = meta.hasAt ? '@' : '';
  const unit = meta.unit === '%' ? '%' : meta.unit;
  if (meta.altAmount) {
    return `${prefix}${meta.amount} | ${meta.altAmount}${unit}`;
  }
  return `${prefix}${meta.amount}${unit}`;
}

export function parseDistanceToken(raw: string): DistanceMeta {
  const m = /^(1\/4|1\/2|3\/4|\d+(?:\.\d+)?)\s*(m|km|cal|ft|mi|mile|yd)\b/i.exec(raw.trim());
  if (m) {
    const unit = m[2].toLowerCase() === 'mile' ? 'mi' : m[2].toLowerCase();
    return { amount: m[1], unit };
  }
  return { amount: '400', unit: 'm' };
}

export function detectLineSyntaxFixes(lineText: string, lineFrom: number): LineQuickFix[] {
  const fixes: LineQuickFix[] = [];

  // Bare `:word` that is not a timer `:30`, `:?`, or `[action]`
  const colonRe = /(?:^|\s)(:[a-zA-Z][a-zA-Z0-9-]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = colonRe.exec(lineText)) !== null) {
    const raw = m[1];
    const startOffset = m.index + m[0].length - raw.length;
    if (startOffset > 0 && lineText[startOffset - 1] === '[') continue;
    const slug = raw.slice(1);
    fixes.push({
      id: `fix-colon-${startOffset}`,
      from: lineFrom + startOffset,
      to: lineFrom + startOffset + raw.length,
      raw,
      message: `Unexpected "${raw}" — use *1:00 for a timed rest interval or [:${slug}] for an action cue.`,
      fixes: ['*1:00', `[:${slug}]`],
    });
  }

  // Unparenthesized multi-step ladder like `21-15-9`
  const ladderRe = /(?:^|\s)(\d+(?:-\d+){2,})(?=\s|$)/g;
  while ((m = ladderRe.exec(lineText)) !== null) {
    const raw = m[1];
    const startOffset = m.index + m[0].length - raw.length;
    fixes.push({
      id: `fix-ladder-${startOffset}`,
      from: lineFrom + startOffset,
      to: lineFrom + startOffset + raw.length,
      raw,
      message: `Rep ladders need parentheses so rounds parse cleanly — use (${raw}).`,
      fixes: [`(${raw})`],
    });
  }

  return fixes;
}

function classifyMetricKind(metric: IMetric, rawText: string, hasDiag: boolean, isTagMarker: boolean, hasTagRef: boolean): InspectorTokenKind {
  const trimmed = rawText.trim();
  if (isTagMarker || hasTagRef) return 'tag';
  if (metric.type === MetricType.Custom && /^#[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(trimmed)) return 'unresolved';
  if (hasDiag) return 'unresolved';
  switch (metric.type) {
    case MetricType.Duration:
      return 'duration';
    case MetricType.Rounds:
      return 'rounds';
    case MetricType.Rep:
      return 'rep';
    case MetricType.Effort:
      return 'effort';
    case MetricType.Equipment:
      return 'equipment';
    case MetricType.Resistance:
      return 'resistance';
    case MetricType.Distance:
      return 'distance';
    case MetricType.Action:
      return 'action';
    default:
      return 'custom';
  }
}

export function extractLineTokens(
  state: EditorState,
  providedFocus?: CursorFocusState | null,
): LineInspection {
  const focus = providedFocus !== undefined ? providedFocus : getCursorFocusState(state);
  const head = state?.selection?.main?.head ?? focus?.lineFrom ?? 0;
  const hasRealDoc =
    typeof state?.doc?.lineAt === 'function' && typeof state?.doc?.sliceString === 'function';
  const line = hasRealDoc
    ? state.doc.lineAt(Math.min(head, state.doc.length))
    : {
        number: focus?.cursorLine ?? 1,
        from: focus?.lineFrom ?? 0,
        to: focus?.lineTo ?? 0,
        text:
          typeof state?.doc?.sliceString === 'function'
            ? state.doc.sliceString(focus?.lineFrom ?? 0, focus?.lineTo ?? 0)
            : '',
      };

  let section: EditorSection | null = focus?.section ?? null;
  if (!section && typeof state?.field === 'function') {
    const allSecs = state.field(sectionField, false)?.sections ?? [];
    section =
      allSecs.find(
        (s) =>
          (s.type === 'time' || s.type === 'log' || s.type === 'query') &&
          line.number >= s.startLine &&
          line.number <= s.endLine,
      ) ?? null;
    if (!section) {
      try {
        section = activeCursorSection(state);
      } catch {
        section = null;
      }
    }
  }

  const isWorkoutBody =
    (section?.type === 'time' || section?.type === 'log') &&
    line.number > section.startLine &&
    line.number < section.endLine;
  const isQueryBody =
    section?.type === 'query' && line.number > section.startLine && line.number < section.endLine;

  const contextKind: 'workout' | 'query' | 'markdown' = isWorkoutBody
    ? 'workout'
    : isQueryBody
      ? 'query'
      : 'markdown';

  if (!isWorkoutBody || !section) {
    return {
      contextKind,
      section,
      focus,
      lineNum: line.number,
      lineFrom: line.from,
      lineTo: line.to,
      lineText: line.text,
      tokens: [],
      lintFixes: [],
    };
  }

  const lintFixes = detectLineSyntaxFixes(line.text, line.from);
  const tokens: InspectorToken[] = [];
  const seenRanges = new Set<string>();

  for (const lf of lintFixes) {
    const key = `${lf.from}:${lf.to}`;
    seenRanges.add(key);
    tokens.push({
      id: `tok-${lf.id}`,
      kind: 'lintError',
      raw: lf.raw,
      displayLabel: lf.raw,
      from: lf.from,
      to: lf.to,
      lineNum: line.number,
      lintMessage: lf.message,
      lintFixes: lf.fixes,
    });
  }

  const contentFrom = section.contentFrom ?? line.from;
  const statements: ICodeStatement[] =
    focus?.allStatements?.filter((s) => (s.meta?.line ?? 0) === line.number - section.startLine) ??
    (focus?.statement ? [focus.statement] : []);

  for (const stmt of statements) {
    // Track explicit equipment prefixes (`KB` in `KB swings`) so Effort spans past equipment.
    const equipmentRanges: Array<{ from: number; to: number }> = [];
    for (const m of stmt.metrics) {
      if (m.type !== MetricType.Equipment) continue;
      const eqMeta = getReferenceMetadata(m.metadata);
      if (eqMeta?.matched === 'whole' || eqMeta?.matched === 'default') continue;
      const meta = stmt.metricMeta?.get(m);
      if (meta) {
        equipmentRanges.push({
          from: contentFrom + meta.startOffset,
          to: contentFrom + meta.endOffset,
        });
      }
    }

    Array.from(stmt.metrics).forEach((metric: IMetric, idx: number) => {
      if (metric.type === MetricType.Sound || metric.type === MetricType.System) return;
      if (metric.type === MetricType.Hint) return;

      const tagRef = getTagReference(metric.metadata);
      const isTagMarker = typeof metric.type === 'string' && metric.type.startsWith(TAG_MARKER_PREFIX);
      if (tagRef && !isTagMarker) return;

      const refMeta = getReferenceMetadata(metric.metadata);
      if (metric.type === MetricType.Equipment) {
        if (refMeta?.matched === 'whole' || refMeta?.matched === 'default') return;
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

      // Skip tokens overlapped by an already-detected lintError fix span
      const overlapsLint = lintFixes.some((lf) => from < lf.to && to > lf.from);
      if (overlapsLint) return;

      const rangeKey = `${from}:${to}`;
      if (seenRanges.has(rangeKey)) return;
      seenRanges.add(rangeKey);

      const raw = state.doc.sliceString(from, to);
      const firstDiag = refMeta?.diagnostics?.[0];
      const hasDiag = (refMeta?.diagnostics?.length ?? 0) > 0;
      const firstRef = refMeta?.refs?.[0];

      const effectiveMetric =
        metric.type === MetricType.Choice
          ? ((metric as ChoiceGroupMetric).alternatives[0] ?? metric)
          : metric;

      const kind = classifyMetricKind(effectiveMetric, raw, hasDiag, isTagMarker, Boolean(tagRef));
      const trimmed = raw.trim();
      const isRest = kind === 'duration' && trimmed.startsWith('*');
      const isTag = kind === 'tag' || (kind === 'unresolved' && trimmed.startsWith('#'));

      const tok: InspectorToken = {
        id: `tok-${line.number}-${from}-${idx}`,
        kind,
        raw,
        displayLabel:
          kind === 'rep'
            ? `${trimmed} reps`
            : kind === 'unresolved'
              ? `? ${trimmed}`
              : trimmed,
        from,
        to,
        lineNum: line.number,
        metric: effectiveMetric,
        refKind: firstRef?.kind,
        refSlug: firstRef?.slug,
        tagRef,
        isTag,
        isRest,
        diagnostic: firstDiag
          ? {
              reason: firstDiag.reason,
              message: firstDiag.message,
              token: firstDiag.token,
              candidates: firstDiag.candidates,
            }
          : isTag && kind === 'unresolved'
            ? {
                reason: 'unknown-tag',
                message: `Unknown tag ${trimmed} — create it in one tap.`,
                token: trimmed,
              }
            : undefined,
      };

      if (kind === 'duration') tok.durationMeta = parseDurationToken(trimmed);
      if (kind === 'resistance') tok.resistanceMeta = parseResistanceToken(trimmed);
      if (kind === 'distance') tok.distanceMeta = parseDistanceToken(trimmed);

      tokens.push(tok);
    });
  }

  // Catch trailing `#unrecognized` tag strings if not produced by metrics (e.g. partial line parse)
  const extraTagRe = /(?:^|\s)(#[a-zA-Z0-9-]+)(?=\s|$)/g;
  let tm: RegExpExecArray | null;
  while ((tm = extraTagRe.exec(line.text)) !== null) {
    const raw = tm[1];
    const startOff = tm.index + tm[0].length - raw.length;
    const from = line.from + startOff;
    const to = from + raw.length;
    if (tokens.some((t) => from < t.to && to > t.from)) continue;
    const slug = raw.slice(1);
    const resolved = getTagIndex().resolve(slug);
    tokens.push({
      id: `tok-${line.number}-${from}-tag`,
      kind: resolved ? 'tag' : 'unresolved',
      raw,
      displayLabel: resolved ? raw : `? ${raw}`,
      from,
      to,
      lineNum: line.number,
      isTag: true,
      diagnostic: resolved
        ? undefined
        : { reason: 'unknown-tag', message: `Unknown tag ${raw} — create it in one tap.`, token: raw },
    });
  }

  tokens.sort((a, b) => a.from - b.from);

  return {
    contextKind,
    section,
    focus,
    lineNum: line.number,
    lineFrom: line.from,
    lineTo: line.to,
    lineText: line.text,
    tokens,
    lintFixes,
  };
}

export function extractBlockTimeline(state: EditorState, section: EditorSection): BlockTimelineItem[] {
  if (section.type !== 'time' && section.type !== 'log') return [];
  const items: BlockTimelineItem[] = [];
  for (let ln = section.startLine + 1; ln < section.endLine; ln++) {
    const line = state.doc.line(ln);
    const text = line.text.trim();
    if (!text) continue;
    const fixes = detectLineSyntaxFixes(line.text, line.from);
    const durMatch = /(?:^|\s)([*^]?\d*:\d{2}|:\?)\b/.exec(text);
    const isRest = /[:*\s]\*|:rest\b|\[:rest\]/i.test(text);
    const durLabel = durMatch
      ? durMatch[1].replace(/^[*^]/, '')
      : isRest
        ? 'Rest'
        : 'Effort';

    items.push({
      lineNum: ln,
      text,
      label: text.length > 36 ? `${text.slice(0, 35)}…` : text,
      durationLabel: fixes.length > 0 ? 'Fix' : durLabel,
      isRest,
      hasError: fixes.length > 0,
    });
  }
  return items;
}

export function replaceTokenInView(
  view: EditorView,
  token: Pick<InspectorToken, 'from' | 'to' | 'lineNum'>,
  replacementRaw: string,
): { applied: boolean; nextText: string; from: number; to: number } {
  if (token.lineNum < 1 || token.lineNum > view.state.doc.lines) {
    return { applied: false, nextText: '', from: 0, to: 0 };
  }
  const line = view.state.doc.line(token.lineNum);
  const safeFrom = Math.max(line.from, Math.min(token.from, line.to));
  const safeTo = Math.max(safeFrom, Math.min(token.to, line.to));
  const nextText = replacementRaw.replace(/[\r\n]+/g, ' ').trim();

  view.dispatch({
    changes: { from: safeFrom, to: safeTo, insert: nextText },
    selection: { anchor: safeFrom, head: safeFrom + nextText.length },
    userEvent: 'input.wheel',
  });
  return { applied: true, nextText, from: safeFrom, to: safeFrom + nextText.length };
}

export function deleteTokenInView(
  view: EditorView,
  token: Pick<InspectorToken, 'from' | 'to' | 'lineNum'>,
): boolean {
  if (token.lineNum < 1 || token.lineNum > view.state.doc.lines) return false;
  const line = view.state.doc.line(token.lineNum);
  const safeFrom = Math.max(line.from, Math.min(token.from, line.to));
  const safeTo = Math.max(safeFrom, Math.min(token.to, line.to));

  let delFrom = safeFrom;
  let delTo = safeTo;
  const charAfter = delTo < line.to ? view.state.doc.sliceString(delTo, delTo + 1) : '';
  const charBefore = delFrom > line.from ? view.state.doc.sliceString(delFrom - 1, delFrom) : '';
  if (charAfter === ' ') {
    delTo += 1;
  } else if (charBefore === ' ' && delFrom > line.from + line.text.search(/\S|$/)) {
    delFrom -= 1;
  }

  view.dispatch({
    changes: { from: delFrom, to: delTo, insert: '' },
    selection: { anchor: delFrom },
    userEvent: 'input.wheel',
  });
  return true;
}

export function insertTokenOnLineInView(
  view: EditorView,
  lineNum: number,
  rawToken: string,
): { from: number; to: number; clean: string } | null {
  if (lineNum < 1 || lineNum > view.state.doc.lines) return null;
  const line = view.state.doc.line(lineNum);
  const clean = rawToken.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return null;
  const trimmed = line.text.trimEnd();
  const needsSpace = trimmed.length > 0;
  const insertAt = line.from + trimmed.length;
  const insert = `${needsSpace ? ' ' : ''}${clean}`;
  const tokStart = insertAt + (needsSpace ? 1 : 0);
  const tokEnd = insertAt + insert.length;

  view.dispatch({
    changes: { from: insertAt, to: line.to, insert },
    selection: { anchor: tokStart, head: tokEnd },
    userEvent: 'input.wheel',
  });
  return { from: tokStart, to: tokEnd, clean };
}

export function applyQuickFixInView(view: EditorView, fix: LineQuickFix, replacement: string): boolean {
  const line = view.state.doc.lineAt(Math.min(fix.from, view.state.doc.length));
  const safeFrom = Math.max(line.from, Math.min(fix.from, line.to));
  const safeTo = Math.max(safeFrom, Math.min(fix.to, line.to));
  const clean = replacement.replace(/[\r\n]+/g, ' ').trim();
  view.dispatch({
    changes: { from: safeFrom, to: safeTo, insert: clean },
    selection: { anchor: safeFrom + clean.length },
    userEvent: 'input.wheel',
  });
  return true;
}

export function updateFenceHeaderInView(
  view: EditorView,
  section: EditorSection,
  patch: { dialect?: 'time' | 'log'; sport?: string },
): boolean {
  const startLine = view.state.doc.line(section.startLine);
  const match = /^(\s*`{3,})(time|log|wod|whiteboard)(?::([a-z0-9_-]+))?(.*)$/i.exec(startLine.text);
  if (!match) return false;

  const ticks = match[1];
  const nextDialect = patch.dialect ?? (section.type === 'log' ? 'log' : 'time');
  const nextSport = patch.sport !== undefined ? patch.sport.trim() : (match[3] ?? '');
  const tail = match[4] ?? '';
  const sportSuffix = nextSport ? `:${nextSport}` : '';
  const nextHeader = `${ticks}${nextDialect}${sportSuffix}${tail}`;

  view.dispatch({
    changes: { from: startLine.from, to: startLine.to, insert: nextHeader },
    userEvent: 'input.dialect',
  });
  return true;
}

export function insertTemplateInSectionView(
  view: EditorView,
  section: EditorSection,
  templateLines: readonly string[],
): boolean {
  if (section.contentFrom === undefined || section.contentTo === undefined) return false;
  const existing = view.state.doc.sliceString(section.contentFrom, section.contentTo);
  const body = templateLines.join('\n');
  const isEmpty = !existing.trim();
  const insert = isEmpty ? `${body}\n` : `${existing.trimEnd()}\n${body}\n`;

  view.dispatch({
    changes: { from: section.contentFrom, to: section.contentTo, insert },
    selection: { anchor: section.contentFrom },
    userEvent: 'input.wheel',
  });
  return true;
}

export function insertProseWikiLinkInView(view: EditorView, noteTitle: string): boolean {
  const sel = view.state.selection.main;
  const link = `[[${noteTitle.trim()}]]`;
  const charBefore = sel.from > 0 ? view.state.doc.sliceString(sel.from - 1, sel.from) : '';
  const insert = `${charBefore && !/[\s([]/.test(charBefore) ? ' ' : ''}${link}`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
    userEvent: 'input.format',
  });
  return true;
}

export function insertProseTagInView(view: EditorView, slug: string): boolean {
  const sel = view.state.selection.main;
  const clean = slug.startsWith('#') ? slug : `#${slug}`;
  const charBefore = sel.from > 0 ? view.state.doc.sliceString(sel.from - 1, sel.from) : '';
  const insert = `${charBefore && !/\s/.test(charBefore) ? ' ' : ''}${clean} `;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
    userEvent: 'input.format',
  });
  return true;
}

export function searchEffortsFromCatalog(
  query: string,
  scope?: NotebookScopeSnapshot,
): Array<{ slug: string; label: string; aliases: readonly string[]; discipline?: string; scoped: boolean }> {
  const registry = getAppEffortRegistry();
  const items: readonly IEffort[] = registry.isInitialized() ? registry.list() : [];
  const q = query.trim().toLowerCase();
  const mapped = items
    .map((e) => {
      const scoped =
        Boolean(scope?.defaultEffort && e.slug === scope.defaultEffort) ||
        Boolean(scope?.defaultEquipment?.some((eq) => e.equipment?.includes(eq)));
      return {
        slug: e.slug,
        label: e.label,
        aliases: e.aliases ?? [],
        discipline: e.baseAttributes?.discipline,
        scoped,
      };
    })
    .filter((e) => {
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });

  mapped.sort((a, b) => {
    if (q) {
      const aExact = a.label.toLowerCase().startsWith(q) ? 1 : 0;
      const bExact = b.label.toLowerCase().startsWith(q) ? 1 : 0;
      if (bExact !== aExact) return bExact - aExact;
    }
    if (a.scoped !== b.scoped) return Number(b.scoped) - Number(a.scoped);
    return a.label.localeCompare(b.label);
  });

  if (mapped.length > 0) return mapped.slice(0, 40);

  const fallbacks = [
    { slug: 'kettlebell-swing', label: 'Kettlebell Swing', aliases: ['swing', 'kb swing', 'kbs'], scoped: true },
    { slug: 'back-squat', label: 'Back Squat', aliases: ['bs', 'squat'], scoped: false },
    { slug: 'pull-up', label: 'Pull-up', aliases: ['pullup', 'kipping pullup'], scoped: false },
    { slug: 'push-up', label: 'Push-up', aliases: ['pushup'], scoped: false },
    { slug: 'air-squat', label: 'Air Squat', aliases: ['squat'], scoped: false },
    { slug: 'thruster', label: 'Thruster', aliases: ['thrusters'], scoped: false },
    { slug: 'burpee', label: 'Burpee', aliases: ['burpees'], scoped: false },
    { slug: 'run', label: 'Run', aliases: ['running'], scoped: false },
    { slug: 'row', label: 'Row', aliases: ['rowing', 'erg'], scoped: false },
    { slug: 'plank', label: 'Plank', aliases: ['plank hold'], scoped: false },
  ];
  return fallbacks.filter((f) =>
    !q ||
    f.label.toLowerCase().includes(q) ||
    f.slug.includes(q) ||
    f.aliases.some((a) => a.includes(q)),
  );
}

export function searchEquipmentFromCatalog(query: string): Array<{ slug: string; label: string }> {
  const registry = getAppEquipmentRegistry();
  const list: readonly IEquipment[] = registry.isInitialized() ? registry.list() : [];
  const q = query.trim().toLowerCase();
  const filtered = list
    .filter((item) => !q || item.label.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q))
    .slice(0, 30)
    .map((item) => ({ slug: item.slug, label: item.label }));

  if (filtered.length > 0) return filtered;
  return [
    { slug: 'kettlebell', label: 'Kettlebell' },
    { slug: 'barbell', label: 'Barbell' },
    { slug: 'dumbbell', label: 'Dumbbell' },
    { slug: 'pull-up-bar', label: 'Pull-up Bar' },
    { slug: 'rower', label: 'Rower' },
  ].filter((x) => !q || x.label.toLowerCase().includes(q));
}

export function searchTagsFromCatalog(query: string): Array<{ slug: string; category: string }> {
  const defs = getTagIndex().list().filter((d) => !d.isCategory);
  const q = query.trim().replace(/^#/, '').toLowerCase();
  const summarize = (first: (typeof defs)[number]['contributions'][number] | undefined): string => {
    if (!first) return 'Tag';
    if (first.kind === 'metric') return first.type;
    if (first.kind === 'function') return first.name;
    return first.slug;
  };
  const items = defs
    .map((d) => ({ slug: d.slug, category: summarize(d.contributions[0]) }))
    .filter((d) => !q || d.slug.toLowerCase().includes(q) || d.category.toLowerCase().includes(q))
    .slice(0, 40);

  if (items.length > 0) return items;
  return [
    { slug: 'emom', category: 'Format' },
    { slug: 'amrap', category: 'Format' },
    { slug: 'tabata', category: 'Format' },
    { slug: 'for-time', category: 'Format' },
    { slug: 'strength', category: 'Focus' },
    { slug: 'heavy', category: 'Load' },
  ].filter((t) => !q || t.slug.includes(q));
}

export async function searchWikiNotesFromStorage(query: string): Promise<Array<{ noteId: string; title: string; summary: string }>> {
  const notes = await storageService.getAllNotes().catch(() => []);
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const results: Array<{ noteId: string; title: string; summary: string }> = [];

  for (const note of notes) {
    const title = note.title?.trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    if (q && !title.toLowerCase().includes(q) && !note.tags?.some((t) => t.toLowerCase().includes(q))) {
      continue;
    }
    seen.add(title.toLowerCase());
    results.push({
      noteId: note.id,
      title,
      summary: note.tags?.slice(0, 3).map((t) => `#${t}`).join(' ') || 'Note',
    });
    if (results.length >= 25) break;
  }

  return results;
}

export function parseSectionPreview(state: EditorState, section: EditorSection): ICodeStatement[] {
  if (section.contentFrom === undefined || section.contentTo === undefined) return [];
  const raw = state.doc.sliceString(section.contentFrom, section.contentTo);
  if (!raw.trim()) return [];
  try {
    const references = getSharedReferenceIndex();
    const tags = getTagIndex();
    const parser = references
      ? createParser({ references, defaults: readNoteReferenceDefaults(state.doc.toString()), tags })
      : createParser({ tags });
    return (parser.read(raw, section.sport).statements ?? []) as ICodeStatement[];
  } catch {
    return [];
  }
}

export function keepEditorSelectionAlive(view: EditorView, anchor: number) {
  view.dispatch({ selection: EditorSelection.cursor(anchor) });
}
