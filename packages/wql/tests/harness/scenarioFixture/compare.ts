/**
 * Semantic comparator for WQL scenarios (spec: wayfinder
 * test-validation-harness asset 006).
 */

import type { QueryResult, RowsQueryResult } from '../../../src/QueryService';
import type { ParsedScenario } from './scenarioFile';

export type ActualScenarioResult = QueryResult | RowsQueryResult | { error: string };

function isQueryResult(r: ActualScenarioResult): r is QueryResult {
  return 'series' in r && Array.isArray((r as QueryResult).series);
}

function isRowsQueryResult(r: ActualScenarioResult): r is RowsQueryResult {
  return 'runs' in r && Array.isArray((r as RowsQueryResult).runs);
}

function isErrorResult(r: ActualScenarioResult): r is { error: string } {
  return 'error' in r && typeof (r as { error?: string }).error === 'string';
}

function localDateString(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function compareScenarioResult(
  scenario: ParsedScenario,
  actual: ActualScenarioResult,
): string[] {
  const diffs: string[] = [];
  // ── Error scenarios ──────────────────────────────────────────────────────
  if (scenario.errors && scenario.errors.length > 0) {
    if (isErrorResult(actual)) {
      const errText = actual.error;
      for (const expectedErr of scenario.errors) {
        if (!errText.includes(expectedErr)) {
          diffs.push(`expected error containing "${expectedErr}", got "${errText}"`);
        }
      }
      return diffs;
    }
    diffs.push(`expected error(s) [${scenario.errors.map((e) => `"${e}"`).join(', ')}], but query succeeded`);
    return diffs;
  }

  // If query failed unexpectedly
  if (isErrorResult(actual)) {
    diffs.push(`unexpected query error: ${actual.error}`);
    return diffs;
  }

  const expected = scenario.expected;
  if (!expected) return diffs;

  // ── 1. Scalar expectation ────────────────────────────────────────────────
  if (expected.scalar !== undefined) {
    if (!isQueryResult(actual)) {
      diffs.push(`expected scalar query result, got rows query result`);
      return diffs;
    }
    if (actual.scalar !== expected.scalar) {
      diffs.push(`scalar value mismatch: expected ${expected.scalar}, got ${actual.scalar}`);
    }
    if (expected.unit !== undefined && actual.unit !== expected.unit) {
      diffs.push(`scalar unit mismatch: expected "${expected.unit}", got "${actual.unit}"`);
    }
  }

  // ── 2. Series expectation (grouped or timeseries) ────────────────────────
  if (expected.series !== undefined) {
    if (!isQueryResult(actual)) {
      diffs.push(`expected series query result, got rows query result`);
      return diffs;
    }

    const actualSeries = [...actual.series];
    const remaining = [...actualSeries];

    for (const expSeries of expected.series) {
      const idx = remaining.findIndex((s) => s.key === expSeries.key || s.label === expSeries.key);
      if (idx === -1) {
        const available = actualSeries.map((s) => `"${s.key}"`).join(', ') || 'none';
        diffs.push(`unmatched series "${expSeries.key}" — available: ${available}`);
        continue;
      }

      const matched = remaining.splice(idx, 1)[0];

      if (expSeries.value !== undefined) {
        const firstPt = matched.points[0];
        if (!firstPt || firstPt.value !== expSeries.value) {
          diffs.push(`series "${expSeries.key}" value mismatch: expected ${expSeries.value}, got ${firstPt?.value}`);
        }
      }

      if (expSeries.unit !== undefined && matched.unit !== expSeries.unit) {
        diffs.push(`series "${expSeries.key}" unit mismatch: expected "${expSeries.unit}", got "${matched.unit}"`);
      }

      if (expSeries.points !== undefined) {
        if (scenario.match === 'closed' && expSeries.points.length !== matched.points.length) {
          diffs.push(`series "${expSeries.key}" points count: expected ${expSeries.points.length}, got ${matched.points.length}`);
        }

        expSeries.points.forEach((expPt, pIdx) => {
          const actualPt = matched.points[pIdx];
          if (!actualPt) {
            diffs.push(`series "${expSeries.key}" missing point #${pIdx + 1} (${expPt.dateOrTs}: ${expPt.value})`);
            return;
          }
          if (expPt.value !== actualPt.value) {
            diffs.push(`series "${expSeries.key}" point #${pIdx + 1} value mismatch: expected ${expPt.value}, got ${actualPt.value}`);
          }
          if (expPt.dateOrTs !== '') {
            const actualDate = localDateString(actualPt.ts);
            const tsMatch = typeof expPt.dateOrTs === 'number'
              ? expPt.dateOrTs === actualPt.ts
              : expPt.dateOrTs === actualDate || expPt.dateOrTs === String(actualPt.ts);
            if (!tsMatch) {
              diffs.push(`series "${expSeries.key}" point #${pIdx + 1} date/timestamp mismatch: expected ${expPt.dateOrTs}, got ${actualDate} (${actualPt.ts})`);
            }
          }
        });
      }
    }

    if (scenario.match === 'closed') {
      for (const extra of remaining) {
        diffs.push(`unexpected series "${extra.key}" (label: "${extra.label}")`);
      }
    }
  }

  // ── 3. Runs expectation (rows queries) ───────────────────────────────────
  if (expected.runs !== undefined) {
    if (!isRowsQueryResult(actual)) {
      diffs.push(`expected rows query result, got aggregate query result`);
      return diffs;
    }

    const actualRuns = [...actual.runs];
    const remainingRuns = [...actualRuns];

    for (const expRun of expected.runs) {
      const rIdx = remainingRuns.findIndex((r) => r.resultId === expRun.resultId);
      if (rIdx === -1) {
        diffs.push(`unmatched run "${expRun.resultId}" — available: ${actualRuns.map((r) => r.resultId).join(', ') || 'none'}`);
        continue;
      }
      const matchedRun = remainingRuns.splice(rIdx, 1)[0];
      if (expRun.noteId !== undefined && matchedRun.noteId !== expRun.noteId) {
        diffs.push(`run "${expRun.resultId}" noteId mismatch: expected "${expRun.noteId}", got "${matchedRun.noteId}"`);
      }

      if (expRun.events.length > 0) {
        if (scenario.match === 'closed' && expRun.events.length !== matchedRun.events.length) {
          diffs.push(`run "${expRun.resultId}" events count: expected ${expRun.events.length}, got ${matchedRun.events.length}`);
        }
        expRun.events.forEach((expEv, eIdx) => {
          const actualEv = matchedRun.events[eIdx];
          if (!actualEv) {
            diffs.push(`run "${expRun.resultId}" missing event #${eIdx + 1} (${expEv.id})`);
            return;
          }
          if (expEv.id && actualEv.id !== expEv.id) {
            diffs.push(`run "${expRun.resultId}" event #${eIdx + 1} id mismatch: expected "${expEv.id}", got "${actualEv.id}"`);
          }
          if (expEv.grain && actualEv.grain !== expEv.grain) {
            diffs.push(`run "${expRun.resultId}" event #${eIdx + 1} grain mismatch: expected "${expEv.grain}", got "${actualEv.grain}"`);
          }
          if (expEv.outputType && actualEv.outputType !== expEv.outputType) {
            diffs.push(`run "${expRun.resultId}" event #${eIdx + 1} outputType mismatch: expected "${expEv.outputType}", got "${actualEv.outputType}"`);
          }
        });
      }
    }

    if (scenario.match === 'closed') {
      for (const extraRun of remainingRuns) {
        diffs.push(`unexpected run "${extraRun.resultId}"`);
      }
    }
  }

  return diffs;
}
