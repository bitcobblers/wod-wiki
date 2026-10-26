/**
 * MetricShakeOutQueue — Two-stage dependency-ordered metric evaluation module.
 *
 * Collects static Metrics and statement-level Metric Equations (`metrics:`)
 * plus workout/query Summary Metrics (`summaries:`) across stacked Property
 * Notes in specificity precedence:
 *   Statement/Runtime > Inline Tag > Effort > Equipment > Note Frontmatter > Tag Category
 *
 * Stage 1 (`plan`): resolves static metrics and compile-time equations in
 * topological waves, injects compiler hints, and defers equations whose
 * required inputs depend on runtime-only atoms (`elapsed`, `spans`, etc.).
 *
 * Stage 2 (`log`): resolves all remaining equations against the executed
 * statement metrics and emits a structured Skipped-Dependency Diagnostic
 * metric (`origin: 'diagnostic'`, `type: MetricType.Diagnostic`) for any
 * equation whose required inputs remain absent after the fixed-point pass.
 */

import {
  MetricContainer,
  MetricType,
  type IMetric,
  type MetricOrigin,
  type TagIndex,
} from '@bitcobblers/wod-wiki-core';
import { resolveTagContributions } from '../../tags/TagContributions';
import { type ExprNode } from './ast';
import { CONTEXT_ATOMS, STREAM_ATOMS } from './atoms';
import { addDim, DIM_ZERO, subDim, type DimVector } from './dimensions';
import { evaluate, type EvalContext } from './evaluator';
import { compileLineForm } from './lineform';
import { LookupRegistry } from './lookup';
import { parseCalcLine } from './parser';
import { CalculationDefinition } from './types';
import { AUTHORITATIVE_CASTS, getUnit, UNITS } from './units';
import { ABSENT, num, str, truthy, type Val } from './values';

export type PropertySourceLayer =
  | 'statement'
  | 'tag'
  | 'effort'
  | 'equipment'
  | 'note'
  | 'category';

const LAYER_PRECEDENCE: Record<PropertySourceLayer, number> = {
  statement: 6,
  tag: 5,
  effort: 4,
  equipment: 3,
  note: 2,
  category: 1,
};

const STATEMENT_OWNED_ORIGINS: Record<string, true> = {
  parser: true,
  dialect: true,
  'user-plan': true,
  runtime: true,
  execution: true,
  tracked: true,
  user: true,
  collected: true,
};

export interface PropertyRuleInput {
  readonly layer: Exclude<PropertySourceLayer, 'statement'>;
  readonly sourceSlug: string;
  readonly metrics?: Readonly<Record<string, string | number | readonly string[]>>;
  readonly summaries?: Readonly<Record<string, string>>;
  readonly hints?: Readonly<Record<string, unknown>>;
}

export interface SkippedDependencyDiagnostic {
  readonly target: string;
  readonly expression: string;
  readonly sourceLayer: Exclude<PropertySourceLayer, 'statement'>;
  readonly sourceSlug: string;
  readonly missing: readonly string[];
}

export interface ShakeOutResult {
  readonly resolved: readonly string[];
  readonly deferredRuntime: readonly string[];
  readonly diagnostics: readonly SkippedDependencyDiagnostic[];
  readonly inferredDims: Readonly<Record<string, DimVector>>;
}

export interface ShakeOutQueueOptions {
  readonly stage: 'plan' | 'log';
  readonly sources: readonly PropertyRuleInput[];
  readonly lookups?: LookupRegistry;
  readonly lastEffortSlug?: string;
}

interface StaticMetricRule {
  readonly kind: 'static';
  readonly key: string;
  readonly value: number | string | readonly string[];
  readonly unit?: string;
  readonly dim: DimVector;
  readonly layer: Exclude<PropertySourceLayer, 'statement'>;
  readonly sourceSlug: string;
}

interface DynamicEquationRule {
  readonly kind: 'equation';
  readonly key: string;
  readonly expression: string;
  readonly ast: ExprNode;
  readonly unit?: string;
  readonly whenAst?: ExprNode;
  readonly dependencies: readonly string[];
  readonly layer: Exclude<PropertySourceLayer, 'statement'>;
  readonly sourceSlug: string;
}

