/**
 * Contextual typeahead for the calc-line editor (#880) — a CM6 autocomplete
 * source over the calc vocabulary. Context-aware:
 *   - inside `lookup(...)` → tables, then fields (and effort keys);
 *   - after `->` → dimension-filtered unit suggestions (using the engine's
 *     inferred vector, including the expression before an incomplete arrow);
 *   - after an aggregator `sum:` → stream metric keys;
 *   - otherwise → scope-aware atoms, functions, aggregates, clause keywords.
 */

import { CompletionContext, CompletionResult, autocompletion } from '@codemirror/autocomplete';
import { CalcScope } from '@bitcobblers/wod-wiki-engine';
import {
  FUNCTION_NAMES,
  LOOKUP_TABLES,
  SEGMENT_ATOMS,
  WORKOUT_CONTEXT_ATOMS,
  STREAM_METRICS,
  AGGREGATE_NAMES,
  WQL_AGGREGATORS,
  CLAUSE_WORDS,
  unitsForDimension,
} from './calcVocabulary';
import { analyzeCalcLine } from './calcDiagnostics';

export interface CalcCompletionOptions {
  /** Scope used for atom suggestions and dimension inference. */
  scope?: CalcScope;
  /**
   * Live effort slugs for the `lookup("effort", …)` key slot — feed from the
   * app's effort registry: `() => registry.list().map(e => e.slug)`.
   * Absent/empty falls back to the static EFFORT_KEYS sample list.
   */
  effortKeys?: () => readonly string[];
}

interface CalcCompletionItem {
  label: string;
  apply: string;
  detail: string;
}

/** Effort library keys suggested in the `lookup("effort", …, …)` key slot. */
const EFFORT_KEYS = ['effort', 'thruster', 'push-press', 'front-squat', 'wall-ball', 'row', 'run'];

function quotedInsert(value: string, quoteTyped: boolean): string {
  return `${quoteTyped ? '' : '"'}${value}"`;
}

