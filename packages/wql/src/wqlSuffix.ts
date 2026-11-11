/**
 * WqlSuffix — Unified WQL suffix parser and adapter (issue #870).
 *
 * Encapsulates suffix parsing order, regexes, depth-0 brace-aware splitting,
 * and AST extraction for all WQL suffix clauses:
 *   - Outer join: `where <joinClause>`
 *   - Display unit: `in <unit>` (analytics queries only — C2 de-overloaded `in`)
 *   - Rollup period: `.rollup(<size><unit>)`
 *   - Group-by: `by {<dims>}`
 *   - Time window: `last <n><unit>` or `from <YYYY-MM-DD> [to <YYYY-MM-DD>]`
 *     (C1 — one window per query, every family)
 */

export interface ParsedWqlRollupSuffix {
  size: number;
  unit: string;
  raw: string;
}

/** A window clause (C1): relative (`last 8w`), civil-date range
 *  (`from 2026-01-01 [to 2026-03-31]`), or a `$param` reference (`last $range`
 *  or `last $weeks w`). One window per query — `last` and `from` are mutually
 *  exclusive (validated as a C3-style conflict). */
export type ParsedWqlWindowSuffix =
  | { kind: 'relative'; size: number; unit: 'd' | 'w'; raw: string }
  | { kind: 'range'; start: string; end?: string; raw: string }
  | { kind: 'param'; param: string; unit?: 'd' | 'w'; raw: string };

export interface ParsedWqlSuffixes {
  /** Outer cross-store join clause text (`where ...`). */
  where?: string;
  /** Stored source binding target (`=> @sourceName`). */
  storedAs?: string;
  /** Source dataset reference for downstream query (`@source | ...` or `in @source`). */
  sourceRef?: string;
  /** Display unit directive (`in kg`). */
  displayUnit?: string;
  /** Rollup period (`.rollup(2w)` — 1-unit forms are rejected in parseQuery). */
  rollup?: ParsedWqlRollupSuffix;
  /** Group-by dimensions (`by {week, effort}`). */
  groupBy?: string[];
  /** Time window — relative or civil-date range, legal on every family (C1). */
  window?: ParsedWqlWindowSuffix;
  /** Legacy scope clause (`in journal` / `in all`) stripped for the C2 compatibility normalizer. */
  legacyScope?: string;
  /** Duplicate-clause diagnostics (C3) — each names both conflicting spans. */
  conflicts?: string[];
  /** Primary query text with suffixes removed. */
  primaryText: string;
}

/**
 * Split a query at the first top-level `where` keyword (depth-0, word-bounded).
 * Returns the primary half and, when present, the join clause text.
 */
export function splitAtWhere(text: string): { primary: string; where?: string } {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      c === 'w' &&
      text.slice(i, i + 5) === 'where' &&
      (i === 0 || /\s/.test(text[i - 1])) &&
      (i + 5 >= text.length || /\s/.test(text[i + 5]))
    ) {
      return { primary: text.slice(0, i).trim(), where: text.slice(i + 5).trim() };
    }
  }
  return { primary: text.trim() };
}

// ponytail: regex suffix/prefix peel for => @source and @source | ...; upgrade to Lezer AST node when source pipelines support sub-expression branches.
const STORED_AS_RE = /\s*=>\s*@?([a-zA-Z0-9_-]+)\s*$/;
const SOURCE_PREFIX_RE = /^@([a-zA-Z0-9_-]+)\s*(?:\||=>)\s*/;
const IN_SOURCE_RE = /\s+(?:in|from)\s+@([a-zA-Z0-9_-]+)\s*$/i;
const DISPLAY_UNIT_RE = /\s+in\s+([a-zA-Z0-9_-]+)\s*$/;
const ROLLUP_RE = /\.rollup\((\d+)?([a-zA-Z]*)\)\s*$/;
const BY_RE = /\s+by\s+\{([^}]*)\}\s*$/;
const LAST_RE = /\s+last\s+(\d+)([dw])\s*$/i;
const LAST_PARAM_RE = /\s+last\s+\$([a-zA-Z_][\w-]*)(?:\s+([dw]))?\s*$/i;
const FROM_TO_RE = /\s+from\s+(\d{4}-\d{2}-\d{2})(?:\s+to\s+(\d{4}-\d{2}-\d{2}))?\s*$/i;
/**
 * Extract suffixes from a raw WQL query string.
 * Strips outer join (`where`), display unit (`in kg`), rollup (`.rollup(Nw)`),
 * group-by (`by {week}`), time window (`last 8w` / `from … [to …]`), and
 * legacy scope (`in journal`).
 */
