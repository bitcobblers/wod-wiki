/**
 * Parser test builder (ParserTests/Test Builder story).
 *
 * Workflow: type a script (same CodeMirror surface as the workbench) → the
 * parser fills the statement table with its metrics as expected DSL lines →
 * edit expectations per line (add/remove metric chips) where the parser is
 * wrong → save the case into a {@link ParserTestFile} and download/copy the
 * JSON for the ParserTests/Runner stories. The builder's live status uses
 * the exact `runCase` the runner uses, so a green case here is green there.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eraser,
  Plus,
  Save,
  Wand2,
  X,
} from 'lucide-react';
import { parseScript } from '@bitcobblers/wod-wiki-engine';
import { useCodeMirror } from '../workbench/LanguageWorkbench';
import { MetricComposer } from './MetricComposer';
import { decomposeDsl, type ComposerMetric } from './dslComposer';
import {
  expectedFromStatements,
  pairExpectedToStatements,
  runCase,
  validateMetricDsl,
  type CaseResult,
  type StatementDiff,
} from './runnerCore';
import { DiffView } from './DiffView';
import type { ExpectedError, ExpectedLine, ParserTestCase, ParserTestFile } from './types';
const SAMPLE_SCRIPT = '10 Burpees\n*:30 Rest\n10 Burpees';
const KNOWN_SPORTS = ['crossfit', 'climb', 'yoga', 'cardio', 'habits'];

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[11px]';

export interface ParserTestBuilderProps {
  initialScript?: string;
  fileTitle?: string;
  'data-testid'?: string;
}

/** Stored DSL should always parse; a hand-edited file may not — fall back to a fresh draft. */
function decomposeOrNull(dsl: string): ComposerMetric | null {
  try {
    return decomposeDsl(dsl);
  } catch {
    return null;
  }
}

