/**
 * Dashboard note operations — pure markdown↔markdown transforms over the
 * locked dashboard-note format (#899). Every operation:
 *
 *  - takes the note's raw content and returns the NEW raw content (the caller
 *    persists through journalNotes, the only write path);
 *  - is identity-guarded: the target widget is located by its positional key
 *    (`w${index}`, matching buildDashboardDocument) AND its expected body
 *    content. A guard mismatch returns null and writes NOTHING — a concurrent
 *    edit or reorder between read and write can never retarget the splice to
 *    the wrong widget.
 *
 * A widget's editable unit is its "group": the title heading / coaching
 * question paragraph the document builder associates with the block (strict
 * adjacency, same rule as buildDashboardDocument) plus the ```query fence
 * itself. Move/duplicate/remove operate on the whole group so the rendered
 * card — title, question, chart — travels together.
 */

import { parseDashboardNote, type DashboardParsedSection } from './parser';
import { DASHBOARD_GRID_MAX_COLS } from './model';
import type { NoteBlockChange } from '@bitcobblers/wod-wiki-core';

// ── Widget spec ────────────────────────────────────────────────────────────

export interface WidgetSpec {
  /** Card title — renders as a `## ` heading above the block. */
  title?: string;
  /** Coaching question — the paragraph between the heading and the block. */
  question?: string;
  /** Raw widget type from the fence suffix ('' → the `table` default). */
  type: string;
  spanCols?: number;
  spanFull?: boolean;
  /** The composed Query Document text — stored verbatim as the block body
   *  (single-line or multi-line; decision 22). */
  wql: string;
  /** Fence-tag presentation attributes (goal targets, …). */
  attributes?: Record<string, string>;
  /** Attribute emission order (defaults to Object key order). */
  attributeOrder?: string[];
}

export type WidgetSpan = Pick<WidgetSpec, 'spanCols' | 'spanFull'>;

/** Opening fence line for a widget spec — type/span plus `key=value`
 *  attributes (decision 22: presentation params ride the fence tag). */
export function widgetFenceTag(spec: Pick<WidgetSpec, 'type' | 'spanCols' | 'spanFull' | 'attributes' | 'attributeOrder'>): string {
  const type = spec.type.trim();
  let suffix = type === '' ? '' : `:${type}`;
  if (spec.spanFull) {
    suffix += '-full';
  } else if (spec.spanCols != null && spec.spanCols > 1) {
    suffix += `-${spec.spanCols}`;
  }
  const attrs = spec.attributes ?? {};
  for (const key of spec.attributeOrder ?? Object.keys(attrs)) {
    if (!(key in attrs)) continue;
    const value = attrs[key];
    const encoded = /^[a-zA-Z0-9_.-]+$/.test(value) ? value : `"${value.replace(/"/g, '')}"`;
    suffix += ` ${key}=${encoded}`;
  }
  return `\`\`\`query${suffix}`;
}

/** Block body: the Query Document text verbatim (trimmed). */
export function widgetBodyLine(spec: Pick<WidgetSpec, 'wql'>): string {
  return spec.wql.trim();
}

/** The markdown lines of a whole widget group (heading? / question? / fence block). */
export function renderWidgetGroup(spec: WidgetSpec): string[] {
  const lines: string[] = [];
  const title = spec.title?.trim();
  const question = spec.question?.trim();
  if (title) lines.push(`## ${title}`);
  if (question) lines.push(question);
  if (lines.length > 0) lines.push('');
  lines.push(widgetFenceTag(spec));
  lines.push(widgetBodyLine(spec));
  lines.push('```');
  return lines;
}

// ── Group location ─────────────────────────────────────────────────────────

interface WidgetGroup {
  /** Index into the query-section (widget) ordering — the `w${i}` key. */
  widgetIndex: number;
  /** Absolute line range in the raw content, covering the whole group. */
  startLine: number;
  endLine: number;
}