type ParsedPropertyRule = StaticMetricRule | DynamicEquationRule;

/**
 * Extract `metrics:` and `summaries:` maps from a parsed frontmatter record
 * (supporting both flat `metrics.foo` / `summaries.bar` keys and nested maps).
 */
export function extractPropertyRulesFromMeta(
  meta: Readonly<Record<string, unknown>>,
  layer: Exclude<PropertySourceLayer, 'statement'>,
  sourceSlug: string,
): PropertyRuleInput {
  const metrics: Record<string, string | number | readonly string[]> = {};
  const summaries: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(meta)) {
    const key = rawKey.trim();
    if (key.startsWith('metrics.')) {
      const subKey = key.slice('metrics.'.length).trim();
      if (subKey && isSupportedMetricValue(rawValue)) {
        metrics[subKey] = rawValue;
      }
    } else if (key === 'metrics' && isPlainObject(rawValue)) {
      for (const [childKey, childVal] of Object.entries(rawValue)) {
        if (isSupportedMetricValue(childVal)) {
          metrics[childKey.trim()] = childVal;
        }
      }
    } else if (key.startsWith('summaries.')) {
      const subKey = key.slice('summaries.'.length).trim();
      if (subKey && (typeof rawValue === 'string' || typeof rawValue === 'number')) {
        summaries[subKey] = String(rawValue);
      }
    } else if (key === 'summaries' && isPlainObject(rawValue)) {
      for (const [childKey, childVal] of Object.entries(rawValue)) {
        if (typeof childVal === 'string' || typeof childVal === 'number') {
          summaries[childKey.trim()] = String(childVal);
        }
      }
    }
  }

  return {
    layer,
    sourceSlug,
    metrics,
    summaries,
  };
}

