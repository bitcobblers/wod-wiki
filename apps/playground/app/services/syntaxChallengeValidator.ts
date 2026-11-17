/**
 * syntaxChallengeValidator — runs page-frontmatter quest validation schemas
 * against compiled `ScriptBlock` snapshots.
 *
 * The `Quest.validation` shape is intentionally small: `{ type, [key] }`.
 * Each supported `type` returns a plain `{ pass, reason? }` result so callers
 * can show inline hints, call `markQuestComplete`, or stay open while the
 * user is still typing.
 *
 * Default behaviour is **deny on unknown type** so a typo in frontmatter
 * never silently passes a quest.
 */

import { MetricType, type IMetric } from '@bitcobblers/wod-wiki-engine';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock } from '@/components/Editor/types';

export interface ValidationSchema {
  type: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  pass: boolean;
  reason?: string;
  /** Optional derived value (round count, rep count) for hint display. */
  detail?: string;
}

const TIMER_METRICS: ReadonlySet<MetricType | string> = new Set([
  MetricType.Duration,
  MetricType.Time,
]);

/**
 * The parser's `EffortEnrichmentPass` injects a synthetic statement at the
 * top of every parsed block carrying a `{ type: 'effort', value: 'wod' }`
 * metric and a `{ type: 'hint', value: 'domain.wod' }` marker. Real user
 * movements carry an `Effort` metric with a non-synthetic value (the
 * exercise name) and a hint that is NOT `domain.wod`.
 *
 * Validators must skip synthetic statements or every `has-movement` /
 * `has-timer` quest would pass on an empty wod block (and on a markdown
 * heading, which the parser also tags with `domain.wod`).
 */
function isSynthetic(stmt: ICodeStatement): boolean {
  return stmt.metrics.some(
    (m) => m.type === MetricType.Hint && m.value === 'domain.wod',
  );
}

/**
 * Count movements (= statements that carry a real Effort metric, i.e. a
 * named exercise with a rep/scheme). Synthetic dialect-hint statements are
 * skipped.
 */
function countMovements(statements: ICodeStatement[] | undefined): number {
  if (!statements) return 0;
  return statements.filter(
    (s) =>
      !isSynthetic(s) && s.metrics.some((m) => m.type === MetricType.Effort),
  ).length;
}

/** Sum the round counts across non-synthetic statements. */
function totalRounds(statements: ICodeStatement[] | undefined): number {
  if (!statements) return 0;
  let total = 0;
  for (const s of statements) {
    if (isSynthetic(s)) continue;
    for (const m of s.metrics) {
      if (m.type === MetricType.Rounds && typeof m.value === 'number') {
        total += m.value;
      }
    }
  }
  return total;
}

/** Does any non-synthetic statement declare a timer metric (Duration / Time)? */
function hasTimer(statements: ICodeStatement[] | undefined): boolean {
  if (!statements) return false;
  return statements.some(
    (s) => !isSynthetic(s) && s.metrics.some((m) => TIMER_METRICS.has(m.type)),
  );
}

/** Does any non-synthetic statement declare a rep metric? */
function hasReps(statements: ICodeStatement[] | undefined): boolean {
  if (!statements) return false;
  return statements.some(
    (s) => !isSynthetic(s) && s.metrics.some((m) => m.type === MetricType.Rep),
  );
}

function readNumber(value: unknown, _label: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readString(value: unknown, _label: string): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

const VALIDATORS: Record<
  string,
  (block: ScriptBlock, schema: ValidationSchema) => ValidationResult
> = {
  'has-movement': (block) => {
    const count = countMovements(block.statements);
    return count > 0
      ? { pass: true, detail: `${count} movement${count === 1 ? '' : 's'}` }
      : { pass: false, reason: 'Add at least one movement line (e.g. `10 KB Swings`).' };
  },

  'exactly-movements': (block, schema) => {
    const expected = readNumber(schema.count ?? schema.value, 'count');
    if (expected === null) {
      return { pass: false, reason: 'exactly-movements: missing `count`.' };
    }
    const actual = countMovements(block.statements);
    return actual === expected
      ? { pass: true, detail: String(actual) }
      : {
          pass: false,
          reason: `Expected exactly ${expected} movement${expected === 1 ? '' : 's'}, found ${actual}.`,
        };
  },

  'has-reps': (block) => {
    if (hasReps(block.statements)) {
      return { pass: true };
    }
    return { pass: false, reason: 'Add a rep count (e.g. `10` reps on a movement line).' };
  },

  'has-timer': (block) => {
    if (hasTimer(block.statements)) {
      return { pass: true };
    }
    return { pass: false, reason: 'Add a timer (e.g. `*:30 Rest` or `5:00 cap`).' };
  },

  'min-rounds': (block, schema) => {
    const required = readNumber(schema.count ?? schema.min, 'count');
    if (required === null) {
      return { pass: false, reason: 'min-rounds: missing `count`.' };
    }
    const actual = totalRounds(block.statements);
    return actual >= required
      ? { pass: true, detail: `${actual} round${actual === 1 ? '' : 's'}` }
      : {
          pass: false,
          reason: `Need at least ${required} round${required === 1 ? '' : 's'} — found ${actual}.`,
        };
  },

  'contains-token': (block, schema) => {
    const token = readString(schema.value ?? schema.token, 'value');
    if (token === null) {
      return { pass: false, reason: 'contains-token: missing `value`.' };
    }
    const haystack = block.content ?? '';
    return haystack.includes(token)
      ? { pass: true, detail: `"${token}"` }
      : { pass: false, reason: `Script must include the token "${token}".` };
  },
};

/**
 * Validate a single ScriptBlock against a quest's `validation` schema.
 *
 * Returns `{ pass: false, reason }` for unknown validation types so a
 * frontmatter typo never silently passes a quest.
 */
export function validateScriptBlock(
  block: Pick<ScriptBlock, 'statements' | 'content'>,
  schema: ValidationSchema | undefined,
): ValidationResult {
  if (!schema || typeof schema.type !== 'string' || schema.type.length === 0) {
    return { pass: false, reason: 'Quest has no validation schema.' };
  }

  const handler = VALIDATORS[schema.type];
  if (!handler) {
    return {
      pass: false,
      reason: `Unknown validation type "${schema.type}".`,
    };
  }

  return handler(block as ScriptBlock, schema);
}

/**
 * Convenience: validate *every* quest against a single ScriptBlock and
 * return a map keyed by quest id. Useful when a page has one editor block
 * and multiple quest validators that all read from it.
 */
export function validateAllQuests(
  block: Pick<ScriptBlock, 'statements' | 'content'>,
  quests: ReadonlyArray<{ id: string; validation?: ValidationSchema }>,
): Record<string, ValidationResult> {
  const out: Record<string, ValidationResult> = {};
  for (const q of quests) {
    out[q.id] = validateScriptBlock(block, q.validation);
  }
  return out;
}

/**
 * Pull a list of parsed `IMetric` from a single statement, excluding noise
 * (Sound/System) — exposed for tests and the editor's challenge panel hint UI.
 */
export function statementMetrics(statement: ICodeStatement): IMetric[] {
  return statement.metrics
    .filter((m) => m.type !== MetricType.Sound && m.type !== MetricType.System)
    .slice();
}