export function parseWqlSuffixes(raw: string): ParsedWqlSuffixes {
  const { primary, where } = splitAtWhere(raw);
  let text = primary.trim();

  let storedAs: string | undefined;
  let sourceRef: string | undefined;
  let displayUnit: string | undefined;
  let rollup: ParsedWqlRollupSuffix | undefined;
  let groupBy: string[] | undefined;
  let window: ParsedWqlWindowSuffix | undefined;
  let legacyScope: string | undefined;
  const conflicts: string[] = [];

  // Prefix pipeline source binding: `@olyLifts | ...` or `@olyLifts => ...`
  const prefixMatch = text.match(SOURCE_PREFIX_RE);
  if (prefixMatch) {
    sourceRef = '@' + prefixMatch[1];
    text = text.slice(prefixMatch[0].length).trim();
  }
  const isFind = text.startsWith('find:');
  const isRows = /^rows(?=[:{]|\s|$)/.test(text);

  // C3: a suffix kind may appear once. Each peel site strips its kind until
  // exhausted (right-to-left); more than one occurrence becomes a conflict
  // naming the first and last occurrences instead of silent rightmost-wins.
  // A duplicate hidden behind a different leftover kind still fails through
  // the normal cannot-parse path — single-occurrence parsing is unchanged.
  const stripRepeated = (re: RegExp): RegExpExecArray[] => {
    const matches: RegExpExecArray[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
      matches.unshift(m);
      text = text.slice(0, m.index).trim();
    }
    return matches;
  };
  const conflictFrom = (label: string, ms: RegExpExecArray[]) => {
    // Lockstep across six call sites: one conflict line naming both spans.
    if (ms.length > 1) {
      conflicts.push(
        `Duplicate '${label}' clause: '${ms[0][0].trim()}' conflicts with '${ms[ms.length - 1][0].trim()}'`,
      );
    }
  };

  // Suffix stored-source binding: `... => @olyLifts`
  const storeMatches = stripRepeated(STORED_AS_RE);
  conflictFrom('=>', storeMatches);
  if (storeMatches.length) {
    storedAs = '@' + storeMatches[storeMatches.length - 1][1];
  }

  // Window (C1) — one clause per query, every family. `from/to` strips
  // first (it is the rightmost window form when both appear), then `last`;
  // any second occurrence — same kind or cross-kind — is a C3 conflict.
  const froms = stripRepeated(FROM_TO_RE);
  const lastParams = stripRepeated(LAST_PARAM_RE);
  const lasts = stripRepeated(LAST_RE);
  {
    const windows: Array<ParsedWqlWindowSuffix & { at: number }> = [
      ...froms.map((m) => ({
        kind: 'range' as const,
        start: m[1]!,
        end: m[2],
        raw: m[0].trim(),
        at: m.index,
      })),
      ...lastParams.map((m) => ({
        kind: 'param' as const,
        param: m[1]!,
        ...(m[2] ? { unit: m[2].toLowerCase() as 'd' | 'w' } : {}),
        raw: m[0].trim(),
        at: m.index,
      })),
      ...lasts.map((m) => ({
        kind: 'relative' as const,
        size: parseInt(m[1]!, 10),
        unit: m[2]!.toLowerCase() as 'd' | 'w',
        raw: m[0].trim(),
        at: m.index,
      })),
    ].sort((a, b) => a.at - b.at);
    if (windows.length > 1) {
      conflicts.push(
        `Duplicate 'window' clause: '${windows[0]!.raw}' conflicts with '${windows[windows.length - 1]!.raw}'`,
      );
    }
    if (windows.length === 1) {
      const { at: _at, ...w } = windows[0]!;
      window = w;
    }
  }

  // Uniform suffix peeling: display-unit / legacy scope, rollup, and by {...}
  const units = stripRepeated(DISPLAY_UNIT_RE);
  conflictFrom(isFind || isRows ? 'scope' : 'display-unit', units);
  if (units.length) {
    const val = units[units.length - 1][1];
    if (val === 'kg' || val === 'lb') {
      displayUnit = val;
    } else if (isFind || isRows) {
      legacyScope = val;
    } else {
      displayUnit = val;
    }
  }

  const rollups = stripRepeated(ROLLUP_RE);
  conflictFrom('.rollup', rollups);
  if (rollups.length) {
    const m = rollups[rollups.length - 1];
    rollup = { size: m[1] ? parseInt(m[1], 10) : 1, unit: m[2] || '', raw: m[1] + m[2] };
  }

  const bys = stripRepeated(BY_RE);
  conflictFrom('by', bys);
  if (bys.length) {
    groupBy = bys[bys.length - 1][1]
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }
  const inSourceMatches = stripRepeated(IN_SOURCE_RE);
  if (inSourceMatches.length) {
    sourceRef = '@' + inSourceMatches[inSourceMatches.length - 1][1];
  }

  return {
    where,
    storedAs,
    sourceRef,
    displayUnit,
    rollup,
    groupBy,
    window,
    legacyScope,
    conflicts: conflicts.length ? conflicts : undefined,
    primaryText: normalizeCommaFilterValues(text),
  };
}

/** `key:v1,v2` → `key:v1|v2` — the annotation's comma multi-value spelling,
 *  rewritten inside the structural filter braces before the grammar parse
 *  (the grammar's comma separates filters). A comma merges into the running
 *  filter only while the following segment is a bare value — no colon, no
 *  quote — so `text:a,feed:x` stays two filters while
 *  `source:journal,feeds` becomes one OR. `by {…}` groups are already
 *  peeled; quoted segments never merge. */
function normalizeCommaFilterValues(text: string): string {
  const open = text.indexOf('{');
  const close = open === -1 ? -1 : text.lastIndexOf('}');
  if (open === -1 || close <= open) return text;
  const inside = text.slice(open + 1, close);
  if (!inside.includes(',')) return text;
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of inside) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]!;
    if (!part.trim().startsWith('$')) {
      while (i + 1 < parts.length) {
        const next = parts[i + 1]!.trim();
        if (next && !next.includes(':') && !next.includes('"') && !next.startsWith('$')) {
          part = `${part}|${next}`;
          i++;
        } else break;
      }
    }
    merged.push(part);
  }
  return `${text.slice(0, open + 1)}${merged.join(',')}${text.slice(close)}`;
}