function isSupportedMetricValue(val: unknown): val is string | number | readonly string[] {
  if (typeof val === 'number') return Number.isFinite(val);
  if (typeof val === 'string') return val.trim().length > 0;
  return Array.isArray(val) && val.every((item) => typeof item === 'string');
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Extract `PropertyRuleInput` records from a `TagIndex` for the given tag slugs.
 * Supports both statement-level `metrics` (static or equation) and workout-level
 * `summaries.<key>` contributions on tags (including nested tags).
 */
export function extractTagPropertyRules(
  tags: TagIndex | undefined,
  slugs: readonly string[],
): PropertyRuleInput[] {
  if (!tags || slugs.length === 0) return [];
  const rules: PropertyRuleInput[] = [];
  for (const slug of slugs) {
    const resolved = resolveTagContributions(tags, slug);
    if (resolved.metrics.length === 0) continue;
    const metrics: Record<string, string | number | readonly string[]> = {};
    const summaries: Record<string, string> = {};
    for (const m of resolved.metrics) {
      const key = m.type.trim();
      if (!key) continue;
      if (key.startsWith('summaries.')) {
        const subKey = key.slice('summaries.'.length).trim();
        if (subKey && !(subKey in summaries)) {
          summaries[subKey] = String(m.value);
        }
      } else if (!(key in metrics)) {
        metrics[key] = m.unit
          ? `${String(m.value)} ${m.unit}`
          : m.value === null || typeof m.value === 'boolean'
            ? String(m.value)
            : m.value;
      }
    }
    if (Object.keys(metrics).length > 0 || Object.keys(summaries).length > 0) {
      rules.push({
        layer: 'tag',
        sourceSlug: slug,
        metrics,
        summaries,
      });
    }
  }
  return rules;
}

/**
 * Compile `summaries:` equations across stacked Property Notes into workout-scope
 * `CalculationDefinition` records. Higher-precedence layers shadow lower layers
 * when both define the same summary key.
 */
export function compilePropertySummaryCalcs(
  sources: readonly PropertyRuleInput[],
): CalculationDefinition[] {
  const ordered = [...sources].sort(
    (a, b) => LAYER_PRECEDENCE[b.layer] - LAYER_PRECEDENCE[a.layer],
  );
  const chosen = new Map<string, string>();
  for (const source of ordered) {
    if (!source.summaries) continue;
    for (const [rawKey, rawExpr] of Object.entries(source.summaries)) {
      const key = rawKey.trim();
      const expr = rawExpr.trim();
      if (!key || !expr || chosen.has(key)) continue;
      chosen.set(key, expr);
    }
  }

  const customAtomsMap = new Map<string, DimVector>();
  for (const source of ordered) {
    if (!source.metrics) continue;
    for (const [mKey, mVal] of Object.entries(source.metrics)) {
      const parsed = parsePropertyMetricRule(mKey, mVal, source.layer, source.sourceSlug);
      if (!parsed || customAtomsMap.has(parsed.key)) continue;
      if (parsed.kind === 'static') {
        customAtomsMap.set(parsed.key, parsed.dim);
      } else {
        customAtomsMap.set(parsed.key, inferApproxDim(parsed.ast, customAtomsMap));
      }
    }
  }
  const customAtoms = Object.fromEntries(customAtomsMap);

  const defs: CalculationDefinition[] = [];
  for (const [key, expr] of chosen) {
    const line = expr.includes('=') ? expr : `${key} = ${expr}`;
    try {
      const compiled = compileLineForm(line, { scope: 'workout' });
      for (const def of compiled.defs) {
        defs.push({
          ...def,
          customAtoms,
          output: {
            nodeId: def.output?.nodeId ?? 'value',
            key: def.output?.key ?? key,
            emitType: def.output?.emitType ?? key,
            unit: def.output?.unit ?? 'auto',
            ...(def.output?.isGrouped ? { isGrouped: true, groupBy: def.output.groupBy } : {}),
            ...(def.output?.label ? { label: def.output.label } : {}),
          },
        });
      }
    } catch {
      // Malformed summary expressions are skipped at compilation time.
    }
  }
  return defs;
}

/**
 * Collect required reference identifiers from an expression AST.
 * References inside `has(x)` are existence checks, not required inputs.
 */
function collectRequiredRefs(node: ExprNode | undefined, into: Set<string> = new Set()): Set<string> {
  if (!node) return into;
  switch (node.kind) {
    case 'ref':
      into.add(node.name);
      return into;
    case 'unary':
      return collectRequiredRefs(node.arg, into);
    case 'binary':
      collectRequiredRefs(node.left, into);
      return collectRequiredRefs(node.right, into);
    case 'call': {
      if (node.name === 'has') return into;
      if (node.name === 'convert') {
        if (node.args[0]) collectRequiredRefs(node.args[0], into);
        return into;
      }
      if (node.name === 'lookup') {
        if (node.args[1]) collectRequiredRefs(node.args[1], into);
        return into;
      }
      for (const arg of node.args) {
        if (arg.kind !== 'filter') collectRequiredRefs(arg, into);
      }
      return into;
    }
    default:
      return into;
  }
}

/**
 * Parse a single `metrics:` key/value entry into either a static rule or a
 * dynamic equation rule.
 */
function parsePropertyMetricRule(
  key: string,
  rawValue: string | number | readonly string[],
  layer: Exclude<PropertySourceLayer, 'statement'>,
  sourceSlug: string,
): ParsedPropertyRule | undefined {
  const normalizedKey = key.trim();
  if (!normalizedKey) return undefined;

  if (typeof rawValue === 'number') {
    return {
      kind: 'static',
      key: normalizedKey,
      value: rawValue,
      dim: STREAM_ATOMS[normalizedKey]?.dim ?? DIM_ZERO,
      layer,
      sourceSlug,
    };
  }

  if (Array.isArray(rawValue)) {
    return {
      kind: 'static',
      key: normalizedKey,
      value: rawValue,
      dim: DIM_ZERO,
      layer,
      sourceSlug,
    };
  }

  const trimmed = String(rawValue).trim();
  if (!trimmed) return undefined;

  // 1. Pure number string ("6", "7.5")
  const asNum = Number(trimmed);
  if (!Number.isNaN(asNum) && /^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return {
      kind: 'static',
      key: normalizedKey,
      value: asNum,
      dim: STREAM_ATOMS[normalizedKey]?.dim ?? DIM_ZERO,
      layer,
      sourceSlug,
    };
  }

  // 2. Static quantity with unit ("24 kg", "400 m", "90 s")
  const qtyMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*([A-Za-z%/][\w%/.-]*)$/);
  if (qtyMatch) {
    const amount = Number(qtyMatch[1]);
    const unitStr = qtyMatch[2];
    const knownUnit = getUnit(unitStr);
    if (!Number.isNaN(amount) && (knownUnit || /^(kg|lb|m|km|mi|s|min|h|ms|reps|cal|bpm|W|pts|AU|%)$/i.test(unitStr))) {
      return {
        kind: 'static',
        key: normalizedKey,
        value: amount,
        unit: unitStr,
        dim: knownUnit?.dim ?? STREAM_ATOMS[normalizedKey]?.dim ?? DIM_ZERO,
        layer,
        sourceSlug,
      };
    }
  }

  // 3. Reference keys (`effort`, `equipment`) stay static strings
  if (normalizedKey === 'effort' || normalizedKey === 'equipment') {
    return {
      kind: 'static',
      key: normalizedKey,
      value: trimmed,
      dim: DIM_ZERO,
      layer,
      sourceSlug,
    };
  }

  // 4. Dynamic Metric Equation (`reps * resistance`, `met * convert(elapsed, min) -> MET-min when elapsed > 0`)
  try {
    const lineSrc = `${normalizedKey} = ${trimmed}`;
    const parsedLine = parseCalcLine(lineSrc);
    const whenAst = parsedLine.when;
    const deps = collectRequiredRefs(parsedLine.expr);
    if (whenAst) collectRequiredRefs(whenAst, deps);
    deps.delete(normalizedKey);
    return {
      kind: 'equation',
      key: normalizedKey,
      expression: trimmed,
      ast: parsedLine.expr,
      unit: parsedLine.unit,
      whenAst,
      dependencies: [...deps],
      layer,
      sourceSlug,
    };
  } catch {
    // Fallback for plain string literals
    return {
      kind: 'static',
      key: normalizedKey,
      value: trimmed,
      dim: DIM_ZERO,
      layer,
      sourceSlug,
    };
  }
}