export function calcCompletionSource(options: CalcCompletionOptions = {}): (context: CompletionContext) => CompletionResult | null {
  const scope = options.scope ?? 'segment';

  /** Live registry slugs first ('effort' = the note's own effort, always kept);
   *  static sample list only until a host feeds the registry. */
  const effortKeyOptions = (): string[] => {
    const live = options.effortKeys?.().filter(Boolean) ?? [];
    return ['effort', ...(live.length ? live : EFFORT_KEYS.slice(1))];
  };

  return (context: CompletionContext): CompletionResult | null => {
    const text = context.state.sliceDoc(0, context.pos);
    const word = context.matchBefore(/[\w./"]*/);
    if (!word) return null;

    // ── lookup(...) inner context ───────────────────────────────────────
    const inLookup = /lookup\(\s*/.test(text);
    if (inLookup) {
      const lookupAt = text.lastIndexOf('lookup(');
      const inside = text.slice(lookupAt + 'lookup('.length);
      // Table slot: `lookup("...` with no comma yet.
      if (!/,/.test(inside) && /^"?[\w.-]*"?$/.test(inside.replace(/"/g, '').trim() || '')) {
        const frag = inside.replace(/"/g, '').trim();
        const quoteTyped = inside.trimStart().startsWith('"');
        const options = LOOKUP_TABLES.filter((t) => t.name.startsWith(frag))
          .map((t) => ({ label: t.name, apply: quotedInsert(t.name, quoteTyped), detail: t.detail }));
        if (options.length) {
          return { from: context.pos - frag.length, to: context.pos + (context.state.sliceDoc(context.pos, context.pos + 1) === '"' ? 1 : 0), options, validFor: /^[\w.-]*$/ };
        }
      }
      // Field slot (3rd quoted arg): `lookup("T", key, "...`
      const fieldM = /lookup\(\s*"[^"]+"\s*,\s*[^,]+,\s*"?([\w-]*)"?$/.exec(text);
      if (fieldM) {
        const table = /lookup\(\s*"([^"]+)"/.exec(text)?.[1];
        const t = LOOKUP_TABLES.find((x) => x.name === table);
        const from = context.pos - fieldM[1].length;
        const quoteTyped = context.state.sliceDoc(from - 1, from) === '"';
        const options = (t?.fields ?? []).filter((f) => f.startsWith(fieldM[1]))
          .map((f) => ({ label: f, apply: quotedInsert(f, quoteTyped), detail: `${table} field` }));
        return { from, to: context.pos + (context.state.sliceDoc(context.pos, context.pos + 1) === '"' ? 1 : 0), options, validFor: /^[\w-]*$/ };
      }
      // Key slot (2nd arg) for effort.
      const keyM = /lookup\(\s*"(effort)"\s*,\s*"?([\w.-]*)"?$/.exec(text);
      if (keyM) {
        const keys = effortKeyOptions().filter((k) => k.startsWith(keyM[2]));
        const from = context.pos - keyM[2].length;
        const quoteTyped = context.state.sliceDoc(from - 1, from) === '"';
        const options = keys.map((k) => ({ label: k, apply: k === 'effort' ? k : quotedInsert(k, quoteTyped), detail: 'effort key' }));
        return { from, to: context.pos + (context.state.sliceDoc(context.pos, context.pos + 1) === '"' ? 1 : 0), options, validFor: /^[\w.-]*$/ };
      }
    }

    // ── Unit context (after `->`) — dimension-filtered ──────────────────
    const unitM = /->\s*([\w/]*)$/.exec(text);
    if (unitM) {
      const lineText = context.state.doc.lineAt(context.pos).text;
      let analysis = analyzeCalcLine(lineText, scope);
      // A mid-draft (`-> k`) can't compile as a whole ("Unknown output unit"),
      // losing the dimension; re-infer it from the expression before the arrow.
      if (!analysis.dim) {
        const arrowAt = lineText.lastIndexOf('->');
        if (arrowAt >= 0) {
          const lhs = analyzeCalcLine(lineText.slice(0, arrowAt), scope);
          if (lhs.diagnostics.length === 0) analysis = lhs;
        }
      }
      const dim = analysis.diagnostics.length === 0 ? analysis.dim : undefined;
      const options = unitsForDimension(dim)
        .filter((u) => u.startsWith(unitM[1]))
        .map((u) => ({ label: u, detail: dim ? 'matches inferred dimension' : 'unit' }));
      return { from: context.pos - unitM[1].length, options, validFor: /^[\w/]*$/ };
    }

    // ── WQL atom aggregator context (store scope), e.g. `sum:reps` ─────
    if (scope === 'store') {
      const wqlM = /^(sum|avg|max|min|count|last):([\w.]*)$/.exec(word.text);
      if (wqlM) {
        const options = STREAM_METRICS.filter((m) => m.startsWith(wqlM[2]))
          .map((m) => ({ label: m, detail: 'metric key' }));
        return { from: word.from + word.text.indexOf(':') + 1, options, validFor: /^[\w.]*$/ };
      }
    }

    // ── Generic atom/function/clause context ────────────────────────────
    const items: CalcCompletionItem[] = [];
    if (scope === 'segment') {
      items.push(...SEGMENT_ATOMS.map((a) => ({ label: a.name, apply: a.name, detail: a.detail })));
    } else {
      items.push(...WORKOUT_CONTEXT_ATOMS.map((a) => ({ label: a.name, apply: a.name, detail: a.detail })));
      if (scope === 'workout') {
        for (const agg of AGGREGATE_NAMES) {
          for (const m of ['reps', 'distance', 'segmentVolume', 'metMinutes', 'elapsed', 'effortRpe']) {
            items.push({ label: `${agg}(${m})`, apply: `${agg}(${m})`, detail: 'aggregate' });
          }
        }
        items.push({ label: 'sum(reps, without: rest)', apply: 'sum(reps, without: rest)', detail: 'exclusion aggregate' });
      }
    }
    items.push(...FUNCTION_NAMES.map((f) => ({ label: `${f}()`, apply: `${f}()`, detail: 'function' })));
    if (scope === 'store') items.push(...WQL_AGGREGATORS.map((a) => ({ label: `${a}:{}`, apply: `${a}:`, detail: 'WQL atom' })));
    items.push(...CLAUSE_WORDS.map((c) => ({ label: c, apply: c === 'when' ? 'when ' : c, detail: 'clause' })));
    items.push({ label: 'estimated', apply: 'estimated', detail: 'variant origin' });
    items.push({ label: '(library)', apply: '(library)', detail: 'library calc' });

    const filtered = items.filter((i) => i.label.startsWith(word.text)).slice(0, 20);
    if (!filtered.length) return null;
    return { from: word.from, options: filtered, validFor: /^[\w./]*$/ };
  };
}

/** Ready-to-use autocomplete extension. interactionDelay 0 matches every
 *  other editor surface — keyboard nav/accept never waits out the delay. */
export function calcCompletion(options?: CalcCompletionOptions) {
  return autocompletion({ override: [calcCompletionSource(options)], interactionDelay: 0 });
}
