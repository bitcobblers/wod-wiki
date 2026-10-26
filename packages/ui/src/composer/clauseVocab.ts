/**
 * clauseVocab — option lists and multi-value typing for clause editors.
 * Extracted from QueryPalette so the inline editor, the standalone popover,
 * and the clauseItems hook share one vocabulary. All lists are canonical
 * (queryClauses — engine vocab); closed lists reject unknown typed values,
 * open/parser-validated ones are decided in clauseItems.
 */
import {
  KIND_OPTIONS,
  TARGET_OPTIONS,
  SOURCE_OPTIONS,
  PLANE_OPTIONS,
  TIME_OPTIONS,
  AGG_OPTIONS,
  ROLLUP_OPTIONS,
  GROUPBY_OPTIONS,
  METRIC_OPTIONS,
  UNIT_OPTIONS,
} from './queryClauses';
import { WQL_INTENSITY_TIERS } from '@bitcobblers/wod-wiki-wql';

/** Multi-select (toggle-in-place) clause types. `source` is independently
 *  multi-select — applySourceFilter ORs the scope values. Typed tag keys and
 *  `groupby` OR their values in the engine (value lists join with `|`). */
export const MULTI_VALUE_TYPES: Record<string, true> = {
  tag: true,
  notebook: true,
  contributes: true,
  effort: true,
  domain: true,
  format: true,
  equipment: true,
  quality: true,
  intent: true,
  discipline: true,
  intensity: true,
  origin: true,
  type: true,
  source: true,
  groupby: true,
};

export const STATIC_OPTIONS: Record<string, { value: string; label: string }[]> = {
  kind: KIND_OPTIONS,
  target: TARGET_OPTIONS,
  source: SOURCE_OPTIONS,
  plane: PLANE_OPTIONS,
  time: TIME_OPTIONS,
  agg: AGG_OPTIONS,
  rollup: ROLLUP_OPTIONS,
  groupby: GROUPBY_OPTIONS,
  metric: METRIC_OPTIONS,
  unit: UNIT_OPTIONS,
  intensity: WQL_INTENSITY_TIERS.map((v) => ({ value: v, label: v })),
};