function canonicalMetricType(key: string): MetricType | string {
  if (key === 'reps') return MetricType.Rep;
  if (key === 'distance') return MetricType.Distance;
  if (key === 'resistance') return MetricType.Resistance;
  if (key === 'elapsed') return MetricType.Elapsed;
  if (key === 'effort') return MetricType.Effort;
  if (key === 'equipment') return MetricType.Equipment;
  return key;
}

function readContainerMetricAtom(
  container: MetricContainer,
  name: string,
  inferredDims: Map<string, DimVector>,
  lastEffortSlug?: string,
): Val {
  const targetType = canonicalMetricType(name);
  const raw = container.rawMetrics;

  if (name === 'reps') {
    let total = 0;
    let found = false;
    for (const m of raw) {
      if (m.type === MetricType.Rep || m.type === 'reps') {
        const v = extractNumeric(m);
        if (v !== undefined) {
          total += v;
          found = true;
        }
      }
    }
    return found ? num(total, STREAM_ATOMS.reps.dim, 'reps') : ABSENT;
  }

  // Search from latest to earliest metric matching `targetType`, `name`, or `m.name === name`
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i];
    if (m.type !== targetType && m.type !== name && m.name !== name) continue;
    const v = extractNumeric(m);
    if (v !== undefined) {
      const unit = extractUnit(m) ?? STREAM_ATOMS[name]?.unit;
      const dim =
        inferredDims.get(name) ??
        (unit && UNITS[unit] ? UNITS[unit].dim : undefined) ??
        STREAM_ATOMS[name]?.dim ??
        DIM_ZERO;
      return num(v, dim, unit);
    }
    if (typeof m.value === 'string' && m.value.length > 0) {
      return str(m.value);
    }
  }

  if (name === 'effort' && lastEffortSlug) {
    return str(lastEffortSlug);
  }

  return ABSENT;
}