/**
 * Locate a widget's group, identity-guarded by its expected block body (the
 * `body` field buildDashboardDocument produced when the caller last parsed).
 * Returns null when the widget vanished or the body no longer matches —
 * the caller must re-read and never write.
 */
function findWidgetGroup(
  sections: readonly DashboardParsedSection[],
  key: string,
  expectedBody: string,
): { ok: true; group: WidgetGroup } | { ok: false; reason: 'not-found' | 'stale-body' } {
  const querySections = sections.filter((s) => s.type === 'query');
  const widgetIndex = querySections.findIndex((_, i) => `w${i}` === key);
  if (widgetIndex === -1) return { ok: false, reason: 'not-found' };
  const block = querySections[widgetIndex]!;

  // Identity guard (decision 22): the widget's EXACT full fenced body must
  // still be what the caller's last parse saw — any concurrent change
  // stale-marks the operation (re-read; never a blind or partial write).
  const body = block.content
    .split('\n')
    .filter((l) => { const s = l.trim(); return s !== '' && !s.startsWith('#'); })
    .map((l) => l.trim())
    .join('\n');
  if (body !== expectedBody.trim()) return { ok: false, reason: 'stale-body' };

  return {
    ok: true,
    group: { widgetIndex, startLine: groupStartLine(sections, block), endLine: block.endLine },
  };
}

/**
 * Group start for a query block: the associated title heading / coaching
 * question paragraph directly above it (strict adjacency — the document
 * builder's association rule), or the block's own line when untitled.
 */
function groupStartLine(sections: readonly DashboardParsedSection[], block: DashboardParsedSection): number {
  const idx = sections.indexOf(block);
  const above = sections[idx - 1];
  if (above?.type === 'markdown' && above.subtype === 'paragraph') {
    const heading = sections[idx - 2];
    return heading?.type === 'markdown' && heading.subtype === 'heading'
      ? heading.startLine
      : above.startLine;
  }
  if (above?.type === 'markdown' && above.subtype === 'heading') return above.startLine;
  return block.startLine;
}

/** Line ranges of every widget group, in widget order. */
function widgetGroupRanges(sections: readonly DashboardParsedSection[]): WidgetGroup[] {
  return sections
    .filter((s) => s.type === 'query')
    .map((block, widgetIndex) => ({
      widgetIndex,
      startLine: groupStartLine(sections, block),
      endLine: block.endLine,
    }));
}

// ── Operations ─────────────────────────────────────────────────────────────

/**
 * Append a new widget group at the end of the note body. Frontmatter and all
 * existing content are preserved verbatim.
 */
export function appendWidget(raw: string, spec: WidgetSpec): string {
  const lines = raw.split('\n');
  const group = renderWidgetGroup(spec);
  // Separate the new group from the body with exactly one blank line.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return [...lines, '', ...group, ''].join('\n');
}

/** Structured operation result (decision 22): a missing widget is distinct
 *  from a concurrent edit, and neither silently no-ops. */
export type WidgetOpResult =
  | { ok: true; note: string; changes: NoteBlockChange[]; retainedBlocks: Array<{ from: number; to: number; nextFrom: number; nextTo: number }> }
  | { ok: false; reason: 'not-found' | 'stale-body' };

function widgetResult(raw: string, note: string, order?: Array<number | null>): Extract<WidgetOpResult, { ok: true }> {
  let from = 0;
  while (from < raw.length && from < note.length && raw[from] === note[from]) from++;
  let to = raw.length;
  let nextTo = note.length;
  while (to > from && nextTo > from && raw[to - 1] === note[nextTo - 1]) { to--; nextTo--; }
  const queries = parseDashboardNote(raw).sections.filter(section => section.type === 'query');
  const nextQueries = parseDashboardNote(note).sections.filter(section => section.type === 'query');
  const oldOffsets = lineOffsets(raw);
  const nextOffsets = lineOffsets(note);
  const oldLines = raw.split('\n');
  const nextLines = note.split('\n');
  const retainedBlocks: Extract<WidgetOpResult, { ok: true }>['retainedBlocks'] = [];
  for (const [nextIndex, oldIndex] of (order ?? queries.map((_, index) => index)).entries()) {
    if (oldIndex === null) continue;
    const block = queries[oldIndex];
    const next = nextQueries[nextIndex];
    if (!block || !next) throw new Error('Widget mutation lost its source lineage');
    retainedBlocks.push({ from: oldOffsets[block.startLine], to: oldOffsets[block.endLine] + oldLines[block.endLine].replace(/\r$/, '').length,
      nextFrom: nextOffsets[next.startLine], nextTo: nextOffsets[next.endLine] + nextLines[next.endLine].replace(/\r$/, '').length });
  }
  return { ok: true, note, changes: raw === note ? [] : [{ from, to, insert: note.slice(from, nextTo) }], retainedBlocks };
}

