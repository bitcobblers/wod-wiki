/**
 * Field catalog — contribution extraction and delta math (wayfinder
 * datadog-analytics ticket 14, per the field discovery contract's
 * incremental write contract).
 *
 * Pure module: no IndexedDB access. The service layer (IndexedDBService)
 * calls `computeCatalogDeltas` inside the SAME transaction as the source
 * mutation so a save, its catalog reference deltas, and the reversal record
 * commit atomically — a failed persistence leaves no phantom catalog field,
 * a failed catalog update leaves the source unchanged.
 *
 * Idempotency: each source's previous contribution set is stored in
 * `field_sources`; an identical re-save produces an empty delta, so
 * reference counts never double-increment.
 */

import type {
  FieldContribution,
  Note,
  Session,
} from '@bitcobblers/wod-wiki-core';
import { fieldRefKey } from '@bitcobblers/wod-wiki-core';
import { parseFrontmatter } from '@bitcobblers/wod-wiki-wql';

/** Multiset identity of one contribution — unit/value/spelling evidence is
 *  part of the reversal record, so an evidence change is a real delta. */
function contributionKey(c: FieldContribution): string {
  return JSON.stringify([c.fieldId, c.unit ?? null, c.spelling ?? null, c.value ?? null]);
}

/** Stable source-record identity: entity kind + record id. */
export function fieldSourceId(entityKind: 'result' | 'note', recordId: string): string {
  return `${entityKind}:${recordId}`;
}

/**
 * Multiset diff between a source's previous and next contribution sets.
 * `added` must increment reference counts, `removed` decrement (pruning at
 * zero is the service layer's job).
 */
export function computeCatalogDeltas(
  previous: readonly FieldContribution[],
  next: readonly FieldContribution[],
): { added: FieldContribution[]; removed: FieldContribution[] } {
  const previousCounts = new Map<string, number>();
  for (const c of previous) previousCounts.set(contributionKey(c), (previousCounts.get(contributionKey(c)) ?? 0) + 1);
  const nextCounts = new Map<string, number>();
  for (const c of next) nextCounts.set(contributionKey(c), (nextCounts.get(contributionKey(c)) ?? 0) + 1);

  const added: FieldContribution[] = [];
  const removed: FieldContribution[] = [];
  for (const [key, count] of nextCounts) {
    const before = previousCounts.get(key) ?? 0;
    if (count > before) {
      const exemplar = next.find((c) => contributionKey(c) === key)!;
      for (let i = 0; i < count - before; i++) added.push(exemplar);
    }
  }
  for (const [key, count] of previousCounts) {
    const after = nextCounts.get(key) ?? 0;
    if (after < count) {
      const exemplar = previous.find((c) => contributionKey(c) === key)!;
      for (let i = 0; i < count - after; i++) removed.push(exemplar);
    }
  }
  return { added, removed };
}

interface LooseMetric {
  type?: string;
  value?: unknown;
  unit?: string;
  metadata?: Record<string, unknown>;
}

/** Contribution identity for one metric observation. Unkeyed custom metrics
 *  (no canonicalKey, no fieldRef) contribute NOTHING — the catalog never
 *  invents the pooled `custom` identity (finding 3.1). */
function contributionOfMetric(m: LooseMetric): FieldContribution | undefined {
  const metadata = m.metadata ?? {};
  const fieldRef = metadata.fieldRef as { path?: unknown; kind?: unknown; dimension?: unknown } | undefined;
  const canonicalKey = typeof metadata.canonicalKey === 'string' && metadata.canonicalKey ? metadata.canonicalKey : undefined;
  const originalKey = typeof metadata.originalKey === 'string' && metadata.originalKey ? metadata.originalKey : undefined;

  let path: string;
  let kind: string;
  if (fieldRef && typeof fieldRef.path === 'string' && typeof fieldRef.kind === 'string') {
    path = fieldRef.path;
    kind = fieldRef.kind;
  } else if (canonicalKey) {
    path = canonicalKey;
    kind = typeof m.value === 'number' ? 'number' : typeof m.value === 'boolean' ? 'boolean' : typeof m.value === 'string' ? 'string' : 'number';
  } else {
    return undefined;
  }

  const spelling = originalKey ?? canonicalKey;
  const value = typeof m.value === 'string' ? m.value : typeof m.value === 'boolean' ? String(m.value) : undefined;
  return {
    fieldId: fieldRefKey({ path, kind: kind as never, ...(typeof fieldRef?.dimension === 'string' ? { dimension: fieldRef.dimension } : {}) }),
    path,
    kind,
    ...(m.unit ? { unit: m.unit } : {}),
    ...(spelling ? { spelling } : {}),
    ...(value !== undefined ? { value } : {}),
  };
}