function extractNumeric(metric: IMetric): number | undefined {
  if (typeof metric.value === 'number' && !Number.isNaN(metric.value)) return metric.value;
  const val = metric.value;
  if (val && typeof val === 'object' && 'amount' in val && typeof val.amount === 'number') {
    return val.amount;
  }
  return undefined;
}

function extractUnit(metric: IMetric): string | undefined {
  const val = metric.value;
  if (val && typeof val === 'object' && 'units' in val && typeof val.units === 'string') {
    return val.units;
  }
  return metric.unit;
}

function hasStatementOwnedMetric(container: MetricContainer, key: string): boolean {
  const targetType = canonicalMetricType(key);
  return container.rawMetrics.some(
    (m) =>
      (m.type === targetType || m.type === key || m.name === key) &&
      STATEMENT_OWNED_ORIGINS[m.origin] === true,
  );
}

function inferApproxDim(node: ExprNode, dims: Map<string, DimVector>): DimVector {
  switch (node.kind) {
    case 'ref':
      return dims.get(node.name) ?? STREAM_ATOMS[node.name]?.dim ?? CONTEXT_ATOMS[node.name] ?? DIM_ZERO;
    case 'unary':
      return node.op === 'not' ? DIM_ZERO : inferApproxDim(node.arg, dims);
    case 'binary':
      if (node.op === '*') return addDim(inferApproxDim(node.left, dims), inferApproxDim(node.right, dims));
      if (node.op === '/') return subDim(inferApproxDim(node.left, dims), inferApproxDim(node.right, dims));
      if (node.op === '+' || node.op === '-') return inferApproxDim(node.left, dims);
      return DIM_ZERO;
    case 'call':
      if (node.name === 'convert' && node.args[1]) {
        const u = node.args[1].kind === 'ref' ? node.args[1].name : node.args[1].kind === 'string' ? node.args[1].value : undefined;
        const targetDim = u ? getUnit(u)?.dim : undefined;
        return targetDim ?? inferApproxDim(node.args[0], dims);
      }
      if (node.args[0]) return inferApproxDim(node.args[0], dims);
      return DIM_ZERO;
    default:
      return DIM_ZERO;
  }
}

/**
 * Run the two-stage Metric Shake-Out Queue on a statement's MetricContainer.
 */