function lineOffsets(raw: string): number[] {
  let offset = 0;
  return raw.split('\n').map(line => { const from = offset; offset += line.length + 1; return from; });
}

/**
 * Replace a widget's whole group (title/question/type/body) in place.
 * Identity-guarded against the widget's exact full body text.
 */
export function updateWidget(
  raw: string,
  key: string,
  expectedBody: string,
  spec: WidgetSpec,
): WidgetOpResult {
  const { sections } = parseDashboardNote(raw);
  const found = findWidgetGroup(sections, key, expectedBody);
  if (!found.ok) return found;
  const { group } = found;
  const lines = raw.split('\n');
  lines.splice(group.startLine, group.endLine - group.startLine + 1, ...renderWidgetGroup(spec));
  return widgetResult(raw, lines.join('\n'));
}

/** Duplicate a widget's group directly below itself. Identity-guarded. */
export function duplicateWidget(
  raw: string,
  key: string,
  expectedBody: string,
): WidgetOpResult {
  const { sections } = parseDashboardNote(raw);
  const found = findWidgetGroup(sections, key, expectedBody);
  if (!found.ok) return found;
  const { group } = found;
  const lines = raw.split('\n');
  const copy = lines.slice(group.startLine, group.endLine + 1);
  // Insert the copy after the original, blank-line separated.
  lines.splice(group.endLine + 1, 0, '', ...copy);
  const order: Array<number | null> = sections.filter(section => section.type === 'query').map((_, index) => index);
  order.splice(group.widgetIndex + 1, 0, null);
  return widgetResult(raw, lines.join('\n'), order);
}

/**
 * Remove a widget's group (title/question/fence). Identity-guarded. Collapses
 * the blank-line gap the removal leaves behind.
 */
export function removeWidget(
  raw: string,
  key: string,
  expectedBody: string,
): WidgetOpResult {
  const { sections } = parseDashboardNote(raw);
  const found = findWidgetGroup(sections, key, expectedBody);
  if (!found.ok) return found;
  const { group } = found;
  const lines = raw.split('\n');
  lines.splice(group.startLine, group.endLine - group.startLine + 1);
  // Collapse a blank sandwich (line before + line after both empty).
  if (
    group.startLine > 0 &&
    group.startLine < lines.length &&
    lines[group.startLine - 1] === '' &&
    lines[group.startLine] === ''
  ) {
    lines.splice(group.startLine, 1);
  }
  const order = sections.filter(section => section.type === 'query').map((_, index) => index);
  order.splice(group.widgetIndex, 1);
  return widgetResult(raw, lines.join('\n'), order);
}

/**
 * Reorder a widget among the query blocks — the whole group (title, question,
 * block) moves past its neighbor. `delta` is -1 (up) or +1 (down); out-of-range
 * moves are no-ops that return the content unchanged. Identity-guarded.
 */