/**
 * Contributions of a LEGACY `results`-store row (pre-V21): those rows carried
 * the statement stream inline under `data.logs`. Live sessions hold metadata
 * only — their contributions come from `extractContributionsFromEventRows`.
 */
export function extractContributionsFromResult(
  result: Session & { data?: { logs?: unknown } },
): Array<FieldContribution & { rowId: string }> {
  const data = result.data;
  const logs: unknown = data && typeof data === 'object' && 'logs' in data ? data.logs : undefined;
  const contributions: Array<FieldContribution & { rowId: string }> = [];
  if (!Array.isArray(logs)) return contributions;
  logs.forEach((output, index) => {
    if (!output || typeof output !== 'object' || !('metrics' in output)) return;
    const metrics: unknown = output.metrics;
    if (!Array.isArray(metrics)) return;
    const rowId = typeof (output as { id?: unknown }).id === 'string' || typeof (output as { id?: unknown }).id === 'number'
      ? String((output as { id: string | number }).id)
      : `stmt:${index}`;
    for (const m of metrics as LooseMetric[]) {
      const c = contributionOfMetric(m);
      if (c) contributions.push({ ...c, rowId });
    }
  });
  return contributions;
}

/**
 * Extract the catalog contributions of unified event rows (append /
 * finalize / delete paths): the rows' metric metadata carries the identity
 * evidence (canonicalKey, fieldRef, unit, value).
 */
export function extractContributionsFromEventRows(
  rows: readonly { id?: unknown; metrics?: unknown }[],
): Array<FieldContribution & { rowId: string }> {
  const contributions: Array<FieldContribution & { rowId: string }> = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !('metrics' in row)) continue;
    const metrics: unknown = row.metrics;
    if (!Array.isArray(metrics)) continue;
    const rowId = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : '';
    for (const m of metrics as LooseMetric[]) {
      const c = contributionOfMetric(m);
      if (c) contributions.push({ ...c, rowId });
    }
  }
  return contributions;
}

/**
 * Extract the catalog contributions of a note's frontmatter scalars
 * (discovered contextual fields — the note is one source record). Nested
 * objects contribute their leaves; arrays contribute one collection field.
 */
export function extractContributionsFromNote(note: Note): Array<FieldContribution & { rowId: string }> {
  const raw: unknown = note && typeof note === 'object' && 'rawContent' in note ? note.rawContent : '';
  if (typeof raw !== 'string' || !raw.trimStart().startsWith('---')) return [];
  const { meta } = parseFrontmatter(raw);
  const contributions: Array<FieldContribution & { rowId: string }> = [];
  for (const [rawKey, rawValue] of Object.entries(meta)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (key.startsWith('metrics.') || key.startsWith('summaries.')) {
      const subKey = key.replace(/^(?:metrics|summaries)\./, '').trim();
      if (!subKey || subKey === 'effort' || subKey === 'equipment') continue;
      contributions.push({
        fieldId: fieldRefKey({ path: subKey, kind: 'number' }),
        path: subKey,
        kind: 'number',
        spelling: subKey,
        rowId: `fm:${key}`,
      });
      continue;
    }
    if (Array.isArray(rawValue) || rawValue === '' || rawValue === undefined || rawValue === null) continue;
    const strValue = String(rawValue).trim();
    if (!strValue || /^[{[>|]/.test(strValue)) continue;
    const path = key
      .split(/[\s._-]+/)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join('');
    const numeric = typeof rawValue === 'number' || /^-?\d+(\.\d+)?$/.test(strValue);
    const kind = numeric ? 'number' : 'string';
    const value = numeric ? undefined : strValue.replace(/^["']|["']$/g, '');
    contributions.push({
      fieldId: fieldRefKey({ path, kind: kind as never }),
      path,
      kind,
      ...(numeric ? {} : { value }),
      spelling: key,
      rowId: `fm:${path}`,
    });
  }
  return contributions;
}