export function runMetricShakeOutQueue(
  container: MetricContainer,
  options: ShakeOutQueueOptions,
): ShakeOutResult {
  const orderedSources = [...options.sources].sort(
    (a, b) => LAYER_PRECEDENCE[b.layer] - LAYER_PRECEDENCE[a.layer],
  );

  const winningRules = new Map<string, ParsedPropertyRule>();
  for (const source of orderedSources) {
    if (!source.metrics) continue;
    for (const [rawKey, rawVal] of Object.entries(source.metrics)) {
      const rule = parsePropertyMetricRule(rawKey, rawVal, source.layer, source.sourceSlug);
      if (!rule) continue;
      if (winningRules.has(rule.key)) continue;
      winningRules.set(rule.key, rule);
    }
  }

  const emitOrigin: MetricOrigin = options.stage === 'plan' ? 'compiler' : 'analyzed';
  const inferredDims = new Map<string, DimVector>();
  const resolved: string[] = [];
  const pendingEquations: DynamicEquationRule[] = [];

  // Pass 1: apply winning static rules that aren't shadowed by statement-owned metrics
  for (const rule of winningRules.values()) {
    if (hasStatementOwnedMetric(container, rule.key)) continue;
    if (rule.kind === 'static') {
      inferredDims.set(rule.key, rule.dim);
      const targetType = canonicalMetricType(rule.key);
      container.add({
        type: targetType,
        name: rule.key,
        value: rule.value,
        ...(rule.unit ? { unit: rule.unit } : {}),
        image: rule.unit ? `${String(rule.value)} ${rule.unit}` : String(rule.value),
        origin: emitOrigin,
        metadata: {
          canonicalKey: rule.key,
          sourceLayer: rule.layer,
          sourceSlug: rule.sourceSlug,
        },
      });
      resolved.push(rule.key);
    } else {
      pendingEquations.push(rule);
    }
  }

  // Pass 2: topological fixed-point shake-out waves over dynamic equations
  const unresolved = new Set<DynamicEquationRule>(pendingEquations);
  const notApplicable = new Set<DynamicEquationRule>();

  const makeEvalContext = (): EvalContext => ({
    resolveRef: (name) => readContainerMetricAtom(container, name, inferredDims, options.lastEffortSlug),
    callFunction: (name, args, rawArgs) => {
      if (name === 'lookup' && options.lookups) {
        return options.lookups.callFunction!(name, args, rawArgs);
      }
      return undefined;
    },
  });

  let progressed = true;
  while (progressed && unresolved.size > 0) {
    progressed = false;
    for (const rule of [...unresolved]) {
      const ctx = makeEvalContext();
      const missing = rule.dependencies.filter((dep) => ctx.resolveRef(dep).kind === 'absent');
      if (missing.length > 0) continue;

      if (rule.whenAst && !truthy(evaluate(rule.whenAst, ctx))) {
        unresolved.delete(rule);
        notApplicable.add(rule);
        progressed = true;
        continue;
      }

      const val = evaluate(rule.ast, ctx);
      if (val.kind !== 'number') continue;

      let dim = val.dim;
      if (rule.unit && AUTHORITATIVE_CASTS[rule.unit]) {
        dim = DIM_ZERO;
      } else if (dim.every((d) => d === 0)) {
        dim = inferApproxDim(rule.ast, inferredDims);
      }
      inferredDims.set(rule.key, dim);

      const unit = !rule.unit || rule.unit === 'auto' ? val.unit : rule.unit;
      const targetType = canonicalMetricType(rule.key);
      container.add({
        type: targetType,
        name: rule.key,
        value: val.value,
        ...(unit ? { unit } : {}),
        image: unit ? `${val.value} ${unit}` : String(val.value),
        origin: emitOrigin,
        metadata: {
          canonicalKey: rule.key,
          sourceLayer: rule.layer,
          sourceSlug: rule.sourceSlug,
          expression: rule.expression,
        },
      });

      unresolved.delete(rule);
      resolved.push(rule.key);
      progressed = true;
    }
  }

  // Pass 3: classify remaining unresolved equations as deferred-runtime or Skipped-Dependency Diagnostic
  const deferredRuntime: string[] = [];
  const diagnostics: SkippedDependencyDiagnostic[] = [];
  const finalCtx = makeEvalContext();

  for (const rule of unresolved) {
    if (notApplicable.has(rule)) continue;
    const missing = rule.dependencies.filter((dep) => finalCtx.resolveRef(dep).kind === 'absent');
    if (missing.length === 0) continue;

    if (options.stage === 'plan') {
      deferredRuntime.push(rule.key);
      continue;
    }

    const diag: SkippedDependencyDiagnostic = {
      target: rule.key,
      expression: rule.expression,
      sourceLayer: rule.layer,
      sourceSlug: rule.sourceSlug,
      missing,
    };
    diagnostics.push(diag);

    container.add({
      type: MetricType.Diagnostic,
      name: `diagnostic.${rule.key}`,
      value: `Skipped ${rule.key}: missing ${missing.join(', ')}`,
      image: `Skipped ${rule.key} (missing ${missing.join(', ')})`,
      origin: 'diagnostic',
      metadata: {
        diagnostic: 'skipped-dependency',
        target: rule.key,
        expression: rule.expression,
        sourceLayer: rule.layer,
        sourceSlug: rule.sourceSlug,
        missing,
      },
    });
  }

  return {
    resolved,
    deferredRuntime,
    diagnostics,
    inferredDims: Object.fromEntries(inferredDims),
  };
}