export function moveWidget(
  raw: string,
  key: string,
  expectedBody: string,
  delta: -1 | 1,
): WidgetOpResult {
  const { sections } = parseDashboardNote(raw);
  const found = findWidgetGroup(sections, key, expectedBody);
  if (!found.ok) return found;
  const { group } = found;
  const groups = widgetGroupRanges(sections);
  const neighbor = groups[group.widgetIndex + delta];
  if (!neighbor) return widgetResult(raw, raw);

  const lines = raw.split('\n');
  const moving = lines.slice(group.startLine, group.endLine + 1);

  if (delta === -1) {
    lines.splice(group.startLine, group.endLine - group.startLine + 1);
    lines.splice(neighbor.startLine, 0, ...moving);
  } else {
    // Remove the moving group first (shifts the neighbor's start when the
    // neighbor comes after), then insert past the neighbor's new end.
    lines.splice(group.startLine, group.endLine - group.startLine + 1);
    const shift = group.startLine < neighbor.startLine ? group.endLine - group.startLine + 1 : 0;
    const insertAt = neighbor.endLine - shift + 1;
    lines.splice(insertAt, 0, ...moving);
  }
  const order = groups.map((_, index) => index);
  order.splice(group.widgetIndex, 1);
  order.splice(group.widgetIndex + delta, 0, group.widgetIndex);
  return widgetResult(raw, lines.join('\n'), order);
}

/**
 * Resize (or re-span) a widget: rewrites only the opening fence line, leaving
 * the body, params, and surrounding markdown untouched. `spanFull` wins over
 * `spanCols`. Identity-guarded.
 */
export function resizeWidget(
  raw: string,
  key: string,
  expectedBody: string,
  span: WidgetSpan,
): WidgetOpResult {
  if (span.spanCols != null && (span.spanCols < 1 || span.spanCols > DASHBOARD_GRID_MAX_COLS)) {
    return { ok: false, reason: 'stale-body' }; // out-of-range span: refuse the write
  }
  const { sections } = parseDashboardNote(raw);
  const found = findWidgetGroup(sections, key, expectedBody);
  if (!found.ok) return found;
  const { group } = found;
  const block = sections.find(
    (s) => s.type === 'query' && s.startLine >= group.startLine && s.endLine <= group.endLine,
  )!;
  const lines = raw.split('\n');
  const indent = lines[block.startLine].match(/^\s*/)![0];
  lines[block.startLine] =
    indent +
    widgetFenceTag({
      type: block.widgetType ?? '',
      spanCols: span.spanCols,
      spanFull: span.spanFull,
      attributes: block.attributes,
      attributeOrder: block.attributeOrder,
    });
  return widgetResult(raw, lines.join('\n'));
}

// ── Legacy body migration (decision 22) ───────────────────────────────────

/**
 * Rewrite one dashboard note's legacy widget bodies to Query Documents
 * (decision 22, answer 1): the first-` / ` positional split is retired.
 * For each query fence whose body carries ` / ` positional params, the
 * query text stays the body and the params move onto the fence tag as
 * numbered attributes (`param1=…`) — values preserved verbatim, losslessly
 * editable. A body already document-shaped is untouched; the note that
 * cannot be rewritten safely returns unchanged (the caller badges it).
 */
export function migrateLegacyDashboardBodies(raw: string): string {
  let out = raw;
  // Iterate fence blocks: ```query<suffix>\n<body>\n```
  const pattern = /(?:^|\n)([ \t]*)```query([^\n]*)\n([\s\S]*?)\n[ \t]*```/g;
  out = out.replace(pattern, (match, indent: string, suffix: string, body: string) => {
    const trimmed = body.trim();
    const sep = trimmed.indexOf(' / ');
    if (sep === -1) return match; // already a document — untouched
    const query = trimmed.slice(0, sep).trim();
    const params = trimmed.slice(sep + 3).split(/\s+/).filter((p) => p !== '');
    const attrs = params
      .map((p, i) => (/^[a-zA-Z][a-zA-Z0-9_-]*=/.test(p) ? p : `param${i + 1}=${p}`))
      .join(' ');
    const newSuffix = suffix.trimEnd() + (suffix.includes('=') ? '' : (suffix.trim() === '' ? ' ' : ' ')) + attrs;
    return `${indent}\`\`\`query${newSuffix}\n${query}\n\`\`\``;
  });
  return out;
}