export function ParserTestBuilder({
  initialScript = SAMPLE_SCRIPT,
  fileTitle = 'parser-tests',
  'data-testid': testId = 'parser-test-builder',
}: ParserTestBuilderProps) {
  const [script, setScript] = useState(initialScript);
  const [name, setName] = useState('case-1');
  const [sport, setSport] = useState('');
  const [withoutDialects, setWithoutDialects] = useState(false);
  const [matchMode, setMatchMode] = useState<'closed' | 'subset'>('closed');
  const [expectErrors, setExpectErrors] = useState(false);
  const [errorsExpected, setErrorsExpected] = useState<ExpectedError[]>([]);
  /** null = follow the live parser (auto-seed); otherwise user-curated. */
  const [storedExpected, setStoredExpected] = useState<ExpectedLine[] | null>(null);
  const [cases, setCases] = useState<ParserTestCase[]>([]);
  const [title, setTitle] = useState(fileTitle);
  const [copied, setCopied] = useState(false);
  /** Open metric composer: which expected entry, and which chip (null = adding new). */
  const [composer, setComposer] = useState<{ entryIndex: number; metricIndex: number | null } | null>(null);

  const editorHost = useRef<HTMLDivElement>(null);
  const { setDoc } = useCodeMirror(editorHost, initialScript, 'whiteboard', setScript);

  const parsed = useMemo(
    () =>
      parseScript(script, {
        ...(sport ? { sport } : {}),
        ...(withoutDialects ? { withoutDialects: true } : {}),
      }),
    [script, sport, withoutDialects],
  );

  const effectiveExpected = useMemo(
    () => storedExpected ?? expectedFromStatements(parsed.statements),
    [storedExpected, parsed.statements],
  );

  const pairing = useMemo(
    () => pairExpectedToStatements(parsed.statements, effectiveExpected),
    [parsed.statements, effectiveExpected],
  );

  const currentCase: ParserTestCase = useMemo(
    () => ({
      name: name || 'case',
      script,
      ...(sport ? { sport } : {}),
      ...(withoutDialects ? { withoutDialects: true } : {}),
      matchMode,
      expected: effectiveExpected,
      ...(expectErrors ? { errors: errorsExpected } : {}),
    }),
    [name, script, sport, withoutDialects, matchMode, effectiveExpected, expectErrors, errorsExpected],
  );

  const liveResult: CaseResult = useMemo(() => {
    try {
      return runCase(currentCase);
    } catch (e) {
      return {
        name: currentCase.name,
        status: 'fail',
        parseFailed: false,
        statements: [],
        missingStatements: [],
        extraStatements: [],
        errors: [],
        thrown: e instanceof Error ? e.message : String(e),
      };
    }
  }, [currentCase]);

  // runCase pushes paired statements in pairs order — index the diffs
  // positionally (one source line can yield several statements; matching
  // diffs by line number would highlight the wrong row).
  const diffByStatementIndex = useMemo(() => {
    const map: Record<number, StatementDiff> = {};
    let next = 0;
    pairing.pairs.forEach(({ entryIndex }, i) => {
      if (entryIndex !== null) map[i] = liveResult.statements[next++];
    });
    return map;
  }, [pairing, liveResult]);

  /** Freeze the effective expectations, then apply the mutation to them. */
  const mutateExpected = (fn: (entries: ExpectedLine[]) => ExpectedLine[]) => {
    setStoredExpected(fn(effectiveExpected));
  };

  const addMetric = (entryIndex: number, dsl: string): string | null => {
    const err = validateMetricDsl(dsl);
    if (err) return err;
    mutateExpected(
      (entries) => entries.map((entry, i) => (i === entryIndex ? { ...entry, metrics: [...entry.metrics, dsl] } : entry)),
    );
    return null;
  };

  const removeMetric = (entryIndex: number, metricIndex: number) => {
    mutateExpected(
      (entries) =>
        entries.map((entry, i) =>
          i === entryIndex ? { ...entry, metrics: entry.metrics.filter((_, j) => j !== metricIndex) } : entry,
        ),
    );
  };

  const replaceMetric = (entryIndex: number, metricIndex: number, dsl: string): string | null => {
    const err = validateMetricDsl(dsl);
    if (err) return err;
    mutateExpected(
      (entries) =>
        entries.map((entry, i) =>
          i === entryIndex ? { ...entry, metrics: entry.metrics.map((m, j) => (j === metricIndex ? dsl : m)) } : entry,
        ),
    );
    return null;
  };

  const acceptActualForStatement = (statementIndex: number) => {
    const statement = parsed.statements[statementIndex];
    if (!statement) return;
    const fresh = expectedFromStatements([statement])[0]!;
    mutateExpected((entries) => {
      const consumed = new Set(
        pairing.pairs
          .map((p, i) => (p.entryIndex !== null && i !== statementIndex ? p.entryIndex : -1))
          .filter((i) => i >= 0),
      );
      const target = pairing.pairs[statementIndex]?.entryIndex;
      if (target !== null && target !== undefined) {
        return entries.map((entry, i) => (i === target ? fresh : entry));
      }
      // Statement had no entry: insert next to its consumed line neighbours.
      const insertAt = entries.findIndex((_, i) => !consumed.has(i));
      const next = [...entries];
      next.splice(insertAt === -1 ? entries.length : insertAt, 0, fresh);
      return next;
    });
  };

  const seedAll = () => {
    setStoredExpected(expectedFromStatements(parsed.statements));
    if (expectErrors) {
      setErrorsExpected((parsed.errors ?? []).map((e) => ({ line: e.line ?? 0, message: e.message })));
    }
  };

  const loadCase = (testCase: ParserTestCase) => {
    setName(testCase.name);
    setScript(testCase.script);
    setDoc(testCase.script);
    setSport(testCase.sport ?? '');
    setWithoutDialects(testCase.withoutDialects ?? false);
    setMatchMode(testCase.matchMode ?? 'closed');
    setExpectErrors(testCase.errors !== undefined);
    setErrorsExpected(testCase.errors ?? []);
    setStoredExpected(testCase.expected);
  };

  const saveCase = () => {
    setCases((prev) => {
      const existing = prev.findIndex((c) => c.name === currentCase.name);
      if (existing === -1) return [...prev, currentCase];
      const next = [...prev];
      next[existing] = currentCase;
      return next;
    });
  };

  const file: ParserTestFile = { version: 1, title, cases };
  const jsonText = JSON.stringify(file, null, 2);
  const fileName = `${title.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'parser-tests'}.json`;

  const passCount = liveResult.statements.filter((s) => s.status === 'pass').length;

  return (
    <div className="space-y-4 p-4 text-slate-900 dark:text-slate-100" data-testid={testId}>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: script editor + parse feed */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Case name"
              className="w-36 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1.5 py-1 text-xs"
              data-testid="case-name"
            />
            <input
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              list="parser-test-sports"
              placeholder="sport"
              aria-label="Sport dialect"
              className="w-24 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1.5 py-1 text-xs"
            />
            <datalist id="parser-test-sports">
              {KNOWN_SPORTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as 'closed' | 'subset')}
              aria-label="Match mode"
              className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1 py-1 text-xs"
            >
              <option value="closed">closed</option>
              <option value="subset">subset</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={withoutDialects}
                onChange={(e) => setWithoutDialects(e.target.checked)}
              />
              raw (no dialects)
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={expectErrors}
                onChange={(e) => setExpectErrors(e.target.checked)}
              />
              expect errors
            </label>
          </div>

          <div
            ref={editorHost}
            className="min-h-48 rounded border border-slate-300 dark:border-slate-600 overflow-hidden text-sm"
            data-testid="builder-script-editor"
          />

          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              {parsed.statements.length} statement{parsed.statements.length === 1 ? '' : 's'}
            </span>
            {(parsed.errors ?? []).length > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {(parsed.errors ?? []).length} parse error{(parsed.errors ?? []).length === 1 ? '' : 's'}
              </span>
            )}
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={seedAll}
                className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                data-testid="builder-seed"
              >
                <Wand2 size={12} />
                Seed from parse
              </button>
              <button
                type="button"
                onClick={() => setStoredExpected([])}
                className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Eraser size={12} />
                Clear
              </button>
            </div>
          </div>

          {(parsed.errors ?? []).map((e, i) => (
            <div key={i} className="rounded bg-red-500/10 px-2 py-1 font-mono text-[11px] text-red-700 dark:text-red-300">
              line {e.line}: {e.message}
            </div>
          ))}
        </div>

        {/* Right: expected statements table + live runner verdict */}
        <div className="space-y-2">
          <div
            className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-medium ${
              liveResult.status === 'pass'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/15 text-red-700 dark:text-red-300'
            }`}
            data-testid="builder-status"
          >
            {liveResult.status === 'pass'
              ? `Pass — ${passCount}/${parsed.statements.length} statements match`
              : 'Fail — see diffs below'}
          </div>

          <div className="rounded border border-slate-200 dark:border-slate-700" data-testid="builder-table">
            {pairing.pairs.map(({ statement, entryIndex }, statementIndex) => {
              const entry = entryIndex !== null ? effectiveExpected[entryIndex] : null;
              const diff = diffByStatementIndex[statementIndex];
              const status = diff?.status ?? 'fail';
              const composerOpen = composer?.entryIndex === entryIndex && entryIndex !== null;
              const editingMetricIndex = composerOpen ? composer!.metricIndex : null;
              return (
                <div
                  key={statementIndex}
                  className={`border-b border-slate-200 dark:border-slate-700 p-2 last:border-b-0 ${
                    entry === null ? 'bg-red-500/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      Line {statement.line ?? 0}
                    </span>
                    <span className="truncate text-xs">{statement.text}</span>
                    <span
                      className={`ml-auto h-2 w-2 rounded-full ${
                        status === 'pass' ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => acceptActualForStatement(statementIndex)}
                      className="rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[10px] hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Replace this line's expectations with what the parser produces now"
                    >
                      use actual
                    </button>
                  </div>
                  {entry ? (
                    <div className="mt-1">
                      <div className="flex flex-wrap gap-1">
                        {entry.metrics.map((dsl, metricIndex) => {
                          const editingThis =
                            composerOpen && composer!.metricIndex === metricIndex;
                          return (
                            <span
                              key={metricIndex}
                              className={`${CHIP_CLASS}${editingThis ? ' ring-1 ring-slate-500 dark:ring-slate-300' : ''}`}
                            >
                              <button
                                type="button"
                                onClick={() => setComposer({ entryIndex: entryIndex!, metricIndex })}
                                className="hover:underline"
                                title="Edit this metric in the composer"
                                data-testid={`metric-chip-${metricIndex}`}
                              >
                                {dsl}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMetric(entryIndex!, metricIndex)}
                                className="text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                                aria-label={`Remove ${dsl}`}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => setComposer({ entryIndex: entryIndex!, metricIndex: null })}
                        className="mt-1 flex items-center gap-1 rounded border border-dashed border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        data-testid="add-metric-button"
                      >
                        <Plus size={10} />
                        add metric
                      </button>
                      {composerOpen && (
                        <MetricComposer
                          key={`${entryIndex}-${editingMetricIndex}`}
                          initial={
                            editingMetricIndex !== null
                              ? decomposeOrNull(effectiveExpected[entryIndex]!.metrics[editingMetricIndex]!)
                              : null
                          }
                          actualMetrics={statement.metrics.getAll()}
                          submitLabel={editingMetricIndex !== null ? 'Save metric' : 'Add metric'}
                          onSubmit={(dsl) => {
                            const err =
                              editingMetricIndex !== null
                                ? replaceMetric(entryIndex!, editingMetricIndex, dsl)
                                : addMetric(entryIndex!, dsl);
                            if (!err) setComposer(null);
                            return err;
                          }}
                          onCancel={() => setComposer(null)}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                      unexpected statement — no Expected entry for this line
                    </div>
                  )}
                </div>
              );
            })}
            {pairing.orphanEntryIndexes.map((entryIndex) => (
              <div key={`orphan-${entryIndex}`} className="border-b border-slate-200 dark:border-slate-700 p-2 last:border-b-0 bg-emerald-500/5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    Line {effectiveExpected[entryIndex]!.line}
                  </span>
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    expected, but the parser produced no statement here
                  </span>
                  <button
                    type="button"
                    onClick={() => mutateExpected((entries) => entries.filter((_, i) => i !== entryIndex))}
                    className="ml-auto rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[10px] hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    drop
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {effectiveExpected[entryIndex]!.metrics.map((dsl, metricIndex) => {
                    const editingThis = composer?.entryIndex === entryIndex && composer.metricIndex === metricIndex;
                    return (
                      <span
                        key={metricIndex}
                        className={`${CHIP_CLASS}${editingThis ? ' ring-1 ring-slate-500 dark:ring-slate-300' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => setComposer({ entryIndex, metricIndex })}
                          className="hover:underline"
                          title="Edit this metric in the composer"
                        >
                          {dsl}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMetric(entryIndex, metricIndex)}
                          className="text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                          aria-label={`Remove ${dsl}`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
                {composer?.entryIndex === entryIndex && (
                  <MetricComposer
                    key={`orphan-${entryIndex}-${composer.metricIndex}`}
                    initial={
                      composer.metricIndex !== null
                        ? decomposeOrNull(effectiveExpected[entryIndex]!.metrics[composer.metricIndex]!)
                        : null
                    }
                    actualMetrics={[]}
                    submitLabel={composer.metricIndex !== null ? 'Save metric' : 'Add metric'}
                    onSubmit={(dsl) => {
                      const err =
                        composer.metricIndex !== null
                          ? replaceMetric(entryIndex, composer.metricIndex, dsl)
                          : addMetric(entryIndex, dsl);
                      if (!err) setComposer(null);
                      return err;
                    }}
                    onCancel={() => setComposer(null)}
                  />
                )}
              </div>
            ))}
            {pairing.pairs.length === 0 && pairing.orphanEntryIndexes.length === 0 && (
              <div className="p-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Type a script on the left — parsed statements appear here.
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Runner preview
            </div>
            <DiffView result={liveResult} />
          </div>
        </div>
      </div>

      {/* File assembly */}
      <div className="space-y-2 rounded border border-slate-200 dark:border-slate-700 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">Test file</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="File title"
            className="w-44 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1.5 py-1 text-xs"
          />
          <button
            type="button"
            onClick={saveCase}
            className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
            data-testid="builder-save-case"
          >
            <Save size={12} />
            Save case to file
          </button>
          <button
            type="button"
            onClick={() => {
              setName(`case-${cases.length + 1}`);
              setStoredExpected(null);
              setExpectErrors(false);
              setErrorsExpected([]);
            }}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            New case
          </button>
          <div className="ml-auto flex gap-1">
            <a
              href={`data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`}
              download={fileName}
              className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              data-testid="builder-download"
            >
              <Download size={12} />
              Download JSON
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(jsonText).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              data-testid="builder-copy"
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        </div>

        {cases.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {cases.map((c) => (
              <span key={c.name} className={CHIP_CLASS}>
                <button type="button" onClick={() => loadCase(c)} className="hover:underline">
                  {c.name}
                </button>
                <button
                  type="button"
                  onClick={() => setCases((prev) => prev.filter((x) => x.name !== c.name))}
                  className="text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                  aria-label={`Remove case ${c.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            No cases yet — build one above and press “Save case to file”.
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-[11px] text-slate-500 dark:text-slate-400">JSON preview</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 dark:bg-slate-800/60 p-2 font-mono text-[11px]" data-testid="builder-json">
            {jsonText}
          </pre>
        </details>
      </div>
    </div>
  );
}
